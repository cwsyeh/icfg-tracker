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

  let id: string, propertyId: string, valuation_date: string, amount: number, type: string, source: string | null, notes: string | null
  try {
    const body = await request.json()
    id = body.id
    propertyId = body.propertyId
    valuation_date = body.valuation_date
    amount = body.amount
    type = body.type
    source = body.source ?? null
    notes = body.notes ?? null
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!id || !propertyId || !valuation_date || !type || amount === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const { error } = await adminSupabase
    .from('valuations')
    .update({ valuation_date, amount, type, source: source || null, notes: notes || null })
    .eq('id', id)
    .eq('property_id', propertyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
