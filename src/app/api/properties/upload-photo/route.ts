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

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const propertyId = formData.get('propertyId') as string | null

  if (!file || !propertyId) return NextResponse.json({ error: 'Missing file or propertyId' }, { status: 400 })

  const { data: ownership } = await adminSupabase
    .from('property_owners').select('id').eq('property_id', propertyId).eq('user_id', user.id).single()
  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${propertyId}/cover.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await adminSupabase.storage
    .from('property-photos')
    .upload(path, arrayBuffer, { contentType: file.type, upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: { publicUrl } } = adminSupabase.storage.from('property-photos').getPublicUrl(path)

  // Cache-bust with a timestamp so the browser fetches the new image
  const photoUrl = `${publicUrl}?t=${Date.now()}`

  const { error: updateError } = await adminSupabase
    .from('properties').update({ photo_url: photoUrl }).eq('id', propertyId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ success: true, photo_url: photoUrl })
}
