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

  let loanId: string, propertyId: string
  let securityPropertyIds: string[]
  let outsideSecurityDescription: string | null, outsideSecurityValue: number | null

  try {
    const body = await request.json()
    loanId = body.loanId
    propertyId = body.propertyId
    securityPropertyIds = Array.isArray(body.securityPropertyIds) ? body.securityPropertyIds : []
    outsideSecurityDescription = body.outsideSecurityDescription ?? null
    outsideSecurityValue = body.outsideSecurityValue != null ? Number(body.outsideSecurityValue) : null
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!loanId || !propertyId) return NextResponse.json({ error: 'Missing loanId or propertyId' }, { status: 400 })

  // Verify user owns the linked property
  const { data: ownership } = await adminSupabase
    .from('property_owners').select('id, role').eq('property_id', propertyId).eq('user_id', user.id).single()
  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  // Verify loan belongs to this property
  const { data: loan } = await adminSupabase
    .from('loans').select('id').eq('id', loanId).eq('tax_property_id', propertyId).single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Replace loan_securities: delete existing, insert new
  const { error: delErr } = await adminSupabase.from('loan_securities').delete().eq('loan_id', loanId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (securityPropertyIds.length > 0) {
    const rows = securityPropertyIds.map(pid => ({ loan_id: loanId, property_id: pid }))
    const { error: insErr } = await adminSupabase.from('loan_securities').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Update outside security fields on the loan
  const { error: updateErr } = await adminSupabase.from('loans')
    .update({ outside_security_description: outsideSecurityDescription, outside_security_value: outsideSecurityValue })
    .eq('id', loanId)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
