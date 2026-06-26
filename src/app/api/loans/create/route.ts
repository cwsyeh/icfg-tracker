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

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { propertyId, ...fields } = body
  if (!propertyId) return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 })

  // Verify ownership
  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  const allowed = [
    'lender', 'account_suffix', 'repayment_type', 'rate_type',
    'original_amount', 'loan_limit', 'interest_rate', 'loan_term_years',
    'io_period_years', 'io_expiry_date', 'start_date', 'fixed_rate_expiry',
    'purpose', 'deductible_portion_percent', 'refinanced_from_loan_id',
    'actual_balance', 'balance_date', 'status', 'notes',
  ]
  const safe: Record<string, unknown> = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k))
  )
  safe.tax_property_id = propertyId

  const { data: newLoan, error } = await adminSupabase
    .from('loans')
    .insert(safe)
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, loanId: newLoan.id })
}
