import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyOwnership(propertyId: string, userId: string) {
  const { data } = await adminSupabase
    .from('property_owners').select('id').eq('property_id', propertyId).eq('user_id', userId).single()
  return !!data
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const propertyId = request.nextUrl.searchParams.get('propertyId')
  if (!propertyId) return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 })
  if (!await verifyOwnership(propertyId, user.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { data, error } = await adminSupabase
    .from('property_sale_costs')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ costs: data })
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await request.json()
  const { propertyId, costs } = body as { propertyId: string; costs: { type: string; amount: number; description?: string; date?: string }[] }

  if (!propertyId || !Array.isArray(costs)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!await verifyOwnership(propertyId, user.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  await adminSupabase.from('property_sale_costs').delete().eq('property_id', propertyId)

  if (costs.length > 0) {
    const rows = costs.map(c => ({ property_id: propertyId, type: c.type, amount: c.amount, description: c.description ?? null, date: c.date ?? null }))
    const { error } = await adminSupabase.from('property_sale_costs').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
