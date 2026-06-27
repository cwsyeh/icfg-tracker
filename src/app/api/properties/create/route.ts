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

  const { data: profile } = await adminSupabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const body = await request.json()
  const {
    name, street_address, suburb, state, postcode,
    usage, mixed_use_investment_percent,
    property_type,
    purchase_date, purchase_price,
    // h&l / construction
    land_value, construction_builder, construction_contract_amount,
    construction_start_date, capitalise_construction_interest, construction_status,
    // ownership
    ownership_pct,
    // acquisition costs
    acquisition_costs,
  } = body as {
    name: string
    street_address: string
    suburb: string
    state: string
    postcode: string
    usage: string
    mixed_use_investment_percent?: number | null
    property_type: string
    purchase_date?: string | null
    purchase_price?: number | null
    land_value?: number | null
    construction_builder?: string | null
    construction_contract_amount?: number | null
    construction_start_date?: string | null
    capitalise_construction_interest?: boolean
    construction_status?: string | null
    ownership_pct?: number
    acquisition_costs?: { type: string; amount: number; description?: string | null }[]
  }

  if (!name || !street_address || !suburb || !state || !postcode || !usage || !property_type) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (usage === 'mixed' && (mixed_use_investment_percent == null || mixed_use_investment_percent <= 0 || mixed_use_investment_percent >= 100)) {
    return NextResponse.json({ error: 'Mixed-use properties require an investment percentage between 1 and 99' }, { status: 400 })
  }

  const { data: property, error: propError } = await adminSupabase
    .from('properties')
    .insert({
      tenant_id: profile.tenant_id,
      name,
      street_address,
      suburb,
      state,
      postcode,
      usage,
      mixed_use_investment_percent: mixed_use_investment_percent ?? null,
      property_type,
      purchase_date: purchase_date ?? null,
      purchase_price: purchase_price ?? null,
      land_value: land_value ?? null,
      construction_builder: construction_builder ?? null,
      construction_contract_amount: construction_contract_amount ?? null,
      construction_start_date: construction_start_date ?? null,
      capitalise_construction_interest: capitalise_construction_interest ?? false,
      construction_status: construction_status ?? null,
      status: 'active',
    })
    .select('id')
    .single()

  if (propError) return NextResponse.json({ error: propError.message }, { status: 500 })

  // Create ownership record
  const { error: ownerError } = await adminSupabase
    .from('property_owners')
    .insert({ property_id: property.id, user_id: user.id, share_percentage: ownership_pct ?? 100 })

  if (ownerError) {
    await adminSupabase.from('properties').delete().eq('id', property.id)
    return NextResponse.json({ error: ownerError.message }, { status: 500 })
  }

  // Save acquisition costs if provided
  if (acquisition_costs && acquisition_costs.length > 0) {
    const rows = acquisition_costs.map(c => ({
      property_id: property.id,
      type: c.type,
      amount: c.amount,
      description: c.description ?? null,
      date: purchase_date ?? null,
    }))
    await adminSupabase.from('property_acquisition_costs').insert(rows)
  }

  return NextResponse.json({ success: true, property_id: property.id })
}
