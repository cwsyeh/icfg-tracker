import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

  let loanId: string, propertyId: string, actualBalance: number, balanceDate: string, newRate: number | null
  try {
    const body = await request.json()
    loanId = body.loanId
    propertyId = body.propertyId
    actualBalance = Number(body.actualBalance)
    balanceDate = body.balanceDate
    newRate = body.newRate != null ? Number(body.newRate) : null
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!loanId || !propertyId || isNaN(actualBalance) || !balanceDate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify user owns the linked property
  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  // Verify loan belongs to this property
  const { data: loan } = await adminSupabase
    .from('loans')
    .select('id')
    .eq('id', loanId)
    .eq('tax_property_id', propertyId)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const loanUpdate: Record<string, unknown> = { actual_balance: actualBalance, balance_date: balanceDate }
  if (newRate !== null && !isNaN(newRate) && newRate > 0) {
    loanUpdate.interest_rate = newRate
    loanUpdate.rate_effective_date = balanceDate
  }

  const { error } = await adminSupabase
    .from('loans')
    .update(loanUpdate)
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { error: lbErr } = await adminSupabase.from('loan_balances').upsert(
    { loan_id: loanId, balance_date: balanceDate, balance: actualBalance, source: 'manual' },
    { onConflict: 'loan_id,balance_date' }
  )
  if (lbErr) console.error('[update-balance] loan_balances upsert failed:', lbErr.message)

  return NextResponse.json({ success: true })
}
