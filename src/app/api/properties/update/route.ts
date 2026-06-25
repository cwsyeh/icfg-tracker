import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const adminSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED = [
  'name', 'street_address', 'suburb', 'state', 'postcode', 'usage', 'mixed_use_investment_percent', 'notes',
  'status', 'purchase_date', 'purchase_price', 'sold_date', 'sold_price',
  'broker_name', 'broker_phone', 'broker_email', 'broker_company', 'broker_license',
  'pm_agency', 'pm_name', 'pm_phone', 'pm_email', 'pm_fee_percent', 'lease_expiry_date',
  'insurance_provider', 'insurance_policy_number', 'insurance_expiry', 'insurance_premium',
  'property_type', 'land_value', 'construction_builder', 'construction_contract_amount',
  'construction_start_date', 'construction_completion_date', 'construction_status',
  'capitalise_construction_interest',
]

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let propertyId: string, updates: Record<string, unknown>
  try {
    const body = await request.json()
    propertyId = body.propertyId
    updates = body.updates
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!propertyId || !updates || Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  const safe = Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED.includes(k)))

  const { error } = await adminSupabase.from('properties').update(safe).eq('id', propertyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
