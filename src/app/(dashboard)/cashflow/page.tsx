import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Property, Transaction } from '@/lib/types/database'
import CashflowDashboard from '@/components/cashflow/CashflowDashboard'
import type { FYRow, MonthlyRow, FYDetail } from '@/components/cashflow/CashflowDashboard'
import { fetchAll } from '@/lib/supabase/paginate'

const RENT_TYPES = new Set(['rent_income'])
const INCOME_TYPES = new Set(['rent_income', 'other_income'])
const INTEREST_TYPES = new Set(['interest_expense'])
const EXPENSE_TYPES = new Set([
  'interest_expense', 'council_rates', 'water_rates', 'insurance',
  'property_management_fee', 'repairs_maintenance', 'advertising',
  'legal_fees', 'bank_fees', 'strata_body_corp',
  'land_tax', 'borrowing_expenses', 'cleaning', 'other_expense',
])
const NON_CASH_TYPES = new Set(['depreciation'])
const CAPITAL_TYPES = new Set(['capital_expense', 'principal_payment'])

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function CashflowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(id, name, usage)')
    .eq('user_id', user.id)

  const properties = (ownerships ?? []).map(o => {
    const p = o.properties as unknown as Property
    return { id: p.id, name: p.name, usage: p.usage, sharePercent: o.share_percentage }
  })
  const propertyIds = properties.map(p => p.id)

  if (propertyIds.length === 0) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ fontSize: 14, color: '#9ca3af' }}>No properties yet — add one from the Portfolio page.</div>
      </div>
    )
  }

  const txs = await fetchAll<Transaction>((from, to) =>
    supabase.from('transactions').select('*')
      .in('property_id', propertyIds)
      .order('transaction_date', { ascending: true })
      .range(from, to)
  )

  const propNameMap: Record<string, string> = {}
  properties.forEach(p => { propNameMap[p.id] = p.name })

  const fyMap: Record<string, FYRow> = {}
  const monthMap: Record<string, MonthlyRow> = {}

  for (const tx of txs) {
    const fy = tx.financial_year
    if (!fyMap[fy]) {
      fyMap[fy] = {
        fy, income: 0, expenses: 0, depreciation: 0, capital: 0, net: 0,
        detail: { rentIncome: 0, otherIncome: 0, interestExpense: 0, otherExpenses: 0, depreciation: 0, capital: 0 },
        byProperty: {},
      }
    }
    const fyRow = fyMap[fy]
    const propId = tx.property_id
    if (!fyRow.byProperty[propId]) {
      fyRow.byProperty[propId] = { name: propNameMap[propId] ?? propId, income: 0, expenses: 0, net: 0 }
    }
    const pRow = fyRow.byProperty[propId]
    const amt = Number(tx.amount)

    // Monthly grouping (only income + cash expenses)
    if (INCOME_TYPES.has(tx.type) || EXPENSE_TYPES.has(tx.type)) {
      const d = new Date(tx.transaction_date + 'T00:00:00')
      const yr = d.getFullYear()
      const mo = d.getMonth() + 1
      const monthKey = `${yr}-${String(mo).padStart(2, '0')}`
      if (!monthMap[monthKey]) {
        const fyYear = mo >= 7 ? yr + 1 : yr
        const fyForMonth = `FY${String(fyYear).slice(-2)}`
        const shortYr = String(yr).slice(-2)
        monthMap[monthKey] = {
          month: monthKey,
          monthLabel: `${MONTH_LABELS[mo - 1]} '${shortYr}`,
          fy: fyForMonth,
          income: 0, expenses: 0, net: 0,
        }
      }
      if (INCOME_TYPES.has(tx.type)) monthMap[monthKey].income += amt
      else monthMap[monthKey].expenses += amt
      monthMap[monthKey].net = monthMap[monthKey].income + monthMap[monthKey].expenses
    }

    // FY categorisation
    if (INCOME_TYPES.has(tx.type)) {
      fyRow.income += amt
      pRow.income += amt
      if (RENT_TYPES.has(tx.type)) fyRow.detail.rentIncome += amt
      else fyRow.detail.otherIncome += amt
    } else if (EXPENSE_TYPES.has(tx.type)) {
      fyRow.expenses += amt
      pRow.expenses += amt
      if (INTEREST_TYPES.has(tx.type)) fyRow.detail.interestExpense += amt
      else fyRow.detail.otherExpenses += amt
    } else if (NON_CASH_TYPES.has(tx.type)) {
      fyRow.depreciation += amt
      fyRow.detail.depreciation += amt
    } else if (CAPITAL_TYPES.has(tx.type)) {
      fyRow.capital += amt
      fyRow.detail.capital += amt
    }
    pRow.net = pRow.income + pRow.expenses
  }

  const fyRows: FYRow[] = Object.values(fyMap)
    .map(r => ({ ...r, net: r.income + r.expenses }))
    .sort((a, b) => b.fy.localeCompare(a.fy))

  const monthlyData: MonthlyRow[] = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))

  // Annual chart: oldest → newest
  const chartData = [...fyRows]
    .reverse()
    .map(r => ({ fy: r.fy, income: r.income, expenses: Math.abs(r.expenses), net: r.net }))

  const fyDetail: Record<string, FYDetail> = {}
  fyRows.forEach(r => { fyDetail[r.fy] = r.detail })

  return (
    <CashflowDashboard
      fyRows={fyRows}
      monthlyData={monthlyData}
      chartData={chartData}
      fyDetail={fyDetail}
      properties={properties}
    />
  )
}
