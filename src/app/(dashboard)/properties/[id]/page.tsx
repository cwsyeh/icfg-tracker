import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { calculateLoanBalance, getIOExpiryDate, formatCurrency } from '@/lib/utils/finance'
import type { Property, Loan, Valuation, Transaction, DepreciationSchedule, PropertyOwner, LoanBalance, LoanSecurity } from '@/lib/types/database'
import PropertyTabs from '@/components/property/PropertyTabs'
import { fetchAll } from '@/lib/supabase/paginate'

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Verify ownership
  const { data: ownership } = await supabase
    .from('property_owners')
    .select('share_percentage')
    .eq('property_id', id)
    .eq('user_id', user.id)
    .single()

  if (!ownership) notFound()

  // Fetch all property data in parallel — use fetchAll for transactions (can exceed 1000 rows)
  const [
    { data: property },
    { data: valuations },
    { data: loans },
    transactions,
    { data: depreciation },
  ] = await Promise.all([
    supabase.from('properties').select('*').eq('id', id).single(),
    supabase.from('valuations').select('*').eq('property_id', id).order('valuation_date', { ascending: false }).range(0, 9999),
    supabase.from('loans').select('*').eq('tax_property_id', id).order('start_date', { ascending: true }).range(0, 9999),
    fetchAll<Transaction>((from, to) =>
      supabase.from('transactions').select('*').eq('property_id', id).order('transaction_date', { ascending: false }).range(from, to)
    ),
    supabase.from('depreciation_schedules').select('*').eq('property_id', id).order('financial_year', { ascending: false }).range(0, 9999),
  ])

  const loanIds = (loans ?? []).map((l: Loan) => l.id)

  const { data: loanBalances } = loanIds.length > 0
    ? await supabase.from('loan_balances').select('*').in('loan_id', loanIds).order('balance_date', { ascending: true }).range(0, 9999)
    : { data: [] }

  // Loan securities (which properties secure which loan)
  const { data: loanSecurities } = loanIds.length > 0
    ? await supabase.from('loan_securities').select('*').in('loan_id', loanIds).range(0, 9999)
    : { data: [] }

  // All properties the user owns (for security editor dropdown)
  const { data: userPropertyOwnership } = await supabase
    .from('property_owners').select('property_id').eq('user_id', user.id)
  const allUserPropIds = (userPropertyOwnership ?? []).map((o: { property_id: string }) => o.property_id)
  const { data: userProperties } = allUserPropIds.length > 0
    ? await supabase.from('properties').select('id, name').in('id', allUserPropIds)
    : { data: [] }

  if (!property) notFound()

  // OTP: fall back to deposit_paid as current value proxy when no formal valuation exists
  const latestValuation = (valuations ?? [])[0]?.amount ??
    (property?.property_type === 'off_the_plan' ? (property?.deposit_paid ?? null) : null)

  // Latest valuation per security property (for real LVR calculation)
  const securityPropIds = [...new Set((loanSecurities ?? []).map((ls: LoanSecurity) => ls.property_id))]
    .filter(pid => pid !== id)  // exclude current property — already have its valuation
  const { data: securityValsRaw } = securityPropIds.length > 0
    ? await supabase.from('valuations').select('property_id, amount, valuation_date')
        .in('property_id', securityPropIds).order('valuation_date', { ascending: false })
    : { data: [] }
  const latestSecurityValuations: Record<string, number> = {}
  ;(securityValsRaw ?? []).forEach((v: { property_id: string; amount: number; valuation_date: string }) => {
    if (!(v.property_id in latestSecurityValuations)) latestSecurityValuations[v.property_id] = Number(v.amount)
  })
  if (latestValuation !== null) latestSecurityValuations[id] = latestValuation

  // Enrich loans with calculated balances and IO expiry.
  // Priority: actual_balance (from statement/manual) > formula
  const enrichedLoans = (loans ?? []).map((l: Loan) => {
    const current_balance = l.actual_balance !== null && l.actual_balance !== undefined
      ? Number(l.actual_balance)
      : calculateLoanBalance({
          originalAmount: l.original_amount,
          annualRate: l.interest_rate,
          termYears: l.loan_term_years,
          startDate: l.start_date,
          repaymentType: l.repayment_type,
          ioExpiryDate: l.io_expiry_date,
          ioPeriodYears: l.io_period_years ?? 0,
        })
    return {
      ...l,
      current_balance,
      io_expiry_date: l.io_expiry_date ?? getIOExpiryDate(l.start_date, l.io_period_years),
    }
  })

  const totalLoanBalance = enrichedLoans.filter(l => l.status !== 'closed').reduce((s, l) => s + l.current_balance, 0)
  const equity = latestValuation !== null ? latestValuation - totalLoanBalance : null
  const ltv = latestValuation ? Math.round((totalLoanBalance / latestValuation) * 100) : null

  return (
    <PropertyTabs
      property={property as Property}
      sharePercentage={(ownership as PropertyOwner).share_percentage}
      valuations={(valuations ?? []) as Valuation[]}
      loans={enrichedLoans}
      loanBalances={(loanBalances ?? []) as LoanBalance[]}
      loanSecurities={(loanSecurities ?? []) as LoanSecurity[]}
      userProperties={(userProperties ?? []) as Pick<Property, 'id' | 'name'>[]}
      latestSecurityValuations={latestSecurityValuations}
      transactions={(transactions ?? []) as Transaction[]}
      depreciation={(depreciation ?? []) as DepreciationSchedule[]}
      latestValuation={latestValuation}
      totalLoanBalance={totalLoanBalance}
      equity={equity}
      ltv={ltv}
    />
  )
}
