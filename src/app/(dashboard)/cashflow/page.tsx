import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils/finance'
import type { Property, Transaction } from '@/lib/types/database'
import CashflowChart from '@/components/cashflow/CashflowChart'

const INCOME_TYPES = new Set(['rent_income', 'other_income'])
const EXPENSE_TYPES = new Set([
  'interest_expense', 'council_rates', 'water_rates', 'insurance',
  'property_management_fee', 'repairs_maintenance', 'advertising',
  'legal_fees', 'bank_fees', 'strata_body_corp',
  'land_tax', 'borrowing_expenses', 'cleaning',
  'other_expense',
])
const DEDUCTIBLE_NON_CASH = new Set(['depreciation'])
const CAPITAL_TYPES = new Set(['capital_expense', 'principal_payment'])

type TxRow = Transaction & { property_name: string }

export default async function CashflowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(id, name, usage)')
    .eq('user_id', user.id)

  const propertyIds = (ownerships ?? []).map(o => (o.properties as unknown as Property).id)

  if (propertyIds.length === 0) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>No properties yet — add one from the Portfolio page.</div>
      </div>
    )
  }

  const { data: rawTxs } = await supabase
    .from('transactions')
    .select('*')
    .in('property_id', propertyIds)
    .order('transaction_date', { ascending: false })

  const txs = (rawTxs ?? []) as Transaction[]

  // Map property id → name
  const propNameMap: Record<string, string> = {}
  ;(ownerships ?? []).forEach(o => {
    const p = o.properties as unknown as Property
    propNameMap[p.id] = p.name
  })

  // Group by financial year then by property
  type FYData = {
    fy: string
    income: number
    expenses: number
    depreciation: number
    capital: number
    net: number
    byProperty: Record<string, { name: string; income: number; expenses: number; net: number }>
  }

  const fyMap: Record<string, FYData> = {}

  for (const tx of txs) {
    const fy = tx.financial_year
    if (!fyMap[fy]) {
      fyMap[fy] = { fy, income: 0, expenses: 0, depreciation: 0, capital: 0, net: 0, byProperty: {} }
    }
    const fyRow = fyMap[fy]
    const propId = tx.property_id
    if (!fyRow.byProperty[propId]) {
      fyRow.byProperty[propId] = { name: propNameMap[propId] ?? propId, income: 0, expenses: 0, net: 0 }
    }
    const pRow = fyRow.byProperty[propId]
    const amt = Number(tx.amount)

    if (INCOME_TYPES.has(tx.type)) {
      fyRow.income += amt
      pRow.income += amt
    } else if (EXPENSE_TYPES.has(tx.type)) {
      fyRow.expenses += amt      // negative
      pRow.expenses += amt
    } else if (DEDUCTIBLE_NON_CASH.has(tx.type)) {
      fyRow.depreciation += amt  // negative
    } else if (CAPITAL_TYPES.has(tx.type)) {
      fyRow.capital += amt       // negative, not deductible
    }

    pRow.net = pRow.income + pRow.expenses
  }

  // Compute net (cash) = income + expenses (expenses are negative)
  const fyRows = Object.values(fyMap)
    .map(r => ({ ...r, net: r.income + r.expenses }))
    .sort((a, b) => b.fy.localeCompare(a.fy))

  const currentFY = fyRows[0]

  const totalIncome = fyRows.reduce((s, r) => s + r.income, 0)
  const totalExpenses = fyRows.reduce((s, r) => s + r.expenses, 0)
  const totalNet = fyRows.reduce((s, r) => s + r.net, 0)

  const chartData = fyRows.map(r => ({
    fy: r.fy,
    income: r.income,
    expenses: Math.abs(r.expenses),
    net: r.net,
  }))

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1100, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0c1929', margin: 0, marginBottom: 4 }}>
          Portfolio Cashflow
        </h1>
        <p style={{ fontSize: 12.5, color: '#9ca3af', margin: 0 }}>
          Cash income and expenses across all properties · excludes depreciation and capital items
        </p>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          {
            label: currentFY ? `${currentFY.fy} Income` : 'Total Income',
            value: formatCurrency(currentFY?.income ?? totalIncome),
            sub: 'Rent & other income',
            color: '#15803d',
          },
          {
            label: currentFY ? `${currentFY.fy} Expenses` : 'Total Expenses',
            value: formatCurrency(Math.abs(currentFY?.expenses ?? totalExpenses)),
            sub: 'Deductible cash outflows',
            color: '#c8332a',
          },
          {
            label: currentFY ? `${currentFY.fy} Net` : 'Net Cashflow',
            value: formatCurrency(currentFY?.net ?? totalNet, true),
            sub: (currentFY?.net ?? totalNet) >= 0 ? 'Positively geared' : 'Negatively geared',
            color: (currentFY?.net ?? totalNet) >= 0 ? '#2563a8' : '#d97706',
          },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: '#fff', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)' }}>
            <div style={{ fontSize: 10.5, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{kpi.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: kpi.color, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Chart + by-year breakdown ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16 }}>

        {/* Chart card */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', padding: '20px 22px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Annual Cashflow</div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            {[
              { color: '#15803d', label: 'Income' },
              { color: '#c8332a', label: 'Expenses' },
              { color: '#2563a8', label: 'Net (positive)' },
              { color: '#d97706', label: 'Net (negative)' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5c6478' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                {l.label}
              </div>
            ))}
          </div>
          {chartData.length > 0
            ? <CashflowChart data={chartData} />
            : <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                No transaction data yet
              </div>
          }
        </div>

        {/* Non-cash items card */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', padding: '20px 22px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>Non-Cash & Capital Items</div>
          <div style={{ fontSize: 11.5, color: '#5c6478', marginBottom: 16, lineHeight: 1.6 }}>
            These affect tax or cost base but are excluded from cashflow above.
          </div>
          {fyRows.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>No data yet</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', color: '#9ca3af', fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>FY</th>
                  <th style={{ textAlign: 'right', color: '#9ca3af', fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>Depreciation</th>
                  <th style={{ textAlign: 'right', color: '#9ca3af', fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>Capital</th>
                </tr>
              </thead>
              <tbody>
                {fyRows.map(r => (
                  <tr key={r.fy}>
                    <td style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontWeight: 700 }}>{r.fy}</td>
                    <td style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: r.depreciation !== 0 ? '#374151' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                      {r.depreciation !== 0 ? formatCurrency(Math.abs(r.depreciation)) : '—'}
                    </td>
                    <td style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: r.capital !== 0 ? '#374151' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                      {r.capital !== 0 ? formatCurrency(Math.abs(r.capital)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Detailed by-year table ── */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #e4e7f0' }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>By Financial Year</div>
        </div>

        {fyRows.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
            No transactions recorded yet. Upload a rental statement or add transactions manually.
          </div>
        ) : (
          fyRows.map((r, idx) => (
            <div key={r.fy} style={{ borderBottom: idx < fyRows.length - 1 ? '1px solid #e4e7f0' : undefined }}>
              {/* FY header row */}
              <div style={{
                display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr',
                gap: 16, padding: '14px 22px',
                background: idx === 0 ? '#f8fafc' : '#fff',
                alignItems: 'center',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0c1929' }}>{r.fy}</div>
                <div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>INCOME</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(r.income)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>EXPENSES</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#c8332a', fontVariantNumeric: 'tabular-nums' }}>
                    ({formatCurrency(Math.abs(r.expenses))})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>NET CASHFLOW</div>
                  <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: r.net >= 0 ? '#2563a8' : '#d97706' }}>
                    {r.net >= 0 ? '+' : ''}{formatCurrency(r.net)}
                  </div>
                </div>
              </div>

              {/* Per-property breakdown */}
              {Object.values(r.byProperty).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <div key={p.name} style={{
                  display: 'grid', gridTemplateColumns: '100px 1fr 1fr 1fr',
                  gap: 16, padding: '8px 22px 8px 36px',
                  background: '#fafafa', borderTop: '1px solid #f3f4f6',
                  alignItems: 'center',
                }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                    {p.income > 0 ? formatCurrency(p.income) : '—'}
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                    {p.expenses < 0 ? `(${formatCurrency(Math.abs(p.expenses))})` : '—'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: p.net >= 0 ? '#2563a8' : '#d97706', fontVariantNumeric: 'tabular-nums' }}>
                    {p.net >= 0 ? '+' : ''}{formatCurrency(p.net)}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
