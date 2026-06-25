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

  const { propertyId, confirm } = await request.json() as { propertyId: string; confirm: string }
  if (!propertyId) return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 })

  // Verify ownership
  const { data: ownership } = await adminSupabase
    .from('property_owners').select('id').eq('property_id', propertyId).eq('user_id', user.id).single()
  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  // Fetch property to validate confirmation name
  const { data: property } = await adminSupabase
    .from('properties').select('name').eq('id', propertyId).single()
  if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 })
  }

  // Pre-check: loans linked to this property as tax_property_id
  const { data: loans } = await adminSupabase
    .from('loans').select('id, lender, account_suffix').eq('tax_property_id', propertyId)
  if (loans && loans.length > 0) {
    const names = loans.map((l: { lender: string; account_suffix: string | null }) => `${l.lender}${l.account_suffix ? ` ···${l.account_suffix}` : ''}`).join(', ')
    return NextResponse.json({
      error: `Cannot delete — ${loans.length} loan${loans.length > 1 ? 's' : ''} (${names}) are linked to this property. Delete the loan${loans.length > 1 ? 's' : ''} first.`,
      loans_exist: true,
    }, { status: 409 })
  }

  // Pre-check: loan_securities referencing this property
  const { data: securities } = await adminSupabase
    .from('loan_securities').select('loan_id').eq('property_id', propertyId)
  if (securities && securities.length > 0) {
    return NextResponse.json({
      error: `Cannot delete — this property is used as security on ${securities.length} loan${securities.length > 1 ? 's' : ''}. Remove it as a security first.`,
      loans_exist: true,
    }, { status: 409 })
  }

  // Safe to delete — cascades handle the rest
  const { error } = await adminSupabase.from('properties').delete().eq('id', propertyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
