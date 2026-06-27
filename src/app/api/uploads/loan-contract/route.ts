import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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
    .from('property_owners').select('id, role').eq('property_id', propertyId).eq('user_id', user.id).single()
  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  try {
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    const fileBlock = isPDF
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: `You are parsing an Australian bank home loan Letter of Offer or Loan Contract document. Extract the key loan terms.

Return ONLY this JSON — no markdown, no explanation:
{
  "lender": string (bank/lender name, e.g. "CBA", "ANZ", "Westpac", "NAB", "Macquarie"),
  "account_suffix": string or null (loan account number or last 3-4 digits — may not be finalised yet at offer stage),
  "loan_limit": number or null (approved loan amount / credit limit, e.g. 700000),
  "interest_rate": number or null (initial interest rate as a percentage, e.g. 6.24 for 6.24% p.a.),
  "rate_type": "variable" or "fixed" or null,
  "repayment_type": "principal_and_interest" or "interest_only" or null,
  "loan_term_years": number or null (total loan term in years, e.g. 30),
  "io_period_years": number or null (interest only period in years, if applicable — null if P&I),
  "io_expiry_date": "YYYY-MM-DD" or null (date interest only period ends — calculate from settlement date + io_period_years if both known),
  "fixed_rate_expiry": "YYYY-MM-DD" or null (date fixed rate reverts — shown directly or calculated from settlement + fixed period),
  "purpose": "investment" or "owner_occupied" or null (loan purpose if stated),
  "security_addresses": [string] (full property addresses listed as security for this loan — empty array if none found)
}

Rules:
- loan_limit is the total approved credit facility, not repayment amount
- If the document shows a proposed/estimated settlement date use it to calculate io_expiry_date or fixed_rate_expiry where applicable
- rate_type: look for "variable rate", "fixed rate", "introductory rate" etc.
- Return null for any field not clearly stated in the document`,
          },
        ],
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    let parsed: {
      lender?: string; account_suffix?: string | null; loan_limit?: number | null
      interest_rate?: number | null; rate_type?: string | null; repayment_type?: string | null
      loan_term_years?: number | null; io_period_years?: number | null; io_expiry_date?: string | null
      fixed_rate_expiry?: string | null; purpose?: string | null; security_addresses?: string[]
    }
    try {
      const clean = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Could not parse document — try a clearer PDF' }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      lender: parsed.lender ?? null,
      account_suffix: parsed.account_suffix ?? null,
      loan_limit: (parsed.loan_limit != null && !isNaN(Number(parsed.loan_limit))) ? Number(parsed.loan_limit) : null,
      interest_rate: (parsed.interest_rate != null && !isNaN(Number(parsed.interest_rate))) ? Number(parsed.interest_rate) : null,
      rate_type: parsed.rate_type ?? null,
      repayment_type: parsed.repayment_type ?? null,
      loan_term_years: (parsed.loan_term_years != null && !isNaN(Number(parsed.loan_term_years))) ? Number(parsed.loan_term_years) : null,
      io_period_years: (parsed.io_period_years != null && !isNaN(Number(parsed.io_period_years))) ? Number(parsed.io_period_years) : null,
      io_expiry_date: parsed.io_expiry_date ?? null,
      fixed_rate_expiry: parsed.fixed_rate_expiry ?? null,
      purpose: parsed.purpose ?? null,
      security_addresses: parsed.security_addresses ?? [],
    })
  } catch {
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
