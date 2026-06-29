import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Property, Loan } from '@/lib/types/database'
import { formatCurrency } from '@/lib/utils/finance'

function daysUntil(dateStr: string, today: Date) {
  return Math.round((new Date(dateStr).getTime() - today.getTime()) / 86400000)
}

type AlertLevel = 'expired' | 'urgent' | 'warning' | 'upcoming'

function getLevel(days: number): AlertLevel {
  if (days < 0) return 'expired'
  if (days <= 60) return 'urgent'
  if (days <= 180) return 'warning'
  return 'upcoming'
}

const LEVEL_CONFIG: Record<AlertLevel, { bg: string; border: string; color: string; icon: string; label: string }> = {
  expired: { bg: '#fef2f2', border: '#fecaca', color: '#c8332a', icon: '🔴', label: 'Expired' },
  urgent: { bg: '#fef2f2', border: '#fecaca', color: '#c8332a', icon: '🔴', label: 'Critical — within 60 days' },
  warning: { bg: '#fffbeb', border: '#fde68a', color: '#d97706', icon: '🟡', label: 'Action needed — within 6 months' },
  upcoming: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d', icon: '🟢', label: 'On the radar — within 12 months' },
}

interface AlertItem {
  level: AlertLevel
  days: number
  lender: string
  propName: string
  type: 'IO Expiry' | 'Fixed Rate Rolloff'
  expiryDate: string
  balance: number
  rate: number
  loanId: string
  propertyId: string
}

export default async function AlertsPage() {
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
    .range(0, 9999)

  const loans = (rawLoans ?? []) as Loan[]
  const today = new Date()

  const alerts: AlertItem[] = []

  for (const loan of loans) {
    const balance = loan.actual_balance ?? loan.original_amount
    const propName = propNameMap[loan.tax_property_id] ?? '—'

    if (loan.io_expiry_date) {
      const days = daysUntil(loan.io_expiry_date, today)
      if (days <= 365) {
        alerts.push({
          level: getLevel(days), days,
          lender: loan.lender, propName,
          type: 'IO Expiry', expiryDate: loan.io_expiry_date,
          balance, rate: loan.interest_rate,
          loanId: loan.id, propertyId: loan.tax_property_id,
        })
      }
    }

    if (loan.fixed_rate_expiry) {
      const days = daysUntil(loan.fixed_rate_expiry, today)
      if (days <= 365) {
        alerts.push({
          level: getLevel(days), days,
          lender: loan.lender, propName,
          type: 'Fixed Rate Rolloff', expiryDate: loan.fixed_rate_expiry,
          balance, rate: loan.interest_rate,
          loanId: loan.id, propertyId: loan.tax_property_id,
        })
      }
    }
  }

  alerts.sort((a, b) => a.days - b.days)

  const criticalCount = alerts.filter(a => a.level === 'expired' || a.level === 'urgent').length
  const warningCount = alerts.filter(a => a.level === 'warning').length
  const upcomingCount = alerts.filter(a => a.level === 'upcoming').length

  const S = {
    card: {
      background: '#fff', borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)',
      padding: '18px 20px',
    } as React.CSSProperties,
    kpiLabel: { fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 5 },
  }

  return (
    <div style={{ padding: '24px 28px 56px', maxWidth: 1100, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0c1929', margin: 0, marginBottom: 4 }}>Risk &amp; Alerts</h1>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: 0 }}>
            Loan events within the next 12 months requiring review or action
          </p>
        </div>
        <a href="/finance" style={{
          padding: '8px 16px', background: '#f0f6ff', border: '1.5px solid #bfdbfe',
          borderRadius: 9, textDecoration: 'none', color: '#2563a8', fontSize: 12.5, fontWeight: 700,
        }}>
          View all loans →
        </a>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 22 }}>
        {[
          { label: 'Critical', count: criticalCount, bg: '#fef2f2', color: '#c8332a', sub: 'Expired or < 60 days' },
          { label: 'Action Needed', count: warningCount, bg: '#fffbeb', color: '#d97706', sub: '60–180 days' },
          { label: 'On the Radar', count: upcomingCount, bg: '#f0fdf4', color: '#15803d', sub: '180–365 days' },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, background: k.bg }}>
            <div style={S.kpiLabel}>{k.label}</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: k.color, marginBottom: 4 }}>{k.count}</div>
            <div style={{ fontSize: 11, color: k.color, opacity: 0.8 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {alerts.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#15803d', marginBottom: 8 }}>All clear</div>
          <div style={{ fontSize: 13, color: '#9ca3af' }}>No IO or fixed-rate expiries within the next 12 months.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map((alert, i) => {
            const cfg = LEVEL_CONFIG[alert.level]
            const expDate = new Date(alert.expiryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
            const daysLabel = alert.days < 0
              ? `${Math.abs(alert.days)} days ago`
              : alert.days === 0 ? 'Today'
              : `${alert.days} day${alert.days !== 1 ? 's' : ''} away`
            return (
              <div
                key={i}
                style={{
                  background: cfg.bg,
                  border: `1.5px solid ${cfg.border}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'grid',
                  gridTemplateColumns: '200px 1fr auto',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                {/* Left: type + level */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 }}>
                    {cfg.icon} {cfg.label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#0c1929', marginBottom: 2 }}>{alert.type}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{alert.propName}</div>
                </div>

                {/* Middle: details */}
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Lender</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{alert.lender}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Balance</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(alert.balance)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Current Rate</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{alert.rate.toFixed(2)}% p.a.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Expiry Date</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{expDate}</div>
                    <div style={{ fontSize: 11, color: cfg.color, opacity: 0.8 }}>{daysLabel}</div>
                  </div>
                </div>

                {/* Right: CTA */}
                <a
                  href={`/properties/${alert.propertyId}`}
                  style={{
                    padding: '8px 16px', background: cfg.color, color: '#fff',
                    borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: 700,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  Review loan →
                </a>
              </div>
            )
          })}
        </div>
      )}

      {alerts.length > 0 && (
        <div style={{ marginTop: 20, padding: '14px 18px', background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 12.5, color: '#1e40af', lineHeight: 1.6 }}>
          <strong>Action tip:</strong> For IO expiries, assess whether to extend the IO period, switch to P&I, or refinance. For fixed-rate rollovers, compare current variable rates and any available fixed rate specials before the expiry date. Contact your broker (ICFG) at least 90 days before expiry.
        </div>
      )}
    </div>
  )
}
