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

  let loanId: string, propertyId: string
  try {
    const body = await request.json()
    loanId = body.loanId
    propertyId = body.propertyId
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!loanId || !propertyId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Verify ownership
  const { data: ownership } = await adminSupabase
    .from('property_owners').select('id').eq('property_id', propertyId).eq('user_id', user.id).single()
  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  // Verify loan belongs to this property
  const { data: loan } = await adminSupabase
    .from('loans').select('id').eq('id', loanId).eq('tax_property_id', propertyId).single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Delete in order: securities → balance snapshots → transactions → loan
  await adminSupabase.from('loan_securities').delete().eq('loan_id', loanId)
  await adminSupabase.from('loan_balances').delete().eq('loan_id', loanId)
  await adminSupabase.from('transactions').delete().eq('loan_id', loanId).eq('property_id', propertyId)

  const { error } = await adminSupabase.from('loans').delete().eq('id', loanId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
