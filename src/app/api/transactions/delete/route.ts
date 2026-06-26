import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Bare service-role client — bypasses RLS without cookie interference
const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  // Authenticate via cookie
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let ids: string[], propertyId: string
  try {
    const body = await request.json()
    ids = body.ids
    propertyId = body.propertyId
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!ids?.length || !propertyId) {
    return NextResponse.json({ error: 'Missing ids or propertyId' }, { status: 400 })
  }

  // Verify user owns the property
  const { data: ownership, error: ownerErr } = await adminSupabase
    .from('property_owners')
    .select('id, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (ownerErr || !ownership) {
    return NextResponse.json({ error: 'Property not found or access denied' }, { status: 404 })
  }
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  // Delete the transactions
  const { error } = await adminSupabase
    .from('transactions')
    .delete()
    .in('id', ids)
    .eq('property_id', propertyId)

  if (error) {
    console.error('Transaction delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, deleted: ids.length })
}
