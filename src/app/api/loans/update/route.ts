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

  let loanId: string, propertyId: string, updates: Record<string, unknown>
  try {
    const body = await request.json()
    loanId = body.loanId
    propertyId = body.propertyId
    updates = body.updates
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!loanId || !propertyId || !updates) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify ownership
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

  // Whitelist editable fields
  const allowed = ['lender', 'account_suffix', 'repayment_type', 'rate_type', 'original_amount',
    'interest_rate', 'rate_effective_date', 'loan_term_years', 'io_period_years', 'io_expiry_date', 'start_date', 'fixed_rate_expiry', 'notes',
    'reforecast_balance', 'reforecast_date',
    'status', 'closed_date', 'purpose', 'deductible_portion_percent', 'loan_limit', 'refinanced_from_loan_id']
  const safe = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))

  const { error } = await adminSupabase.from('loans').update(safe).eq('id', loanId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
