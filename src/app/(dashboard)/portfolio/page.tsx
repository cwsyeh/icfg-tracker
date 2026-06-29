import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { calculateLoanBalance, formatCurrency, getIOExpiryDate } from '@/lib/utils/finance'
import type { Property, Loan, Valuation, PropertySaleCost, PropertyAcquisitionCost, DepreciationSchedule, ConstructionProgressPayment, Transaction } from '@/lib/types/database'
import { fetchAll } from '@/lib/supabase/paginate'
import AddPropertyButton from '@/components/portfolio/AddPropertyButton'
import { HoverableRow } from '@/components/ui/ClickableRow'
import PortfolioCharts from '@/components/portfolio/PortfolioCharts'
import type { MonthlyRow } from '@/components/cashflow/CashflowDashboard'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

const INCOME_TYPES = new Set(['rent_income', 'other_income'])
const EXPENSE_TYPES = new Set([
  'interest_expense', 'council_rates', 'water_rates', 'insurance',
  'property_management_fee', 'repairs_maintenance', 'advertising',
  'legal_fees', 'bank_fees', 'strata_body_corp',
  'land_tax', 'borrowing_expenses', 'cleaning', 'other_expense',
])
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function daysUntil(dateStr: string, today: Date) {
  return Math.round((new Date(dateStr).getTime() - today.getTime()) / 86400000)
}

type AlertLevel = 'expired' | 'urgent' | 'warning' | 'upcoming'
function alertLevel(days: number): AlertLevel {
  if (days < 0) return 'expired'
  if (days <= 60) return 'urgent'
  if (days <= 180) return 'warning'
  return 'upcoming'
}

