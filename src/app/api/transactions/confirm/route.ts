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

  let propertyId: string, jobId: string | null, transactions: Array<{
    transaction_date: string; type: string; amount: number; description: string | null; ownership_note: string | null
  }>

  try {
    const body = await request.json()
    propertyId = body.propertyId
    jobId = body.jobId ?? null
    transactions = body.transactions
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!propertyId || !transactions?.length) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const rows = transactions.map(t => ({
    property_id: propertyId,
    transaction_date: t.transaction_date,
    type: t.type,
    amount: Number(t.amount),
    description: t.description || null,
    ownership_note: t.ownership_note || null,
    financial_year: getFinancialYear(t.transaction_date),
    source: 'rental_statement_parsed' as const,
  }))

  const { error } = await adminSupabase.from('transactions').insert(rows)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (jobId) {
    await adminSupabase.from('upload_jobs').update({
      status: 'completed',
      transactions_created: rows.length,
    }).eq('id', jobId)
  }

  return NextResponse.json({ success: true, transactions_created: rows.length })
}
