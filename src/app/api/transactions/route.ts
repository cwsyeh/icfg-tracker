import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies()

  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const { ids, propertyId } = await request.json() as { ids: string[]; propertyId: string }
  if (!ids?.length || !propertyId) {
    return NextResponse.json({ error: 'Missing ids or propertyId' }, { status: 400 })
  }

  // Verify user owns the property before deleting
  const { data: ownership } = await supabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  const { error } = await supabase
    .from('transactions')
    .delete()
    .in('id', ids)
    .eq('property_id', propertyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, deleted: ids.length })
}
