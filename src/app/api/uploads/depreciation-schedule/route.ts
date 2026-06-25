import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

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
  const purchaseDate = formData.get('purchaseDate') as string | null  // e.g. "2020-06-15"

  if (!file || !propertyId) {
    return NextResponse.json({ error: 'Missing file or propertyId' }, { status: 400 })
  }

  const { data: ownership } = await supabase
    .from('property_owners')
    .select('id')
    .eq('property_id', propertyId)
    .eq('user_id', user.id)
    .single()
  if (!ownership) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  const fileBlock = isPDF
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } }

  const purchaseDateNote = purchaseDate
    ? `The property settlement/purchase date is ${purchaseDate}. Use this to map "Year 1", "Year 2" etc. to Australian financial years (FY = 1 July–30 June, labelled FY20, FY21, FY22, etc. where FY25 = 1 Jul 2024–30 Jun 2025).`
    : 'If the report uses "Year 1", "Year 2" numbering instead of financial year labels, map them to Australian financial years (FY20, FY21, etc.) starting from the first full financial year after settlement, and note your assumption.'

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        fileBlock,
        {
          type: 'text',
          text: `You are parsing an Australian Quantity Surveyor (QS) tax depreciation report for an investment property.

${purchaseDateNote}

Extract the annual depreciation schedule. Australian QS reports typically show two types:
- Division 40 (Div 40): Plant & Equipment — movable assets (appliances, carpet, blinds, etc.)
- Division 43 (Div 43): Building Allowance / Capital Works — structural elements (concrete, brickwork, etc.)
  Sometimes labelled "Capital Works", "Building Works", or "Building Allowance".

Return ONLY this JSON — no markdown, no explanation:
{
  "source": "QS firm name and report title, e.g. 'BMT Tax Depreciation — Schedule of Depreciation Allowances'",
  "entries": [
    {
      "financial_year": "FY25",
      "plant_equipment_amount": 1800.00,
      "division_43_amount": 2100.00
    }
  ]
}

Rules:
- Use Australian FY labels: FY20, FY21, FY22, FY23, FY24, FY25, FY26, FY27 etc.
- Amounts are positive numbers (they represent deductions)
- If a year has $0 for a category, still include it as 0
- Include all years shown in the report, even low or nil years
- Do not include years where both amounts are 0
- If you cannot determine the FY mapping, use your best estimate and include it anyway`,
        },
      ],
    }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  let parsed: { source: string; entries: { financial_year: string; plant_equipment_amount: number; division_43_amount: number }[] }

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('Depreciation parse — no JSON object found. Raw response:', raw.slice(0, 500))
    return NextResponse.json({ error: 'Could not extract schedule data — try a clearer PDF' }, { status: 422 })
  }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    console.error('Depreciation parse — JSON.parse failed. Extracted:', jsonMatch[0].slice(0, 500))
    return NextResponse.json({ error: 'Could not parse schedule data — try a clearer PDF' }, { status: 422 })
  }

  const validEntries = (parsed.entries ?? [])
    .filter(e => e.financial_year && (e.plant_equipment_amount > 0 || e.division_43_amount > 0))
    .map(e => ({
      financial_year: e.financial_year,
      plant_equipment_amount: Number(e.plant_equipment_amount) || 0,
      division_43_amount: Number(e.division_43_amount) || 0,
    }))

  if (validEntries.length === 0) {
    return NextResponse.json({ error: 'No depreciation entries found in this document' }, { status: 422 })
  }

  // Flag entries that already exist in the DB so user can see conflicts
  const fys = validEntries.map(e => e.financial_year)
  const { data: existing } = await supabase
    .from('depreciation_schedules')
    .select('financial_year, plant_equipment_amount, division_43_amount')
    .eq('property_id', propertyId)
    .in('financial_year', fys)

  const existingMap = new Map((existing ?? []).map(e => [e.financial_year, e]))
  const entriesWithConflict = validEntries.map(e => ({
    ...e,
    conflict: existingMap.has(e.financial_year),
  }))

  return NextResponse.json({
    success: true,
    source: parsed.source ?? file.name,
    entries: entriesWithConflict,
  })
}
