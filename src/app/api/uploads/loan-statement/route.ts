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

const VALID_TYPES = [
  'interest_expense', 'principal_payment', 'bank_fees',
  'other_income', 'other_expense',
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

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const propertyId = formData.get('propertyId') as string | null
  const loanId = formData.get('loanId') as string | null  // optional — omit for auto-detect

  if (!file || !propertyId) {
    return NextResponse.json({ error: 'Missing file or propertyId' }, { status: 400 })
  }

  const { data: ownership } = await adminSupabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()

  if (!ownership) return NextResponse.json({ error: 'Access denied' }, { status: 404 })

  // If loanId provided, verify it belongs to this property
  if (loanId) {
    const { data: loan } = await adminSupabase
      .from('loans')
      .select('id')
      .eq('id', loanId)
      .eq('tax_property_id', propertyId)
      .single()
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  }

  const { data: job } = await adminSupabase.from('upload_jobs').insert({
    property_id: propertyId,
    uploaded_by: user.id,
    type: 'loan_statement',
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
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: `You are parsing an Australian bank home loan statement. Extract the lender, account details, closing balance, interest rate, and all transactions.

Return ONLY this JSON — no markdown, no explanation:
{
  "lender": string (bank/lender name, e.g. "CBA", "ANZ", "Westpac", "NAB", "Macquarie"),
  "account_suffix": string or null (last 3-4 digits of account number or account suffix shown on statement, e.g. "024", "x024"),
  "balance": number (closing/current loan balance, NOT offset account balance),
  "balance_date": "YYYY-MM-DD" (statement end date or as-at date),
  "rate": number or null (current annual interest rate as a percentage, e.g. 6.24 for 6.24% p.a. — null if not shown on statement),
  "loan_limit": number or null (original approved loan amount / credit limit — check in this order: (1) explicit label like "Credit limit", "Loan limit", "Approved amount"; (2) if this is clearly a first/opening statement (opening balance is Nil or zero), use the closing balance as the original loan amount; (3) null if cannot be determined),
  "commencement_date": "YYYY-MM-DD" or null (loan settlement/start date — check in this order: (1) explicit label like "Loan commencement date", "Settlement date", "Date established"; (2) date of the first loan drawdown transaction, e.g. "Money we lent you", "Loan proceeds", "Initial advance", "Loan drawn", "Loan drawing"; (3) null if none found),
  "loan_type": "principal_and_interest" or "interest_only" or null (look for labels like "Required Payments", "Repayment type", "Payment type" — "Interest Only" → "interest_only", "Principal and Interest" → "principal_and_interest"; null if not shown),
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "type": one of: ${VALID_TYPES.join(', ')},
      "amount": number (negative for charges/debits, positive for credits/redraw),
      "description": "brief description",
      "balance": number or null (loan account running balance AFTER this transaction, if shown on statement; null if not shown)
    }
  ]
}

Rules:
- Interest charged → "interest_expense", negative
- Principal repayments (P&I or extra) → "principal_payment", negative
- Fees and charges → "bank_fees", negative
- Redraw withdrawals → "other_expense", positive (redraw increases balance), use "other_income" type
- Offset credits or interest rebates → "other_income", positive
- Do NOT include the opening or closing balance as a transaction
- Use the loan account balance (not offset), typically shown as "Closing balance", "Amount owing", or "Balance" column
- The "balance" field per transaction is the running loan balance after that transaction (NOT offset account)
- For "rate": look for labels like "Interest rate", "Current rate", "Annual interest rate", "Rate p.a." — extract the numeric value only. If multiple rates shown (e.g. split loan), use the rate for the primary account. Return null if not clearly shown.
- Extract ALL transactions from the statement period`,
          },
        ],
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    let parsed: { lender?: string; account_suffix?: string | null; balance: number; balance_date: string; rate?: number | null; loan_limit?: number | null; commencement_date?: string | null; loan_type?: string | null; transactions: { date: string; type: string; amount: number; description: string; balance?: number | null }[] }

    try {
      const clean = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
      parsed = JSON.parse(clean)
    } catch {
      await adminSupabase.from('upload_jobs').update({ status: 'failed', error_message: 'JSON parse error', processed_at: new Date().toISOString() }).eq('id', job?.id)
      return NextResponse.json({ error: 'Could not parse statement — try a clearer PDF' }, { status: 422 })
    }

    const validRows = (parsed.transactions ?? [])
      .filter(t => t.date && t.amount !== undefined && VALID_TYPES.includes(t.type))
      .map(t => ({
        transaction_date: t.date,
        type: t.type,
        amount: Number(t.amount),
        description: t.description || null,
        ownership_note: null,
        financial_year: getFinancialYear(t.date),
        duplicate: false,
      }))

    // Extract per-transaction running balance snapshots (group by date, keep last per date)
    const snapshotMap = new Map<string, number>()
    ;(parsed.transactions ?? []).forEach(t => {
      if (t.date && t.balance != null && !isNaN(Number(t.balance))) {
        snapshotMap.set(t.date, Number(t.balance))
      }
    })
    // Always include the statement closing balance
    snapshotMap.set(parsed.balance_date, Number(parsed.balance))
    const balanceSnapshots = Array.from(snapshotMap.entries())
      .map(([date, balance]) => ({ date, balance }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Flag duplicate transactions
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
      balance: Number(parsed.balance),
      balance_date: parsed.balance_date,
      detected_rate: (parsed.rate != null && !isNaN(Number(parsed.rate))) ? Number(parsed.rate) : null,
      detected_lender: parsed.lender ?? null,
      detected_account: parsed.account_suffix ?? null,
      detected_loan_limit: (parsed.loan_limit != null && !isNaN(Number(parsed.loan_limit))) ? Number(parsed.loan_limit) : null,
      detected_start_date: parsed.commencement_date ?? null,
      detected_loan_type: parsed.loan_type ?? null,
      preview: validRows,
      balance_snapshots: balanceSnapshots,
      job_id: job?.id ?? null,
    })

  } catch (err) {
    await adminSupabase.from('upload_jobs').update({ status: 'failed', error_message: String(err), processed_at: new Date().toISOString() }).eq('id', job?.id)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
