import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { property_id, financial_year, division_43_amount, plant_equipment_amount, source, notes } = body
    if (!property_id || !financial_year) return Response.json({ error: 'Missing required fields' }, { status: 400 })

    const { data: ownership } = await supabase
      .from('property_owners')
      .select('id, role')
      .eq('property_id', property_id)
      .eq('user_id', user.id)
      .single()
    if (!ownership) return Response.json({ error: 'Property not found' }, { status: 404 })
    if (ownership.role === 'viewer') return Response.json({ error: 'View-only access' }, { status: 403 })

    const { data, error } = await supabase
      .from('depreciation_schedules')
      .upsert({
        property_id,
        financial_year,
        division_43_amount: Number(division_43_amount) || 0,
        plant_equipment_amount: Number(plant_equipment_amount) || 0,
        source: source || null,
        notes: notes || null,
      }, { onConflict: 'property_id,financial_year' })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const { data: schedule } = await supabase
      .from('depreciation_schedules')
      .select('property_id')
      .eq('id', id)
      .single()
    if (!schedule) return Response.json({ error: 'Not found' }, { status: 404 })

    const { data: ownership } = await supabase
      .from('property_owners')
      .select('id')
      .eq('property_id', schedule.property_id)
      .eq('user_id', user.id)
      .single()
    if (!ownership) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { error } = await supabase.from('depreciation_schedules').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
