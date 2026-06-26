import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { calculateLoanBalance, formatCurrency } from '@/lib/utils/finance'

import type { Property, Loan, Valuation } from '@/lib/types/database'
import AddPropertyButton from '@/components/portfolio/AddPropertyButton'
import { ClickableRow } from '@/components/ui/ClickableRow'

const USAGE_LABEL: Record<string, string> = {
  investment: 'Investment',
  ppor: 'PPOR',
  mixed: 'Mixed',
}

const TYPE_LABEL: Record<string, string> = {
  established: 'Established',
  house_and_land: 'House & Land',
  land: 'Vacant Land',
  off_the_plan: 'Off The Plan',
}

export default async function PropertiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(*)')
    .eq('user_id', user.id)

  const propertyIds = (ownerships ?? []).map(o => (o.properties as unknown as Property).id)

  const [{ data: valuations }, { data: loans }] = await Promise.all([
    supabase.from('valuations').select('*').in('property_id', propertyIds).order('valuation_date', { ascending: false }),
    supabase.from('loans').select('*').in('tax_property_id', propertyIds),
  ])

  type PropRow = Property & {
    share_percentage: number
    latest_valuation: number | null
    is_val_fallback: boolean
    valuation_date: string | null
    loan_balance: number
    equity: number | null
    ltv: number | null
    active_loan_count: number
  }

  const properties: PropRow[] = (ownerships ?? []).map(o => {
    const prop = o.properties as unknown as Property
    const propValuations = (valuations ?? []).filter(v => v.property_id === prop.id) as Valuation[]
    const propLoans = (loans ?? []).filter(l => l.tax_property_id === prop.id) as Loan[]
    const activeLoans = propLoans.filter(l => l.status === 'active')

    const latestVal = propValuations[0]?.amount ?? null
    const valDate = propValuations[0]?.valuation_date ?? null

    // Fall back to purchase cost when no formal valuation exists
    const purchaseCostFallback = (prop.purchase_price ?? 0) +
      (prop.property_type === 'house_and_land' ? (prop.construction_contract_amount ?? 0) : 0)
    const displayVal = latestVal ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null)
    const isValFallback = latestVal === null && displayVal !== null

    // Prefer actual_balance > formula
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

    const equity = displayVal !== null ? displayVal - loanBalance : null
    const ltv = displayVal ? Math.round((loanBalance / displayVal) * 100) : null

    return {
      ...prop,
      share_percentage: o.share_percentage,
      latest_valuation: displayVal,
      is_val_fallback: isValFallback,
      valuation_date: valDate,
      loan_balance: loanBalance,
      equity,
      ltv,
      active_loan_count: activeLoans.length,
    }
  })

  // Separate active vs archived/sold
  const active = properties.filter(p => p.status === 'active').sort((a, b) => a.name.localeCompare(b.name))
  const inactive = properties.filter(p => p.status !== 'active').sort((a, b) => a.name.localeCompare(b.name))

  const colHead: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
    letterSpacing: '.08em', padding: '10px 16px', textAlign: 'left', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1200, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0c1929', margin: 0, marginBottom: 4 }}>
            Properties
          </h1>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: 0 }}>
            {active.length} active · {inactive.length > 0 ? `${inactive.length} archived / sold` : 'none archived'}
          </p>
        </div>
        <AddPropertyButton />
      </div>

      {/* ── Active properties ── */}
      {active.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '48px 32px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: '#9ca3af' }}>No properties yet — click Add Property to get started.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e4e7f0' }}>
                  <th style={colHead}>Property</th>
                  <th style={colHead}>Type</th>
                  <th style={colHead}>Usage</th>
                  <th style={{ ...colHead, textAlign: 'right' }}>Valuation</th>
                  <th style={{ ...colHead, textAlign: 'right' }}>Debt</th>
                  <th style={{ ...colHead, textAlign: 'right' }}>Equity</th>
                  <th style={{ ...colHead, textAlign: 'center' }}>LTV</th>
                  <th style={{ ...colHead, textAlign: 'center' }}>Loans</th>
                  <th style={colHead}>Share</th>
                </tr>
              </thead>
              <tbody>
                {active.map((p, i) => {
                  const ltvColor = p.ltv === null ? '#9ca3af' : p.ltv < 70 ? '#15803d' : p.ltv < 80 ? '#d97706' : '#c8332a'
                  const isConstruction = p.property_type === 'house_and_land' && p.construction_status !== 'completed'
                  return (
                    <ClickableRow key={p.id} href={`/properties/${p.id}`} style={{ borderBottom: i < active.length - 1 ? '1px solid #e4e7f0' : undefined }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0c1929', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
                          {p.name}
                          {isConstruction && (
                            <span style={{ fontSize: 10, fontWeight: 700, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a', borderRadius: 10, padding: '1px 7px' }}>
                              {p.construction_status === 'in_progress' ? 'In Progress' : 'Pre-Construction'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          {p.street_address}, {p.suburb} {p.state}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#5c6478' }}>
                        {TYPE_LABEL[p.property_type] ?? p.property_type}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                          background: p.usage === 'investment' ? '#eff6ff' : p.usage === 'ppor' ? '#f0fdf4' : '#fefce8',
                          color: p.usage === 'investment' ? '#1d4ed8' : p.usage === 'ppor' ? '#15803d' : '#a16207',
                        }}>
                          {USAGE_LABEL[p.usage] ?? p.usage}
                          {p.usage === 'mixed' && p.mixed_use_investment_percent != null
                            ? ` (${p.mixed_use_investment_percent}% inv)` : ''}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {p.latest_valuation
                          ? <div>
                              <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.latest_valuation)}</div>
                              <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 1 }}>
                                {p.is_val_fallback
                                  ? 'Purchase cost (est.)'
                                  : p.valuation_date
                                    ? new Date(p.valuation_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                                    : ''}
                              </div>
                            </div>
                          : <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                        {p.loan_balance > 0 ? formatCurrency(p.loan_balance) : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {p.equity !== null
                          ? <span style={{ color: p.equity >= 0 ? '#15803d' : '#c8332a' }}>{formatCurrency(p.equity)}</span>
                          : <span style={{ color: '#9ca3af' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        {p.ltv !== null
                          ? <span style={{ fontSize: 13, fontWeight: 800, color: ltvColor }}>{p.ltv}%</span>
                          : <span style={{ color: '#9ca3af' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, color: '#374151' }}>
                        {p.active_loan_count > 0 ? p.active_loan_count : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#5c6478' }}>
                        {p.share_percentage < 100 ? `${p.share_percentage}%` : 'Full'}
                      </td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Archived / Sold ── */}
      {inactive.length > 0 && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Archived & Sold
          </div>
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)', overflow: 'hidden' }}>
            {inactive.map((p, i) => (
              <Link key={p.id} href={`/properties/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '13px 20px', borderBottom: i < inactive.length - 1 ? '1px solid #e4e7f0' : undefined,
                  opacity: 0.6,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.street_address}, {p.suburb} {p.state}</div>
                  </div>
                  <span style={{
                    padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    background: '#f3f4f6', color: '#6b7280',
                  }}>
                    {p.status === 'sold' ? 'Sold' : 'Archived'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
