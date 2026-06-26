import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFinancialYear } from '@/lib/utils/finance'

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

  if (!file || !propertyId) {
    return NextResponse.json({ error: 'Missing file or propertyId' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id, role')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })
  if (ownership.role === 'viewer') return NextResponse.json({ error: 'View-only access' }, { status: 403 })

  const { data: job } = await adminSupabase.from('upload_jobs').insert({
    property_id: propertyId,
    uploaded_by: user.id,
    type: 'expense_document',
    original_filename: file.name,
    status: 'processing',
  }).select().single()

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
            text: `You are parsing an Australian property expense document. Identify the document type and extract all payable amounts as transactions.

Return ONLY this JSON — no markdown, no explanation:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD" (due date or issue date — use due date if available),
      "type": one of: council_rates, water_rates, insurance, strata_body_corp, property_management_fee, repairs_maintenance, advertising, legal_fees, bank_fees, land_tax, borrowing_expenses, cleaning, other_expense,
      "amount": number (negative — this is an expense),
      "description": "brief description e.g. Council rates Jul–Sep 2025, water usage charge"
    }
  ],
  "insurance": {
    "provider": string or null,
    "policy_number": string or null,
    "expiry": "YYYY-MM-DD" or null (policy expiry / renewal date),
    "premium": number or null (total annual premium, positive)
  } or null (only populate if this is an insurance document)
}

Rules:
- Identify the document type from context (letterhead, title, content) and assign the most specific transaction type
- If the notice shows multiple instalments (e.g. quarterly council rates), create one transaction per instalment with its own due date and amount
- If only a total is shown, create a single transaction
- Amounts are always negative (expenses)
- Use the due date as transaction date where possible; fall back to issue date
- For description: include the period or reference if shown
- Only populate insurance object if this is an insurance certificate or renewal notice; otherwise set to null
- For insurance.premium: use the total annual premium before discounts; null if not clearly shown`,
          },
        ],
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    let parsed: {
      transactions: { date: string; type: string; amount: number; description: string }[]
      insurance?: { provider: string | null; policy_number: string | null; expiry: string | null; premium: number | null }
    }

    try {
      const clean = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
      parsed = JSON.parse(clean)
    } catch {
      await adminSupabase.from('upload_jobs').update({ status: 'failed', error_message: 'JSON parse error', processed_at: new Date().toISOString() }).eq('id', job?.id)
      return NextResponse.json({ error: 'Could not parse document — try a clearer PDF' }, { status: 422 })
    }

    const validRows = (parsed.transactions ?? [])
      .filter(t => t.date && t.amount !== undefined)
      .map(t => ({
        transaction_date: t.date,
        type: t.type || 'other_expense',
        amount: Number(t.amount),
        description: t.description || null,
        ownership_note: null,
        financial_year: getFinancialYear(t.date),
        duplicate: false,
      }))

    // Flag duplicates
    if (validRows.length > 0) {
      const dates = [...new Set(validRows.map(r => r.transaction_date))]
      const { data: existing } = await adminSupabase
        .from('transactions')
        .select('transaction_date, type, amount')
        .eq('property_id', propertyId)
        .in('transaction_date', dates)

      const existingKeys = new Set((existing ?? []).map(e => `${e.transaction_date}|${e.type}|${e.amount}`))
      validRows.forEach(r => {
        r.duplicate = existingKeys.has(`${r.transaction_date}|${r.type}|${r.amount}`)
      })
    }

    await adminSupabase.from('upload_jobs').update({
      status: 'pending_confirmation',
      processed_at: new Date().toISOString(),
    }).eq('id', job?.id)

    return NextResponse.json({
      success: true,
      preview: validRows,
      job_id: job?.id ?? null,
      insurance: parsed.insurance ?? null,
    })

  } catch (err) {
    await adminSupabase.from('upload_jobs').update({ status: 'failed', error_message: String(err), processed_at: new Date().toISOString() }).eq('id', job?.id)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
