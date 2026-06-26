import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFinancialYear } from '@/lib/utils/finance'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Transaction types Claude can assign
const VALID_TYPES = [
  'rent_income', 'interest_expense', 'principal_payment',
  'council_rates', 'water_rates', 'insurance',
  'property_management_fee', 'repairs_maintenance', 'advertising',
  'legal_fees', 'bank_fees', 'strata_body_corp',
  'land_tax', 'borrowing_expenses', 'cleaning',
  'capital_expense', 'depreciation', 'other_income', 'other_expense',
]

export async function POST(request: NextRequest) {
  // Auth
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // service role to bypass RLS for inserts
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  // Get authenticated user from the anon client
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await anonSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Parse form data
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const propertyId = formData.get('propertyId') as string | null

  if (!file || !propertyId) {
    return NextResponse.json({ error: 'Missing file or propertyId' }, { status: 400 })
  }

  // Verify user owns this property
  const { data: ownership } = await supabase
    .from('property_owners')
    .select('share_percentage, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  // Create upload job record (best-effort audit trail — failure does not block upload)
  const { data: job, error: jobErr } = await supabase.from('upload_jobs').insert({
    property_id: propertyId,
    uploaded_by: user.id,
    type: 'rental_statement',
    original_filename: file.name,
    status: 'processing',
  }).select().single()

  if (jobErr) console.warn('upload_jobs insert failed (non-blocking):', jobErr.message)

  try {
    // Convert PDF to base64
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    // Build content block depending on file type
    const fileBlock = isPDF
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } }

    // Send to Claude for parsing
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: `You are parsing an Australian rental property statement. Extract all financial transactions and property manager details.

Return ONLY this JSON — no markdown, no explanation:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "type": one of: ${VALID_TYPES.join(', ')},
      "amount": number (positive for income, negative for expense),
      "description": "brief description"
    }
  ],
  "pm": {
    "agency": string or null (property management agency name, e.g. "Ray White Paddington"),
    "name": string or null (property manager contact name if shown),
    "phone": string or null,
    "email": string or null,
    "fee_percent": number or null (management fee as a percentage, e.g. 8.5 for 8.5% — derive from fee amount ÷ rent if not stated explicitly; null if cannot be determined)
  }
}

CRITICAL — the column/sign in the statement is the single source of truth for income vs expense. Never override it based on the description:
- Statements use "MONEY IN" / "MONEY OUT", or equivalent (Credits/Debits, Received/Paid, +/-). MONEY IN = positive amount. MONEY OUT = negative amount.
- A transaction under MONEY IN is always positive income, regardless of what the description says (even if it mentions water, repairs, rates, etc.).
- A transaction under MONEY OUT is always negative expense, regardless of what the description says.

Rules (use these to assign the correct type, but the sign always follows the column above):
- Rent → type: "rent_income"
- Management fees, letting fees, admin fees → type: "property_management_fee"
- Repairs, maintenance, trades → type: "repairs_maintenance"
- Water / sewerage → type: "water_rates" if under MONEY OUT; type: "other_income" if under MONEY IN
- Council rates → type: "council_rates"
- Insurance → type: "insurance"
- Advertising → type: "advertising"
- Strata/body corporate → type: "strata_body_corp"
- Anything else under MONEY IN → type: "other_income"
- Anything else under MONEY OUT → type: "other_expense"
- If a date is missing, use the statement period end date
- Include ALL line items including fees, do not summarise or skip any
- Amounts should be the actual dollar value (e.g. 1400.00, not "$1,400.00")`,
          },
        ],
      }],
    })

    // Parse Claude's response
    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    let parsed: { transactions: { date: string; type: string; amount: number; description: string }[]; pm?: { agency: string | null; name: string | null; phone: string | null; email: string | null; fee_percent: number | null } | null }

    try {
      const clean = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
      const result = JSON.parse(clean)
      // Support both old array format and new object format
      parsed = Array.isArray(result) ? { transactions: result } : result
    } catch {
      await supabase.from('upload_jobs').update({
        status: 'failed',
        error_message: 'Could not parse Claude response as JSON',
        processed_at: new Date().toISOString(),
      }).eq('id', job?.id)
      return NextResponse.json({ error: 'Parse error — try a clearer PDF' }, { status: 422 })
    }

    // Validate parsed rows
    const validRows = (parsed.transactions ?? [])
      .filter(t => t.date && t.amount !== undefined && VALID_TYPES.includes(t.type))
      .map(t => ({
        transaction_date: t.date,
        type: t.type,
        amount: Number(t.amount),
        description: t.description || null,
        ownership_note: ownership.share_percentage < 100
          ? `Your share: ${ownership.share_percentage}% of ${Math.abs(t.amount).toFixed(2)}`
          : null,
        financial_year: getFinancialYear(t.date),
      }))

    if (validRows.length === 0) {
      await supabase.from('upload_jobs').update({
        status: 'failed',
        error_message: 'No valid transactions found in document',
        processed_at: new Date().toISOString(),
      }).eq('id', job?.id)
      return NextResponse.json({ error: 'No transactions found in this document' }, { status: 422 })
    }

    // Dedup: flag rows that already exist so user can see them in review
    const dates = [...new Set(validRows.map(r => r.transaction_date))]
    const { data: existing } = await supabase
      .from('transactions')
      .select('transaction_date, type, amount')
      .eq('property_id', propertyId)
      .in('transaction_date', dates)

    const existingKeys = new Set(
      (existing ?? []).map(e => `${e.transaction_date}|${e.type}|${e.amount}`)
    )
    const rowsWithDupFlag = validRows.map(r => ({
      ...r,
      duplicate: existingKeys.has(`${r.transaction_date}|${r.type}|${r.amount}`),
    }))

    // Mark job as pending confirmation
    await supabase.from('upload_jobs').update({
      status: 'pending_confirmation',
      processed_at: new Date().toISOString(),
    }).eq('id', job?.id)

    // Return preview — no DB insert yet
    return NextResponse.json({
      success: true,
      preview: rowsWithDupFlag,
      job_id: job?.id ?? null,
      pm: parsed.pm ?? null,
    })

  } catch (err) {
    await supabase.from('upload_jobs').update({
      status: 'failed',
      error_message: String(err),
      processed_at: new Date().toISOString(),
    }).eq('id', job?.id)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
