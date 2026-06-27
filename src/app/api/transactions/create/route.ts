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

  let propertyId: string, transaction_date: string, type: string, amount: number, description: string | null, loan_id: string | null
  try {
    const body = await request.json()
    propertyId = body.propertyId
    transaction_date = body.transaction_date
    type = body.type
    amount = body.amount
    description = body.description ?? null
    loan_id = body.loan_id ?? null
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!propertyId || !transaction_date || !type || amount === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  if (loan_id) {
    const { data: loan } = await adminSupabase
      .from('loans')
      .select('id, role')
      .eq('id', loan_id)
      .eq('tax_property_id', propertyId)
      .single()
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  }

  const { error } = await adminSupabase.from('transactions').insert({
    property_id: propertyId,
    loan_id: loan_id || null,
    transaction_date,
    type,
    amount,
    description: description || null,
    financial_year: getFinancialYear(transaction_date),
    source: 'manual',
    manually_edited: false,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
