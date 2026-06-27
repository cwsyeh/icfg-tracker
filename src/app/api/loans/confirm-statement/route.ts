import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFinancialYear } from '@/lib/utils/finance'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let propertyId: string, loanId: string, jobId: string | null
  let balance: number, balanceDate: string, newRate: number | null
  let transactions: Array<{
    transaction_date: string; type: string; amount: number; description: string | null; ownership_note: string | null
  }>
  let balanceSnapshots: Array<{ date: string; balance: number }>

  try {
    const body = await request.json()
    propertyId = body.propertyId
    loanId = body.loanId
    jobId = body.jobId ?? null
    balance = Number(body.balance)
    balanceDate = body.balanceDate
    newRate = (body.newRate != null && !isNaN(Number(body.newRate))) ? Number(body.newRate) : null
    transactions = body.transactions ?? []
    balanceSnapshots = body.balanceSnapshots ?? []
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!propertyId || !loanId || isNaN(balance) || !balanceDate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Ownership check
  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  // Verify loan belongs to property
  const { data: loan } = await adminSupabase
    .from('loans')
    .select('id, role')
    .eq('id', loanId)
    .eq('tax_property_id', propertyId)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Update loan balance (and rate if provided)
  const loanUpdate: Record<string, unknown> = { actual_balance: balance, balance_date: balanceDate }
  if (newRate != null) {
    loanUpdate.interest_rate = newRate
    loanUpdate.rate_effective_date = balanceDate
  }
  const { error: balanceErr } = await adminSupabase
    .from('loans')
    .update(loanUpdate)
    .eq('id', loanId)

  if (balanceErr) return NextResponse.json({ error: balanceErr.message }, { status: 500 })

  // Upsert all balance snapshots (includes monthly running balances + closing balance)
  const snapshotRows = balanceSnapshots.length > 0
    ? balanceSnapshots.map(s => ({ loan_id: loanId, balance_date: s.date, balance: Number(s.balance), source: 'statement' as const }))
    : [{ loan_id: loanId, balance_date: balanceDate, balance, source: 'statement' as const }]
  const { error: lbErr } = await adminSupabase.from('loan_balances').upsert(snapshotRows, { onConflict: 'loan_id,balance_date' })
  if (lbErr) console.error('[confirm-statement] loan_balances upsert failed:', lbErr.message)

  // Insert transactions if any
  let transactionsCreated = 0
  if (transactions.length > 0) {
    const rows = transactions.map(t => ({
      property_id: propertyId,
      loan_id: loanId,
      transaction_date: t.transaction_date,
      type: t.type,
      amount: Number(t.amount),
      description: t.description || null,
      ownership_note: t.ownership_note || null,
      financial_year: getFinancialYear(t.transaction_date),
      source: 'loan_auto' as const,
    }))

    const { error: txErr } = await adminSupabase.from('transactions').insert(rows)
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })
    transactionsCreated = rows.length
  }

  if (jobId) {
    await adminSupabase.from('upload_jobs').update({
      status: 'completed',
      transactions_created: transactionsCreated,
    }).eq('id', jobId)
  }

  return NextResponse.json({ success: true, transactions_created: transactionsCreated })
}