const LEVEL_STYLE: Record<AlertLevel, { border: string; bg: string; color: string; icon: string }> = {
  expired: { border: '#c8332a', bg: '#fff5f5', color: '#c8332a', icon: '●' },
  urgent:  { border: '#c8332a', bg: '#fff5f5', color: '#c8332a', icon: '●' },
  warning: { border: '#d97706', bg: '#fffcf5', color: '#d97706', icon: '●' },
  upcoming:{ border: '#15803d', bg: '#f6fdf6', color: '#15803d', icon: '●' },
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('*').eq('user_id', user.id).single()

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

  // Date range: last 12 months for the cashflow chart
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  const dateFrom = twelveMonthsAgo.toISOString().slice(0, 10)

  const [
    { data: valuations },
    { data: loans },
    { data: saleCosts },
    { data: acquisitionCosts },
    { data: depreciation },
    { data: progressPayments },
    { data: capExTxns },
    recentTxns,
  ] = await Promise.all([
    supabase.from('valuations').select('*').in('property_id', propertyIds).order('valuation_date', { ascending: false }).range(0, 9999),
    supabase.from('loans').select('*').in('tax_property_id', propertyIds).range(0, 9999),
    supabase.from('property_sale_costs').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('property_acquisition_costs').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('depreciation_schedules').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('construction_progress_payments').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('transactions').select('id,property_id,type,amount').in('property_id', propertyIds).eq('type', 'capital_expense').range(0, 9999),
    fetchAll<Pick<Transaction, 'id' | 'property_id' | 'type' | 'amount' | 'transaction_date'>>(
      (from, to) =>
        supabase.from('transactions')
          .select('id, property_id, type, amount, transaction_date')
          .in('property_id', propertyIds)
          .gte('transaction_date', dateFrom)
          .order('transaction_date', { ascending: true })
          .range(from, to)
    ),
  ])

  // ── Build enriched property rows ──
  const propNameMap: Record<string, string> = {}
  const properties: PropertyRow[] = (ownerships ?? []).map(o => {
    const prop = o.properties as unknown as Property
    propNameMap[prop.id] = prop.name

    const propValuations = (valuations ?? []).filter(v => v.property_id === prop.id) as Valuation[]
    const propLoans = (loans ?? []).filter(l => l.tax_property_id === prop.id) as Loan[]
    const latestVal = propValuations[0]?.amount ?? null
    const purchaseCostFallback = (prop.purchase_price ?? 0) +
      (prop.property_type === 'house_and_land' ? (prop.construction_contract_amount ?? 0) : 0)
    const isOtpPreCompletion = prop.property_type === 'off_the_plan' && prop.construction_status !== 'completed'
    const isSold = prop.status === 'sold'
    const propSaleCosts = (saleCosts ?? []).filter(c => c.property_id === prop.id) as PropertySaleCost[]
    const propAcqCosts = (acquisitionCosts ?? []).filter(c => c.property_id === prop.id) as PropertyAcquisitionCost[]
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
      ? estimatedGain
      : isOtpPreCompletion
        ? (prop.deposit_paid ?? null)
        : (latestVal ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null))
    const isValFallback = !isSold && !isOtpPreCompletion && latestVal === null && displayVal !== null

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

    return {
      ...prop,
      share_percentage: o.share_percentage,
      latest_valuation: displayVal,
      is_val_fallback: isValFallback,
      loan_balance: loanBalance,
      equity, ltv,
      estimated_gain: estimatedGain,
      excluded_from_total: false,
    }
  })

  // ── Portfolio totals ──
  const totalValue = properties.reduce((s, p) => s + (p.latest_valuation ?? 0), 0)
  const totalDebt = properties.reduce((s, p) => s + p.loan_balance, 0)
  const totalEquity = totalValue - totalDebt
  const portfolioLTV = totalValue > 0 ? Math.round((totalDebt / totalValue) * 100) : 0

  // ── Monthly cashflow data (last 12 months) ──
  const monthMap: Record<string, MonthlyRow> = {}
  for (const tx of recentTxns) {
    if (!INCOME_TYPES.has(tx.type) && !EXPENSE_TYPES.has(tx.type)) continue
    const d = new Date(tx.transaction_date + 'T00:00:00')
    const yr = d.getFullYear()
    const mo = d.getMonth() + 1
    const monthKey = `${yr}-${String(mo).padStart(2, '0')}`
    const fyYear = mo >= 7 ? yr + 1 : yr
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        month: monthKey,
        monthLabel: `${MONTH_LABELS[mo - 1]} '${String(yr).slice(-2)}`,
        fy: `FY${String(fyYear).slice(-2)}`,
        income: 0, expenses: 0, net: 0,
      }
    }
    const amt = Number(tx.amount)
    if (INCOME_TYPES.has(tx.type)) monthMap[monthKey].income += amt
    else monthMap[monthKey].expenses += amt
    monthMap[monthKey].net = monthMap[monthKey].income + monthMap[monthKey].expenses
  }
  const cashflowData: MonthlyRow[] = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month))

  // ── Portfolio growth data from valuations ──
  const allValuations = (valuations ?? []) as Valuation[]
  const propValuationsMap: Record<string, { date: string; amount: number }[]> = {}
  for (const v of allValuations) {
    if (!propValuationsMap[v.property_id]) propValuationsMap[v.property_id] = []
    propValuationsMap[v.property_id].push({ date: v.valuation_date, amount: Number(v.amount) })
  }
  // Query is DESC so each array is already newest-first

  const uniqueValDates = [...new Set(allValuations.map(v => v.valuation_date))].sort()
  const growthData = uniqueValDates.map(date => {
    const portfolioValue = propertyIds.reduce((total, propId) => {
      const vals = propValuationsMap[propId] ?? []
      const latest = vals.find(v => v.date <= date)
      return total + (latest?.amount ?? 0)
    }, 0)
    const d = new Date(date + 'T00:00:00')
    return {
      date,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }),
      value: portfolioValue,
    }
  }).filter(d => d.value > 0)

  // ── Risk & Alerts ──
  const today = new Date()
  type AlertItem = {
    level: AlertLevel
    days: number
    type: string
    lender: string
    propName: string
    expiryDate: string
    balance: number
    rate: number
    propertyId: string
  }
  const alerts: AlertItem[] = []

  for (const loan of (loans ?? []) as Loan[]) {
    if (loan.status !== 'active') continue
    const balance = Number(loan.actual_balance ?? loan.original_amount)
    const propName = propNameMap[loan.tax_property_id] ?? '—'

    // Use stored io_expiry_date; fall back to calculated
    const ioExpiry = loan.io_expiry_date ?? getIOExpiryDate(loan.start_date, loan.io_period_years)
    if (ioExpiry) {
      const days = daysUntil(ioExpiry, today)
      if (days <= 365) {
        alerts.push({ level: alertLevel(days), days, type: 'IO Expiry', lender: loan.lender, propName, expiryDate: ioExpiry, balance, rate: loan.interest_rate, propertyId: loan.tax_property_id })
      }
    }

    if (loan.fixed_rate_expiry) {
      const days = daysUntil(loan.fixed_rate_expiry, today)
      if (days <= 365) {
        alerts.push({ level: alertLevel(days), days, type: 'Fixed Rate Rolloff', lender: loan.lender, propName, expiryDate: loan.fixed_rate_expiry, balance, rate: loan.interest_rate, propertyId: loan.tax_property_id })
      }
    }
  }
  alerts.sort((a, b) => a.days - b.days)

  const criticalCount = alerts.filter(a => a.level === 'expired' || a.level === 'urgent').length
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1360, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Critical alert banner */}
      {criticalCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 10, padding: '11px 16px',
          marginBottom: 22, fontSize: 12.5, color: '#c8332a',
        }}>
          <span style={{ fontWeight: 800 }}>⚠</span>
          <span>
            <strong>{criticalCount} loan{criticalCount > 1 ? 's' : ''} require urgent attention</strong> — IO or fixed rate expiring within 60 days.{' '}
            <a href="#alerts" style={{ color: '#c8332a', fontWeight: 700 }}>Review below →</a>
          </span>
        </div>
      )}

      {/* Row 1: Summary + Properties */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, marginBottom: 18 }}>

        {/* Portfolio summary card */}
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
          <div style={{ background: '#0c1929', padding: '22px 22px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>
              Total Portfolio Value
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1, marginBottom: 16, fontVariantNumeric: 'tabular-nums' }}>
              {totalValue > 0 ? formatCurrency(totalValue) : '—'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {[
                { label: 'Equity', amount: formatCurrency(Math.max(0, totalEquity)), color: '#f7c925', pct: totalValue > 0 ? Math.max(0, (totalEquity / totalValue) * 100) : 0 },
                { label: 'Debt', amount: formatCurrency(totalDebt), color: '#2563a8', pct: totalValue > 0 ? (totalDebt / totalValue) * 100 : 0 },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5 }}>
                  <span style={{ width: 46, textAlign: 'right', color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{row.label}</span>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, row.pct)}%`, height: '100%', background: row.color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontWeight: 700, color: '#fff', minWidth: 78, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.amount}</span>
                </div>
              ))}
            </div>
          </div>

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
              border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer',
            }}>
              Book a Loan Review
            </button>
          </div>
        </div>

        {/* Properties panel */}
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
                          : '#e4e7f0',
                      }} />
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {p.latest_valuation ? formatCurrency(p.latest_valuation) : '—'}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2, color: '#9ca3af' }}>
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
                  color: p.status === 'active' ? '#15803d' : p.status === 'sold' ? '#7c3aed' : '#6b7280',
                }}>
                  {p.status === 'active' ? 'Active' : p.status === 'sold' ? 'Sold' : 'Archived'}
                </span>
              </HoverableRow>
            ))
          )}
        </div>
      </div>

      {/* Row 2: Charts */}
      <PortfolioCharts cashflowData={cashflowData} growthData={growthData} />

      {/* Row 3: Risk & Alerts */}
      <div id="alerts" style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px 14px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0c1929' }}>Risk &amp; Alerts</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>IO expiries and fixed rate rollovers within 12 months</div>
          </div>
          {alerts.length > 0 && (
            <Link href="/finance" style={{ fontSize: 12.5, color: '#2563a8', fontWeight: 700, textDecoration: 'none' }}>
              View all loans →
            </Link>
          )}
        </div>

        {alerts.length === 0 ? (
          <div style={{ padding: '32px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>✓</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>All clear</div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>No IO or fixed-rate expiries within the next 12 months.</div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((alert, i) => {
              const s = LEVEL_STYLE[alert.level]
              const expDate = new Date(alert.expiryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
              const daysLabel = alert.days < 0
                ? `Expired ${Math.abs(alert.days)}d ago`
                : alert.days === 0 ? 'Today'
                : `${alert.days}d away`
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '4px auto 1fr auto auto',
                    gap: 0,
                    alignItems: 'center',
                    borderRadius: 9,
                    overflow: 'hidden',
                    border: `1px solid ${s.border}20`,
                    background: s.bg,
                  }}
                >
                  {/* Colored left accent bar */}
                  <div style={{ background: s.border, height: '100%', minHeight: 52 }} />

                  {/* Level dot */}
                  <div style={{ padding: '0 12px', color: s.color, fontSize: 9, flexShrink: 0 }}>{s.icon}</div>

                  {/* Main content */}
                  <div style={{ padding: '10px 0', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 120 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: s.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>{alert.type}</div>
                      <div style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{alert.propName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Lender</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{alert.lender}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Balance</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(alert.balance)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Rate</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{alert.rate.toFixed(2)}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Expiry</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{expDate}</div>
                      <div style={{ fontSize: 10.5, color: s.color, opacity: .8 }}>{daysLabel}</div>
                    </div>
                  </div>

                  {/* CTA */}
                  <div style={{ padding: '0 16px', flexShrink: 0 }}>
                    <Link href={`/properties/${alert.propertyId}`} style={{
                      display: 'inline-block', padding: '7px 14px',
                      background: s.border, color: '#fff',
                      borderRadius: 7, fontSize: 12, fontWeight: 700,
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>
                      Review →
                    </Link>
                  </div>

                  {/* Right padding col */}
                  <div style={{ width: 0 }} />
                </div>
              )
            })}

            <div style={{ marginTop: 4, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>
              <strong style={{ color: '#374151' }}>Action tip:</strong> Contact ICFG at least <strong style={{ color: '#374151' }}>90 days before expiry</strong> to allow time for credit assessment and formal approval. Fixed-rate rollovers and IO expiries often require a full serviceability re-assessment.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
