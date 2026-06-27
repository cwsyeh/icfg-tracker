import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { calculateLoanBalance, formatCurrency, getIOExpiryDate } from '@/lib/utils/finance'
import type { Property, Loan, Valuation, PropertySaleCost, PropertyAcquisitionCost, DepreciationSchedule, ConstructionProgressPayment, Transaction } from '@/lib/types/database'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
import AddPropertyButton from '@/components/portfolio/AddPropertyButton'
import { HoverableRow } from '@/components/ui/ClickableRow'

type PropertyRow = Property & {
  share_percentage: number
  latest_valuation: number | null
  is_val_fallback: boolean
  loan_balance: number
  equity: number | null
  ltv: number | null
  estimated_gain: number | null
  excluded_from_total: boolean
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('*').eq('id', user.id).single()

  // Fetch properties with ownership — seed demo data if first login
  let { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(*)')
    .eq('user_id', user.id)

  if (!ownerships || ownerships.length === 0) {
    await adminSupabase.rpc('seed_demo_data', { target_user_id: user.id })
    const { data: fresh } = await supabase
      .from('property_owners')
      .select('share_percentage, properties(*)')
      .eq('user_id', user.id)
    ownerships = fresh
  }

  const propertyIds = (ownerships ?? []).map(o => (o.properties as unknown as Property).id)

  // Fetch latest valuation and loans for each property
  const [
    { data: valuations },
    { data: loans },
    { data: saleCosts },
    { data: acquisitionCosts },
    { data: depreciation },
    { data: progressPayments },
    { data: capExTxns },
  ] = await Promise.all([
    supabase.from('valuations').select('*').in('property_id', propertyIds).order('valuation_date', { ascending: false }),
    supabase.from('loans').select('*').in('tax_property_id', propertyIds),
    supabase.from('property_sale_costs').select('*').in('property_id', propertyIds),
    supabase.from('property_acquisition_costs').select('*').in('property_id', propertyIds),
    supabase.from('depreciation_schedules').select('*').in('property_id', propertyIds),
    supabase.from('construction_progress_payments').select('*').in('property_id', propertyIds),
    supabase.from('transactions').select('id,property_id,type,amount').in('property_id', propertyIds).eq('type', 'capital_expense'),
  ])

  // Build enriched property rows
  const properties: PropertyRow[] = (ownerships ?? []).map(o => {
    const prop = o.properties as unknown as Property
    const propValuations = (valuations ?? []).filter(v => v.property_id === prop.id) as Valuation[]
    const propLoans = (loans ?? []).filter(l => l.tax_property_id === prop.id) as Loan[]

    const latestVal = propValuations[0]?.amount ?? null

    const purchaseCostFallback = (prop.purchase_price ?? 0) +
      (prop.property_type === 'house_and_land' ? (prop.construction_contract_amount ?? 0) : 0)
    const isOtpPreCompletion = prop.property_type === 'off_the_plan' && prop.construction_status !== 'completed'
    const isSold = prop.status === 'sold'
    const propSaleCosts = (saleCosts ?? []).filter(c => c.property_id === prop.id) as PropertySaleCost[]
    const propAcqCosts = (acquisitionCosts ?? []).filter(c => c.property_id === prop.id) as PropertyAcquisitionCost[]
    const propDepr = (depreciation ?? []).filter(d => d.property_id === prop.id) as DepreciationSchedule[]
    const propProgress = (progressPayments ?? []).filter(pp => pp.property_id === prop.id) as ConstructionProgressPayment[]
    const propCapEx = (capExTxns ?? []).filter(t => t.property_id === prop.id) as Transaction[]
    const totalSaleCosts = propSaleCosts.reduce((s, c) => s + c.amount, 0)
    const netProceeds = (prop.sold_price ?? 0) - totalSaleCosts
    const contractAmt = propProgress.reduce((s, pp) => s + (pp.amount ?? 0), 0)
    const totalAcq = propAcqCosts.reduce((s, c) => s + c.amount, 0)
    const totalCapEx = propCapEx.reduce((s, t) => s + Math.abs(t.amount), 0)
    const costBase = (prop.purchase_price ?? 0) + contractAmt + totalAcq + totalCapEx
    const estimatedGain = isSold && prop.sold_price !== null ? netProceeds - costBase : null
    const displayVal = isSold
      ? estimatedGain  // show capital gain for sold properties
      : isOtpPreCompletion
        ? (prop.deposit_paid ?? null)
        : (latestVal ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null))
    const isValFallback = !isSold && !isOtpPreCompletion && latestVal === null && displayVal !== null
    const excludedFromTotal = false  // include all properties: sold at gain, OTP at deposit

    // Prefer actual_balance > formula
    const activeLoans = propLoans.filter(l => l.status === 'active')
    const loanBalance = activeLoans.reduce((sum, l) => {
      const bal = l.actual_balance !== null && l.actual_balance !== undefined
        ? Number(l.actual_balance)
        : calculateLoanBalance({
            originalAmount: l.original_amount,
            annualRate: l.interest_rate,
            termYears: l.loan_term_years,
            startDate: l.start_date,
            repaymentType: l.repayment_type,
            ioPeriodYears: l.io_period_years ?? 0,
          })
      return sum + bal
    }, 0)

    const equity = isSold ? null : (displayVal !== null ? displayVal - loanBalance : null)
    const ltv = isSold ? null : (displayVal ? Math.round((loanBalance / displayVal) * 100) : null)

    return { ...prop, share_percentage: o.share_percentage, latest_valuation: displayVal, is_val_fallback: isValFallback, loan_balance: loanBalance, equity, ltv, estimated_gain: estimatedGain, excluded_from_total: excludedFromTotal }
  })

  // Portfolio totals: include sold at sold_price; OTP pre-completion = nil (excluded)
  const totalValue = properties.reduce((s, p) => p.excluded_from_total ? s : s + (p.latest_valuation ?? 0), 0)
  const totalDebt = properties.reduce((s, p) => p.excluded_from_total ? s : s + p.loan_balance, 0)
  const totalEquity = totalValue - totalDebt
  const portfolioLTV = totalValue > 0 ? Math.round((totalDebt / totalValue) * 100) : 0

  // IO alerts
  const ioAlerts = (loans ?? []).filter(l => {
    const expiry = getIOExpiryDate(l.start_date, l.io_period_years)
    if (!expiry) return false
    const months = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
    return months > 0 && months <= 6
  })

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1360, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* IO Alert strip */}
      {ioAlerts.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb',
          border: '1px solid #fde68a', borderRadius: 10, padding: '11px 16px',
          marginBottom: 22, fontSize: 12.5, color: '#92400e'
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 14h14L8 1z" opacity=".4"/><path d="M8 6v3M8 11v1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
          <span>
            <strong>Rate opportunity:</strong> {ioAlerts.length} IO loan{ioAlerts.length > 1 ? 's' : ''} expiring within 6 months — potential savings available.{' '}
            <Link href="/properties" style={{ color: '#2563a8', fontWeight: 700 }}>Review now →</Link>
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, marginBottom: 20 }}>

        {/* ── Portfolio summary card ── */}
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
          <div style={{ background: '#0c1929', padding: '22px 22px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>
              Total Portfolio Value
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1, marginBottom: 16, fontVariantNumeric: 'tabular-nums' }}>
              {totalValue > 0 ? formatCurrency(totalValue) : '—'}
            </div>
            {/* Equity bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {[
                { label: 'Equity', value: totalEquity, amount: formatCurrency(Math.max(0, totalEquity)), color: '#f7c925', pct: totalValue > 0 ? Math.max(0, (totalEquity / totalValue) * 100) : 0 },
                { label: 'Debt', value: totalDebt, amount: formatCurrency(totalDebt), color: '#2563a8', pct: totalValue > 0 ? (totalDebt / totalValue) * 100 : 0 },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5 }}>
                  <span style={{ width: 46, textAlign: 'right', color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{row.label}</span>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${row.pct}%`, height: '100%', background: row.color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontWeight: 700, color: '#fff', minWidth: 78, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.amount}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {[
              { label: 'LTV', value: totalValue > 0 ? `${portfolioLTV}%` : '—' },
              { label: 'Properties', value: String(properties.length) },
              { label: 'Total Debt', value: totalDebt > 0 ? formatCurrency(totalDebt) : '—' },
              { label: 'Total Equity', value: totalEquity > 0 ? formatCurrency(totalEquity) : '—' },
            ].map(s => (
              <div key={s.label} style={{ padding: '10px 12px', background: '#f0f2f7', borderRadius: 9 }}>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: '0 22px 18px' }}>
            <button style={{
              width: '100%', padding: 10, background: '#f7c925', color: '#1a1200',
              border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer'
            }}>
              Book a Loan Review
            </button>
          </div>
        </div>

        {/* ── Properties panel ── */}
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 14px', borderBottom: '1px solid #e4e7f0' }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>My Properties</h2>
            <AddPropertyButton />
          </div>

          {properties.length === 0 ? (
            <div style={{ padding: '48px 32px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#9ca3af' }}>No properties yet — add your first one above.</p>
            </div>
          ) : (
            properties.map(p => (
              <HoverableRow key={p.id} href={`/properties/${p.id}`} style={{
                display: 'grid', gridTemplateColumns: '1fr 160px 150px auto', alignItems: 'center',
                gap: 16, padding: '15px 22px', borderBottom: '1px solid #e4e7f0', cursor: 'pointer',
              }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.street_address}, {p.suburb} {p.state}</div>
                  </div>
                  <div>
                    {p.status !== 'sold' && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#5c6478', marginBottom: 4 }}>
                          <span>LTV {p.ltv ?? '—'}%</span>
                          <span>{p.ltv !== null ? `${100 - p.ltv}% equity` : '—'}</span>
                        </div>
                        <div style={{
                          height: 5, borderRadius: 3, overflow: 'hidden',
                          background: p.ltv !== null
                            ? `linear-gradient(to right, #2563a8 ${Math.min(100, p.ltv)}%, #f7c925 ${Math.min(100, p.ltv)}%)`
                            : '#e4e7f0'
                        }} />
                      </>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {p.latest_valuation ? formatCurrency(p.latest_valuation) : '—'}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2, color: p.estimated_gain !== null ? '#15803d' : p.status === 'sold' ? '#9ca3af' : p.is_val_fallback ? '#9ca3af' : '#9ca3af' }}>
                      {p.status === 'sold'
                        ? 'Realised Capital Gain (est.)'
                        : p.property_type === 'off_the_plan' && p.construction_status !== 'completed'
                          ? 'Deposit only'
                          : p.is_val_fallback
                            ? 'Purchase cost (est.)'
                            : p.share_percentage < 100
                              ? `${p.share_percentage}% share`
                              : 'Full ownership'}
                    </div>
                  </div>
                  <span style={{
                    padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                    background: p.status === 'active' ? '#dcfce7' : p.status === 'sold' ? '#f3e8ff' : '#f3f4f6',
                    color: p.status === 'active' ? '#15803d' : p.status === 'sold' ? '#7c3aed' : '#6b7280'
                  }}>
                    {p.status === 'active' ? 'Active' : p.status === 'sold' ? 'Sold' : 'Archived'}
                  </span>
              </HoverableRow>
            ))
          )}
        </div>
      </div>

      {/* Cashflow chart placeholder */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', padding: '20px 24px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Portfolio Cashflow Projection</h2>
        <p style={{ fontSize: 11.5, color: '#5c6478', marginBottom: 16 }}>
          10-year outlook · add transactions to populate live data
        </p>
        <svg viewBox="0 0 1100 140" style={{ width: '100%', height: 140, display: 'block' }}>
          <line x1="60" y1="35" x2="1090" y2="35" stroke="#e4e7f0" strokeWidth="1"/>
          <line x1="60" y1="78" x2="1090" y2="78" stroke="#e4e7f0" strokeWidth="1"/>
          <line x1="60" y1="120" x2="1090" y2="120" stroke="#e4e7f0" strokeWidth="1"/>
          <text x="54" y="38" textAnchor="end" fontSize="9" fill="#9ca3af">$0</text>
          <text x="54" y="81" textAnchor="end" fontSize="9" fill="#9ca3af">-$50k</text>
          <text x="54" y="123" textAnchor="end" fontSize="9" fill="#9ca3af">-$100k</text>
          <defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f7c925" stopOpacity=".18"/><stop offset="100%" stopColor="#f7c925" stopOpacity="0"/></linearGradient></defs>
          <polygon points="60,82 163,76 266,69 369,60 472,51 575,41 678,30 781,17 884,14 987,13 1090,13 1090,140 60,140" fill="url(#gf)"/>
          <polyline points="60,82 163,76 266,69 369,60 472,51 575,41 678,30 781,17 884,14 987,13 1090,13" fill="none" stroke="#f7c925" strokeWidth="2.5" strokeLinejoin="round"/>
          {['FY26','FY28','FY30','FY32','FY34','FY36'].map((yr, i) => (
            <text key={yr} x={60 + i * 206} y="140" textAnchor="middle" fontSize="9" fill="#9ca3af">{yr}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}
