import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Property, Loan } from '@/lib/types/database'
import { formatCurrency } from '@/lib/utils/finance'

function daysBetween(from: string, to: Date) {
  return Math.round((new Date(from).getTime() - to.getTime()) / 86400000)
}

function urgency(dateStr: string | null, today: Date) {
  if (!dateStr) return null
  const days = daysBetween(dateStr, today)
  if (days < 0) return 'expired'
  if (days <= 60) return 'urgent'
  if (days <= 180) return 'warning'
  if (days <= 365) return 'upcoming'
  return 'ok'
}

const URGENCY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  expired: { bg: '#fef2f2', color: '#c8332a', label: 'Expired' },
  urgent: { bg: '#fef2f2', color: '#c8332a', label: '< 60 days' },
  warning: { bg: '#fffbeb', color: '#d97706', label: '60–180 days' },
  upcoming: { bg: '#f0fdf4', color: '#15803d', label: '180–365 days' },
  ok: { bg: '#f0f9ff', color: '#0369a1', label: '> 1 year' },
}

function ExpiryBadge({ dateStr, today }: { dateStr: string | null; today: Date }) {
  if (!dateStr) return <span style={{ color: '#d1d5db', fontSize: 12 }}>—</span>
  const u = urgency(dateStr, today)!
  const s = URGENCY_STYLE[u]
  const d = new Date(dateStr)
  const label = d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>
      {label}
    </span>
  )
}

export default async function FinancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('properties(id, name, usage)')
    .eq('user_id', user.id)

  const properties = (ownerships ?? []).map(o => o.properties as unknown as Property)
  const propertyIds = properties.map(p => p.id)
  const propNameMap: Record<string, string> = {}
  properties.forEach(p => { propNameMap[p.id] = p.name })

  if (propertyIds.length === 0) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>No properties yet.</div>
      </div>
    )
  }

  const { data: rawLoans } = await supabase
    .from('loans')
    .select('*')
    .in('tax_property_id', propertyIds)
    .eq('status', 'active')
    .order('lender')
    .range(0, 9999)

  const loans = (rawLoans ?? []) as Loan[]
  const today = new Date()

  const totalBalance = loans.reduce((s, l) => s + (l.actual_balance ?? l.original_amount), 0)
  const weightedRate = totalBalance > 0
    ? loans.reduce((s, l) => s + (l.actual_balance ?? l.original_amount) * l.interest_rate, 0) / totalBalance
    : 0
  const ioBalance = loans.filter(l => l.repayment_type === 'interest_only').reduce((s, l) => s + (l.actual_balance ?? l.original_amount), 0)
  const piBalance = loans.filter(l => l.repayment_type === 'principal_and_interest').reduce((s, l) => s + (l.actual_balance ?? l.original_amount), 0)

  const alertCount = loans.filter(l => {
    const ioU = urgency(l.io_expiry_date, today)
    const fixedU = urgency(l.fixed_rate_expiry, today)
    return (ioU === 'urgent' || ioU === 'warning' || ioU === 'expired') ||
      (fixedU === 'urgent' || fixedU === 'warning' || fixedU === 'expired')
  }).length

  const S = {
    card: {
      background: '#fff', borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)',
      padding: '18px 20px',
    } as React.CSSProperties,
    kpiLabel: { fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 5 },
    th: { fontSize: 10.5, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', padding: '10px 14px', textAlign: 'left' as const, background: '#f8fafc', borderBottom: '1px solid #e4e7f0' },
    td: { padding: '12px 14px', borderBottom: '1px solid #f3f4f6', fontSize: 13, verticalAlign: 'middle' as const },
  }

  return (
    <div style={{ padding: '24px 28px 56px', maxWidth: 1200, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0c1929', margin: 0, marginBottom: 4 }}>Finance Hub</h1>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: 0 }}>
            All active loans across your portfolio · {loans.length} loan{loans.length !== 1 ? 's' : ''} total
          </p>
        </div>
        {alertCount > 0 && (
          <a href="/alerts" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
            background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 9,
            textDecoration: 'none', color: '#c8332a', fontSize: 12.5, fontWeight: 700,
          }}>
            ⚠ {alertCount} loan{alertCount !== 1 ? 's' : ''} need attention
          </a>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Debt', value: formatCurrency(totalBalance), sub: `${loans.length} active loans`, color: '#0c1929' },
          { label: 'Weighted Avg Rate', value: `${weightedRate.toFixed(2)}% p.a.`, sub: 'Across all facilities', color: '#2563a8' },
          { label: 'Interest Only', value: formatCurrency(ioBalance), sub: `${loans.filter(l => l.repayment_type === 'interest_only').length} IO loans`, color: '#d97706' },
          { label: 'Principal & Interest', value: formatCurrency(piBalance), sub: `${loans.filter(l => l.repayment_type === 'principal_and_interest').length} P&I loans`, color: '#15803d' },
        ].map(k => (
          <div key={k.label} style={S.card}>
            <div style={S.kpiLabel}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Loans table */}
      {loans.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 14, color: '#9ca3af' }}>No active loans found. Add loans via the property detail page.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                {['Property', 'Lender', 'Balance', 'Rate', 'Type', 'Rate Type', 'IO Expiry', 'Fixed Expiry', 'Notes'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const propName = propNameMap[loan.tax_property_id] ?? '—'
                const balance = loan.actual_balance ?? loan.original_amount
                const ioU = urgency(loan.io_expiry_date, today)
                const fixedU = urgency(loan.fixed_rate_expiry, today)
                const rowAlert = (ioU === 'urgent' || ioU === 'warning' || ioU === 'expired') || (fixedU === 'urgent' || fixedU === 'warning' || fixedU === 'expired')
                return (
                  <tr key={loan.id} style={{ background: rowAlert ? '#fffcf5' : '#fff' }}>
                    <td style={{ ...S.td, fontWeight: 700, color: '#0c1929', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {propName}
                    </td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{loan.lender}</td>
                    <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      {formatCurrency(balance)}
                    </td>
                    <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                      {loan.interest_rate.toFixed(2)}% p.a.
                    </td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                        background: loan.repayment_type === 'interest_only' ? '#fffbeb' : '#f0fdf4',
                        color: loan.repayment_type === 'interest_only' ? '#d97706' : '#15803d',
                      }}>
                        {loan.repayment_type === 'interest_only' ? 'IO' : 'P&I'}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                        background: loan.rate_type === 'fixed' ? '#f0f6ff' : '#f8fafc',
                        color: loan.rate_type === 'fixed' ? '#2563a8' : '#6b7280',
                      }}>
                        {loan.rate_type === 'fixed' ? 'Fixed' : 'Variable'}
                      </span>
                    </td>
                    <td style={S.td}><ExpiryBadge dateStr={loan.io_expiry_date} today={today} /></td>
                    <td style={S.td}><ExpiryBadge dateStr={loan.fixed_rate_expiry} today={today} /></td>
                    <td style={{ ...S.td, fontSize: 11, color: '#9ca3af', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {loan.notes ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 16, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Expiry legend:</div>
        {Object.entries(URGENCY_STYLE).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ background: v.bg, color: v.color, padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
