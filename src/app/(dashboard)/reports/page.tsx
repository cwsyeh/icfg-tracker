import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { calculateLoanBalance, getIOExpiryDate } from '@/lib/utils/finance'
import type { Property, Loan, Transaction, Valuation, DepreciationSchedule, PropertyAcquisitionCost, PropertySaleCost, LoanSecurity, ConstructionProgressPayment } from '@/lib/types/database'
import ReportsPage from '@/components/reports/ReportsPage'

// PostgREST max-rows caps at 1000 regardless of .limit(). Paginate to get all rows.
async function fetchAllTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyIds: string[]
): Promise<Transaction[]> {
  const PAGE = 1000
  const all: Transaction[] = []
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .in('property_id', propertyIds)
      .order('transaction_date', { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (!data || data.length === 0) break
    all.push(...(data as Transaction[]))
    if (data.length < PAGE) break
    page++
  }
  return all
}

export default async function Reports() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('full_name').eq('id', user.id).single()

  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(*)')
    .eq('user_id', user.id)

  const propertyIds = (ownerships ?? []).map(o => (o.properties as unknown as Property).id)

  if (propertyIds.length === 0) {
    return (
      <ReportsPage
        properties={[]}
        ownerName={profile?.full_name ?? ''}
        generatedAt={new Date().toISOString()}
      />
    )
  }

  const [
    { data: valuations },
    { data: loans },
    transactions,
    { data: depreciation },
    { data: acquisitionCosts },
    { data: progressPayments },
    { data: saleCosts },
  ] = await Promise.all([
    supabase.from('valuations').select('*').in('property_id', propertyIds).order('valuation_date', { ascending: false }).range(0, 9999),
    supabase.from('loans').select('*').in('tax_property_id', propertyIds).range(0, 9999),
    fetchAllTransactions(supabase, propertyIds),
    supabase.from('depreciation_schedules').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('property_acquisition_costs').select('*').in('property_id', propertyIds).range(0, 9999),
    supabase.from('construction_progress_payments').select('*').in('property_id', propertyIds).order('sort_order', { ascending: true }).range(0, 9999),
    supabase.from('property_sale_costs').select('*').in('property_id', propertyIds).range(0, 9999),
  ])

  // Fetch loan securities for all loans
  const loanIds = (loans ?? []).map(l => l.id)
  const { data: loanSecurities } = loanIds.length > 0
    ? await supabase.from('loan_securities').select('*').in('loan_id', loanIds).range(0, 9999)
    : { data: [] as LoanSecurity[] }

  // Build property name lookup for securities display
  const propertyNameMap: Record<string, string> = {}
  for (const o of ownerships ?? []) {
    const prop = o.properties as unknown as Property
    propertyNameMap[prop.id] = prop.name
  }

  const enrichedProperties = (ownerships ?? []).map(o => {
    const prop = o.properties as unknown as Property
    const propLoans = (loans ?? []).filter(l => l.tax_property_id === prop.id) as Loan[]
    const propValuations = (valuations ?? []).filter(v => v.property_id === prop.id) as Valuation[]

    const latestValuation = propValuations[0]?.amount ?? null
    const purchaseCostFallback = (prop.purchase_price ?? 0) +
      (prop.property_type === 'house_and_land' ? (prop.construction_contract_amount ?? 0) : 0)
    // Sold: use sold_price; OTP pre-completion: use deposit_paid (nil if not set)
    const displayVal = prop.status === 'sold'
      ? (prop.sold_price ?? latestValuation ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null))
      : prop.property_type === 'off_the_plan' && prop.construction_status !== 'completed'
        ? (prop.deposit_paid ?? null)
        : (latestValuation ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null))

    const activeLoans = propLoans.filter(l => l.status === 'active').map(l => {
      const currentBalance = l.actual_balance !== null && l.actual_balance !== undefined
        ? Number(l.actual_balance)
        : calculateLoanBalance({
            originalAmount: l.original_amount,
            annualRate: l.interest_rate,
            termYears: l.loan_term_years,
            startDate: l.start_date,
            repaymentType: l.repayment_type,
            ioPeriodYears: l.io_period_years ?? 0,
          })

      // Linked securities: properties securing this loan (excluding the tax property itself)
      const secs = (loanSecurities ?? [])
        .filter(s => s.loan_id === l.id)
        .map(s => ({ propertyId: s.property_id, propertyName: propertyNameMap[s.property_id] ?? s.property_id }))

      return {
        ...l,
        currentBalance,
        ioExpiryDate: l.io_expiry_date ?? getIOExpiryDate(l.start_date, l.io_period_years),
        securities: secs,
      }
    })

    return {
      property: prop,
      sharePercent: o.share_percentage,
      latestValuation: displayVal,
      isValFallback: latestValuation === null && displayVal !== null,
      activeLoans,
      allTransactions: transactions.filter(t => t.property_id === prop.id) as Transaction[],
      depreciation: ((depreciation ?? []).filter(d => d.property_id === prop.id) as DepreciationSchedule[]),
      allValuations: propValuations,
      acquisitionCosts: ((acquisitionCosts ?? []).filter(c => c.property_id === prop.id) as PropertyAcquisitionCost[]),
      saleCosts: ((saleCosts ?? []).filter(c => c.property_id === prop.id) as PropertySaleCost[]),
      progressPayments: ((progressPayments ?? []).filter(pp => pp.property_id === prop.id) as ConstructionProgressPayment[]),
      loans: propLoans,
    }
  })

  return (
    <ReportsPage
      properties={enrichedProperties}
      ownerName={profile?.full_name ?? ''}
      generatedAt={new Date().toISOString()}
    />
  )
}
