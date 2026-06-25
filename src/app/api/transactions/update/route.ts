import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFinancialYear } from '@/lib/utils/finance'

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

  let id: string, propertyId: string, updates: Record<string, unknown>
  try {
    const body = await request.json()
    id = body.id
    propertyId = body.propertyId
    updates = body.updates
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!id || !propertyId || !updates) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify ownership
  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  // Recalculate FY if date changed
  if (updates.transaction_date) {
    updates.financial_year = getFinancialYear(updates.transaction_date as string)
  }

  // Don't mark manually_edited when only toggling capitalised flag
  const onlyCapitalisedToggle = Object.keys(updates).length === 1 && 'capitalised' in updates
  if (!onlyCapitalisedToggle) updates.manually_edited = true

  const { error } = await adminSupabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .eq('property_id', propertyId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
