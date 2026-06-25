import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getUser() {
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  return (await anonSupabase.auth.getUser()).data.user
}

async function verifyOwnership(propertyId: string, userId: string) {
  const { data } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', userId)
    .single()
  return !!data
}

// GET /api/construction/progress-payments?propertyId=...
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const propertyId = request.nextUrl.searchParams.get('propertyId')
  if (!propertyId) return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 })

  if (!await verifyOwnership(propertyId, user.id))
    return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const { data, error } = await adminSupabase
    .from('construction_progress_payments')
    .select('*')
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ payments: data })
}

// POST /api/construction/progress-payments — create
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.propertyId || !body?.stage_name)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  if (!await verifyOwnership(body.propertyId, user.id))
    return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const { data, error } = await adminSupabase
    .from('construction_progress_payments')
    .insert({
      property_id: body.propertyId,
      stage_name: body.stage_name,
      amount: body.amount ?? null,
      scheduled_date: body.scheduled_date ?? null,
      drawn_date: body.drawn_date ?? null,
      sort_order: body.sort_order ?? 0,
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ payment: data })
}

// PATCH /api/construction/progress-payments — update
export async function PATCH(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.id || !body?.propertyId)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  if (!await verifyOwnership(body.propertyId, user.id))
    return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const allowed = ['stage_name', 'amount', 'scheduled_date', 'drawn_date', 'sort_order', 'notes', 'bank_amount', 'self_amount']
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

  const { error } = await adminSupabase
    .from('construction_progress_payments')
    .update(updates)
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE /api/construction/progress-payments — delete
export async function DELETE(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.id || !body?.propertyId)
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  if (!await verifyOwnership(body.propertyId, user.id))
    return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const { error } = await adminSupabase
    .from('construction_progress_payments')
    .delete()
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
