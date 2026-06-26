export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateLoanBalance, getIOExpiryDate, formatCurrency, formatCompact } from '@/lib/utils/finance'
import { ATO_EXPENSE_LABELS } from '@/lib/utils/ato-categories'
import type { Property, Loan, Transaction, Valuation, DepreciationSchedule, PropertyAcquisitionCost, ConstructionProgressPayment } from '@/lib/types/database'
import type { PropertyReport, FyLabel } from '@/components/reports/types'
import { fyFullYear } from '@/components/reports/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPdf(doc: any): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer')
  return renderToBuffer(doc)
}

async function buildPropertyReports(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<PropertyReport[]> {
  const { data: ownerships } = await supabase
    .from('property_owners')
    .select('share_percentage, properties(*)')
    .eq('user_id', userId)

  const propertyIds = (ownerships ?? []).map(o => (o.properties as unknown as Property).id)
  if (propertyIds.length === 0) return []

  const [
    { data: valuations },
    { data: loans },
    { data: transactions },
    { data: depreciation },
    { data: acquisitionCosts },
    { data: loanSecurities },
    { data: progressPayments },
  ] = await Promise.all([
    supabase.from('valuations').select('*').in('property_id', propertyIds).order('valuation_date', { ascending: false }),
    supabase.from('loans').select('*').in('tax_property_id', propertyIds),
    supabase.from('transactions').select('*').in('property_id', propertyIds).gte('transaction_date', '2019-07-01'),
    supabase.from('depreciation_schedules').select('*').in('property_id', propertyIds),
    supabase.from('property_acquisition_costs').select('*').in('property_id', propertyIds),
    supabase.from('loan_securities').select('*'),
    supabase.from('construction_progress_payments').select('*').in('property_id', propertyIds).order('sort_order', { ascending: true }),
  ])

  const allLoanIds = (loans ?? []).map(l => l.id)
  const propNameMap = new Map<string, string>()
  ;(ownerships ?? []).forEach(o => {
    const prop = o.properties as unknown as Property
    propNameMap.set(prop.id, prop.name)
  })
  const propSecuritiesMap = new Map<string, { propertyId: string; propertyName: string }[]>()
  ;(loanSecurities ?? []).filter(s => allLoanIds.includes(s.loan_id)).forEach(s => {
    const name = propNameMap.get(s.property_id) ?? s.property_id
    if (!propSecuritiesMap.has(s.loan_id)) propSecuritiesMap.set(s.loan_id, [])
    propSecuritiesMap.get(s.loan_id)!.push({ propertyId: s.property_id, propertyName: name })
  })

  return (ownerships ?? []).map(o => {
    const prop = o.properties as unknown as Property
    const propLoans = (loans ?? []).filter(l => l.tax_property_id === prop.id) as Loan[]
    const propValuations = (valuations ?? []).filter(v => v.property_id === prop.id) as Valuation[]
    const latestValuation = propValuations[0]?.amount ?? null
    const purchaseCostFallback =
      (prop.purchase_price ?? 0) +
      (prop.property_type === 'house_and_land' ? (prop.construction_contract_amount ?? 0) : 0)
    const displayVal = latestValuation ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null)

    const activeLoans = propLoans.filter(l => l.status === 'active').map(l => ({
      ...l,
      currentBalance:
        l.actual_balance !== null && l.actual_balance !== undefined
          ? Number(l.actual_balance)
          : calculateLoanBalance({
              originalAmount: l.original_amount,
              annualRate: l.interest_rate,
              termYears: l.loan_term_years,
              startDate: l.start_date,
              repaymentType: l.repayment_type,
              ioPeriodYears: l.io_period_years ?? 0,
            }),
      ioExpiryDate: l.io_expiry_date ?? getIOExpiryDate(l.start_date, l.io_period_years),
      securities: propSecuritiesMap.get(l.id) ?? [],
    }))

    return {
      property: prop,
      sharePercent: o.share_percentage,
      latestValuation: displayVal,
      isValFallback: latestValuation === null && displayVal !== null,
      activeLoans,
      allTransactions: (transactions ?? []).filter(t => t.property_id === prop.id) as Transaction[],
      depreciation: (depreciation ?? []).filter(d => d.property_id === prop.id) as DepreciationSchedule[],
      allValuations: propValuations,
      acquisitionCosts: (acquisitionCosts ?? []).filter(c => c.property_id === prop.id) as PropertyAcquisitionCost[],
      progressPayments: (progressPayments ?? []).filter(pp => pp.property_id === prop.id) as ConstructionProgressPayment[],
      loans: propLoans,
    }
  })
}

// H, M, P share transaction buckets with O and S — displayed at $0 to keep all ATO codes visible
const ZERO_LABELS = new Set(['H', 'M', 'P'])

function txnSourceLabel(source: string | null): string {
  if (source === 'rental_statement_parsed') return 'Import'
  if (source === 'loan_auto') return 'Auto'
  return 'Manual'
}

// ─── Tax PDF ──────────────────────────────────────────────────────────────────

async function buildTaxPdf(p: PropertyReport, fy: FyLabel, ownerName: string) {
  const React = (await import('react')).default
  const { Document, Page, View, Text, StyleSheet } = await import('@react-pdf/renderer')

  const NAVY = '#0c1929'
  const GOLD = '#f7c925'
  const RED = '#c0392b'
  const GREEN = '#16a34a'
  const BORDER = '#e2e8f0'
  const MUTED = '#64748b'
  const DIMMED = '#b0bec5'
  const ALT = '#f8fafc'
  const BODY = '#1e293b'

  const fyYear = fyFullYear(fy)
  const prop = p.property
  const fyTxns = p.allTransactions.filter(t => t.financial_year === fy)
  const depEntry = p.depreciation.find(d => d.financial_year === fy)

  // ── Income ──────────────────────────────────────────────────────────────────
  const rentTxns = fyTxns
    .filter(t => t.type === 'rent_income')
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
  const otherIncomeTxns = fyTxns
    .filter(t => t.type === 'other_income')
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
  const grossRent = rentTxns.reduce((s, t) => s + t.amount, 0)
  const otherIncome = otherIncomeTxns.reduce((s, t) => s + t.amount, 0)
  const totalIncome = grossRent + otherIncome

  // ── Expenses — all 19 ATO labels, including zeros ────────────────────────
  const expenseRows = ATO_EXPENSE_LABELS.map(l => {
    let amount = 0
    let txns: Transaction[] = []
    const isZeroLabel = ZERO_LABELS.has(l.label)
    const isNotClaimable = !!l.notClaimable
    if (!isZeroLabel && !isNotClaimable) {
      if (l.nonCash) {
        amount = l.label === 'D'
          ? (depEntry?.plant_equipment_amount ?? 0)
          : (depEntry?.division_43_amount ?? 0)
      } else {
        txns = fyTxns
          .filter(t => l.types.includes(t.type as never) && t.amount < 0)
          .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
        amount = txns.reduce((s, t) => s + Math.abs(t.amount), 0)
      }
    }
    return { ...l, amount, txns, isZeroLabel, isNotClaimable }
  })

  const totalExpenses = expenseRows
    .filter(e => !e.isZeroLabel && !e.isNotClaimable)
    .reduce((s, e) => s + e.amount, 0)

  // Only render rows that have a value, plus H/M/P (structural) and Q (compliance note)
  const visibleExpenseRows = expenseRows.filter(e => e.amount > 0 || e.isZeroLabel || e.isNotClaimable)
  const netResult = totalIncome - totalExpenses

  // ── Loans with FY interest ───────────────────────────────────────────────
  const loansWithDetail = p.activeLoans.map(loan => {
    const startYear = parseInt(loan.start_date.slice(0, 4), 10)
    const maturityDate = `${loan.start_date.slice(5, 7)}/${startYear + loan.loan_term_years}`
    const fyInterest = fyTxns
      .filter(t => t.loan_id === loan.id && t.type === 'interest_expense')
      .reduce((s, t) => s + Math.abs(t.amount), 0)
    return { loan, maturityDate, fyInterest }
  })

  // ── Cost Base ────────────────────────────────────────────────────────────
  const showCostBase = prop.usage !== 'ppor' && (prop.purchase_price || p.acquisitionCosts.length > 0)
  const landPrice = prop.purchase_price ?? 0
  const drawnBuildCost = prop.property_type === 'house_and_land'
    ? p.progressPayments
        .filter(pp => pp.drawn_date !== null)
        .reduce((s, pp) => {
          const drawn = (pp.bank_amount !== null || pp.self_amount !== null)
            ? (pp.bank_amount ?? 0) + (pp.self_amount ?? 0)
            : (pp.amount ?? 0)
          return s + drawn
        }, 0)
    : 0
  const purchase = landPrice + drawnBuildCost
  const acquisitionTotal = p.acquisitionCosts.reduce((s, c) => s + c.amount, 0)
  const capitalImprovements = p.allTransactions
    .filter(t => t.type === 'capital_expense' && t.financial_year <= fy)
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const cumulativeDiv40 = p.depreciation
    .filter(d => fyFullYear(d.financial_year as FyLabel) <= fyYear)
    .reduce((s, d) => s + (d.plant_equipment_amount ?? 0), 0)
  const cumulativeDiv43 = p.depreciation
    .filter(d => fyFullYear(d.financial_year as FyLabel) <= fyYear)
    .reduce((s, d) => s + (d.division_43_amount ?? 0), 0)
  const costBaseTotal = purchase + acquisitionTotal + capitalImprovements - (cumulativeDiv40 + cumulativeDiv43)
  const val = p.latestValuation ?? 0

  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

  const AMT_W = 92   // amount column width
  const LBL_W = 28   // label column width
  const INDENT = 10  // item indent

  const s = StyleSheet.create({
    page: { fontFamily: 'Helvetica', fontSize: 9, color: BODY, paddingBottom: 52, backgroundColor: '#fff' },
    hdr: { backgroundColor: NAVY, padding: '24 44 20 44', marginBottom: 18 },
    subHdr: { backgroundColor: NAVY, padding: '16 44 14 44', marginBottom: 20 },
    body: { paddingHorizontal: 44 },
    right: { textAlign: 'right' },
    // Schedule column header row
    colHdr: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1.5, borderBottomColor: NAVY, marginBottom: 0 },
    colHdrCell: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
    // Section header (subtotal at top)
    secHdr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
    secHdrText: { flex: 1, fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
    secHdrAmt: { width: AMT_W, textAlign: 'right', fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
    // Item row (indented, comfortable)
    item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4.5, paddingLeft: INDENT, borderBottomWidth: 1, borderBottomColor: BORDER },
    itemText: { flex: 1, fontSize: 8.5, color: BODY },
    itemAmt: { width: AMT_W, textAlign: 'right', fontSize: 8.5 },
    itemLbl: { width: LBL_W, textAlign: 'center', fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTED },
    // Other
    secTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 20, paddingBottom: 6, borderBottomWidth: 1.5, borderBottomColor: NAVY },
    tHdr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1.5, borderBottomColor: NAVY },
    tHdrCell: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
    tRow: { flexDirection: 'row', paddingVertical: 6.5, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'center' },
    tRowAlt: { backgroundColor: ALT },
    ftr: { position: 'absolute', bottom: 22, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 7 },
    ftrTxt: { fontSize: 6.5, color: '#94a3b8' },
  })

  const R = React.createElement
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

  // Appendix expense sections — only where there are transactions
  const incomeSections = [
    rentTxns.length > 0
      ? { label: '', name: 'Gross Rent Received', txns: rentTxns, total: grossRent }
      : null,
    otherIncomeTxns.length > 0
      ? { label: '', name: 'Other Rental Income', txns: otherIncomeTxns, total: otherIncome }
      : null,
  ].filter(Boolean) as { label: string; name: string; txns: Transaction[]; total: number }[]

  const expenseSections = expenseRows
    .filter(e => !e.isZeroLabel && !e.isNotClaimable && !e.nonCash && e.txns.length > 0)
    .map(e => ({ label: e.label, name: e.name, txns: e.txns, total: e.amount }))

  const nonCashRows = expenseRows.filter(e => e.nonCash && e.amount > 0)
  const hasPage2 = loansWithDetail.length > 0 || showCostBase

  return R(Document, { title: `${prop.name} ${fy} ATO Tax Report` },

    // ── Page 1: ATO Schedule ─────────────────────────────────────────────────
    R(Page, { size: 'A4', style: s.page },

      // Header
      R(View, { style: s.hdr },
        R(Text, { style: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: GOLD, letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 6 } },
          'Inner Circle Financial Group — ATO Rental Property Schedule NAT 1836'
        ),
        R(Text, { style: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: '#fff', marginBottom: 3, lineHeight: 1.1 } }, prop.name),
        R(Text, { style: { fontSize: 8, color: 'rgba(255,255,255,0.42)', marginBottom: 14 } },
          `${prop.street_address}, ${prop.suburb} ${prop.state} ${prop.postcode}`
        ),
        R(View, { style: { flexDirection: 'row', gap: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 12 } },
          R(View, null,
            R(Text, { style: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 } }, 'Financial Year'),
            R(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#fff' } },
              `${fy}  ·  1 July ${fyYear - 1} to 30 June ${fyYear}`
            )
          ),
          R(View, null,
            R(Text, { style: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 } }, 'Ownership'),
            R(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#fff' } }, `${p.sharePercent}%`)
          ),
          R(View, null,
            R(Text, { style: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 } }, 'Property Use'),
            R(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#fff' } },
              prop.usage === 'ppor' ? 'PPOR' : prop.usage === 'investment' ? 'Investment' : 'Mixed'
            )
          ),
          ownerName
            ? R(View, null,
                R(Text, { style: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: 'rgba(255,255,255,0.38)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 } }, 'Prepared For'),
                R(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#fff' } }, ownerName)
              )
            : R(View, { key: 'ph' }, null)
        )
      ),

      R(View, { style: s.body },

        // Column header
        R(View, { style: s.colHdr },
          R(Text, { style: { flex: 1, ...s.colHdrCell } }, 'Description'),
          R(Text, { style: { width: AMT_W, ...s.colHdrCell, ...s.right } }, 'Amount (AUD)'),
          R(Text, { style: { width: LBL_W, ...s.colHdrCell, textAlign: 'center' } }, 'Label'),
        ),

        // ── Rental Income section header (subtotal on top) ──
        R(View, { style: { ...s.secHdr, backgroundColor: '#f0fdf4' } },
          R(Text, { style: { ...s.secHdrText, color: GREEN } }, 'Rental Income'),
          R(Text, { style: { ...s.secHdrAmt, color: GREEN } }, totalIncome > 0 ? formatCurrency(totalIncome) : '—'),
          R(Text, { style: { width: LBL_W } }, ''),
        ),
        // Income items
        R(View, { style: { ...s.item, backgroundColor: ALT } },
          R(Text, { style: s.itemText }, 'Gross rent received'),
          R(Text, { style: { ...s.itemAmt, color: grossRent > 0 ? GREEN : MUTED } },
            grossRent > 0 ? formatCurrency(grossRent) : '—'
          ),
          R(Text, { style: s.itemLbl }, ''),
        ),
        R(View, { style: s.item },
          R(Text, { style: s.itemText }, 'Other rental income'),
          R(Text, { style: { ...s.itemAmt, color: otherIncome > 0 ? GREEN : MUTED } },
            otherIncome > 0 ? formatCurrency(otherIncome) : '—'
          ),
          R(Text, { style: s.itemLbl }, ''),
        ),

        // ── Deductions section header (subtotal on top) ──
        R(View, { style: { ...s.secHdr, backgroundColor: '#fef2f2', marginTop: 10 } },
          R(Text, { style: { ...s.secHdrText, color: RED } }, 'Deductions'),
          R(Text, { style: { ...s.secHdrAmt, color: RED } },
            totalExpenses > 0 ? `(${formatCurrency(totalExpenses)})` : '—'
          ),
          R(Text, { style: { width: LBL_W } }, ''),
        ),
        // Deduction items — non-zero, plus H/M/P and Q for compliance
        ...visibleExpenseRows.map((e, i) => {
          const isDimmed = e.isZeroLabel || e.isNotClaimable
          const amtText = e.isNotClaimable ? 'N/A' : e.amount > 0 ? `(${formatCurrency(e.amount)})` : '—'
          const nameText = e.isZeroLabel ? `${e.name} *` : e.isNotClaimable ? `${e.name} †` : e.nonCash ? `${e.name} ‡` : e.name
          return R(View, { key: e.label, style: { ...s.item, backgroundColor: i % 2 === 0 ? '#fff' : ALT } },
            R(Text, { style: { ...s.itemText, color: isDimmed ? DIMMED : e.nonCash ? MUTED : BODY } }, nameText),
            R(Text, { style: { ...s.itemAmt, color: isDimmed ? DIMMED : e.amount > 0 ? RED : MUTED } }, amtText),
            R(Text, { style: { ...s.itemLbl, color: isDimmed ? DIMMED : MUTED } }, e.label),
          )
        }),

        // Footnotes
        R(View, { style: { flexDirection: 'row', gap: 14, marginTop: 5 } },
          R(Text, { style: { fontSize: 6.5, color: MUTED } }, '* Captured under primary label (O or S)'),
          R(Text, { style: { fontSize: 6.5, color: MUTED } }, '† Not deductible from 1 Jul 2017'),
          R(Text, { style: { fontSize: 6.5, color: MUTED } }, '‡ Non-cash — from depreciation schedule'),
        ),

        // Net Result
        R(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '14 16', marginTop: 14, backgroundColor: netResult < 0 ? '#fef2f2' : '#f0fdf4', borderRadius: 4, borderWidth: 1, borderColor: netResult < 0 ? '#fecaca' : '#bbf7d0' } },
          R(View, null,
            R(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: netResult < 0 ? RED : GREEN } },
              netResult < 0 ? 'Net Rental Loss' : 'Net Rental Profit'
            ),
            R(Text, { style: { fontSize: 7.5, color: MUTED, marginTop: 3 } },
              'Reportable at Item 21 of your Individual Tax Return'
            ),
          ),
          R(Text, { style: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: netResult < 0 ? RED : GREEN } },
            netResult < 0 ? `(${formatCurrency(Math.abs(netResult))})` : formatCurrency(netResult)
          )
        ),

      ),

      R(View, { style: s.ftr },
        R(Text, { style: s.ftrTxt }, 'Inner Circle Financial Group — Confidential. Not financial or tax advice.'),
        R(Text, { style: s.ftrTxt }, `Generated ${now}`),
      ),
    ),

    // ── Page 2: Loan Details + Cost Base ─────────────────────────────────────
    ...(hasPage2 ? [R(Page, { key: 'p2', size: 'A4', style: s.page },

      R(View, { style: s.subHdr },
        R(Text, { style: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: GOLD, letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 4 } },
          'Loan Details & Cost Base'
        ),
        R(Text, { style: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#fff', marginBottom: 2 } }, prop.name),
        R(Text, { style: { fontSize: 8, color: 'rgba(255,255,255,0.45)' } }, `${fy}  ·  As at 30 June ${fyYear}`),
      ),

      R(View, { style: { ...s.body, flex: 1, flexDirection: 'column' } },
      R(View, { style: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' } },

        // Left: Loans with FY interest
        ...(loansWithDetail.length > 0 ? [
          R(View, { key: 'loans-col', style: { flex: 3 } },
            R(Text, { style: { ...s.secTitle, marginTop: 0 } }, 'Active Loans'),
            R(View, { style: s.tHdr },
              R(Text, { style: { flex: 1, ...s.tHdrCell } }, 'Lender'),
              R(Text, { style: { width: 64, ...s.tHdrCell, ...s.right } }, 'Balance'),
              R(Text, { style: { width: 38, ...s.tHdrCell, ...s.right } }, 'Rate'),
              R(Text, { style: { width: 68, ...s.tHdrCell, ...s.right } }, `${fy} Interest`),
              R(Text, { style: { width: 46, ...s.tHdrCell, ...s.right } }, 'Matures'),
            ),
            ...loansWithDetail.map(({ loan, maturityDate, fyInterest }, i) =>
              R(View, { key: loan.id, style: [s.tRow, i % 2 === 1 ? s.tRowAlt : {}] as never },
                R(View, { style: { flex: 1 } },
                  R(Text, { style: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 } }, loan.lender),
                  loan.account_suffix
                    ? R(Text, { style: { fontSize: 7, color: MUTED, marginTop: 1 } }, `…${loan.account_suffix}`)
                    : null,
                ),
                R(Text, { style: { width: 64, ...s.right, fontFamily: 'Helvetica-Bold' } }, formatCompact(loan.currentBalance)),
                R(Text, { style: { width: 38, ...s.right } }, `${loan.interest_rate.toFixed(2)}%`),
                R(Text, { style: { width: 68, ...s.right, fontFamily: fyInterest > 0 ? 'Helvetica-Bold' : 'Helvetica', color: fyInterest > 0 ? RED : MUTED } },
                  fyInterest > 0 ? `(${formatCurrency(fyInterest)})` : '—'
                ),
                R(Text, { style: { width: 46, ...s.right, color: MUTED } }, maturityDate),
              )
            ),
            loansWithDetail.some(l => l.fyInterest > 0)
              ? R(View, { style: { ...s.tRow, borderBottomWidth: 1.5, borderBottomColor: NAVY } },
                  R(Text, { style: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold' } }, 'Total interest (Label J)'),
                  R(Text, { style: { width: 64 } }, ''),
                  R(Text, { style: { width: 38 } }, ''),
                  R(Text, { style: { width: 68, ...s.right, fontFamily: 'Helvetica-Bold', color: RED } },
                    `(${formatCurrency(loansWithDetail.reduce((sum, l) => sum + l.fyInterest, 0))})`
                  ),
                  R(Text, { style: { width: 46 } }, ''),
                )
              : null,
          ),
        ] : []),

        // Right: Cost Base as line items
        ...(showCostBase ? [
          R(View, { key: 'cb-col', style: { flex: 2 } },
            R(Text, { style: { ...s.secTitle, marginTop: 0 } }, 'Adjusted Cost Base'),
            ...[
              { label: 'Purchase price', value: formatCurrency(purchase), sub: prop.property_type === 'house_and_land' ? `Land: ${formatCurrency(landPrice)} · Build drawn: ${formatCurrency(drawnBuildCost)}` : undefined },
              { label: 'Acquisition costs', value: formatCurrency(acquisitionTotal), sub: 'Stamp duty, legal, etc.' },
              { label: 'Capital improvements', value: formatCurrency(capitalImprovements), sub: 'Cumulative to date' },
              { label: 'Less: Div 40 depreciation', value: cumulativeDiv40 > 0 ? `(${formatCurrency(cumulativeDiv40)})` : '—', neg: cumulativeDiv40 > 0 },
              { label: 'Less: Div 43 depreciation', value: cumulativeDiv43 > 0 ? `(${formatCurrency(cumulativeDiv43)})` : '—', neg: cumulativeDiv43 > 0 },
            ].map((item, i) =>
              R(View, { key: item.label, style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: i % 2 === 1 ? ALT : '#fff' } },
                R(View, { style: { flex: 1, paddingRight: 8 } },
                  R(Text, { style: { fontSize: 8.5, color: BODY } }, item.label),
                  item.sub ? R(Text, { style: { fontSize: 7, color: MUTED, marginTop: 2 } }, item.sub) : null,
                ),
                R(Text, { style: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: item.neg ? RED : BODY } }, item.value),
              )
            ),
            R(View, { style: { backgroundColor: NAVY, padding: '12 14', marginTop: 4, borderRadius: 3, flexDirection: 'row', alignItems: 'center' } },
              R(View, { style: { flex: 1, paddingRight: 12 } },
                R(Text, { style: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: GOLD, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 4 } }, 'Adjusted Cost Base'),
                val > 0 && costBaseTotal > 0
                  ? R(Text, { style: { fontSize: 7, color: 'rgba(255,255,255,0.45)' } },
                      `Est. capital ${val >= costBaseTotal ? 'gain' : 'loss'} at ${formatCompact(val)}: ${formatCurrency(Math.abs(val - costBaseTotal))}`
                    )
                  : null,
              ),
              R(Text, { style: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#fff', lineHeight: 1, flexShrink: 0 } },
                formatCurrency(costBaseTotal)
              ),
            ),
            R(Text, { style: { fontSize: 7, color: MUTED, marginTop: 6 } },
              'Cost base reduces each year depreciation is claimed. Relevant for CGT at time of sale.'
            ),
          ),
        ] : []),
      ),

        // ATO Label Reference — bottom of page 2
        R(View, { style: { marginTop: 'auto', paddingTop: 14 } },
          R(View, { style: { borderTopWidth: 1.5, borderTopColor: NAVY, paddingTop: 7, marginBottom: 7 } },
            R(Text, { style: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1 } },
              'ATO Schedule Reference — Labels A to S'
            ),
          ),
          R(View, { style: { flexDirection: 'row', flexWrap: 'wrap' } },
            ...ATO_EXPENSE_LABELS.map(l =>
              R(View, { key: l.label, style: { width: '25%', flexDirection: 'row', gap: 5, marginBottom: 4, paddingRight: 4 } },
                R(Text, { style: { width: 11, fontSize: 7, fontFamily: 'Helvetica-Bold', color: l.notClaimable ? DIMMED : MUTED } }, l.label),
                R(Text, { style: { fontSize: 7, color: l.notClaimable ? DIMMED : '#374151', flex: 1 } },
                  l.name + (l.notClaimable ? ' †' : '')
                ),
              )
            ),
            R(View, { key: 'ref-note', style: { width: '100%', marginTop: 2 } },
              R(Text, { style: { fontSize: 6, color: DIMMED } }, '† Not deductible from 1 Jul 2017 (ATO ruling)'),
            ),
          ),
        ),
      ),

      R(View, { style: s.ftr },
        R(Text, { style: s.ftrTxt }, 'Inner Circle Financial Group — Confidential. Not financial or tax advice.'),
        R(Text, { style: s.ftrTxt }, `Generated ${now}`),
      ),
    )] : []),

    // ── Page 3: Transaction Appendix + ATO Reference at bottom ───────────────
    R(Page, { key: 'p3', size: 'A4', style: s.page },

      R(View, { style: { backgroundColor: NAVY, padding: '20 44 18 44', marginBottom: 22 } },
        R(Text, { style: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: GOLD, letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 5 } },
          'Appendix — Transaction Detail'
        ),
        R(Text, { style: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#fff', marginBottom: 3 } }, prop.name),
        R(Text, { style: { fontSize: 8, color: 'rgba(255,255,255,0.45)' } },
          `${fy}  ·  1 July ${fyYear - 1} to 30 June ${fyYear}  ·  Supporting detail for the ATO schedule`
        ),
      ),

      R(View, { style: s.body },

        // Income sections
        ...incomeSections.map(sec =>
          R(View, { key: `inc-${sec.name}` },
            R(View, { style: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', padding: '6 10', borderLeftWidth: 3, borderLeftColor: GREEN, marginTop: 12 } },
              R(Text, { style: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: GREEN } }, sec.name),
              R(Text, { style: { width: 80, ...s.right, fontSize: 8, fontFamily: 'Helvetica-Bold', color: GREEN } }, formatCurrency(sec.total)),
            ),
            R(View, { style: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: BORDER } },
              R(Text, { style: { width: 76, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED } }, 'Date'),
              R(Text, { style: { flex: 1, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED } }, 'Description'),
              R(Text, { style: { width: 48, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, paddingLeft: 8 } }, 'Source'),
              R(Text, { style: { width: 80, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, ...s.right } }, 'Amount'),
            ),
            ...sec.txns.map((t, i) =>
              R(View, { key: t.id, style: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: i % 2 === 1 ? ALT : '#fff' } },
                R(Text, { style: { width: 76, fontSize: 7.5, color: MUTED } }, formatDate(t.transaction_date)),
                R(Text, { style: { flex: 1, fontSize: 7.5, paddingRight: 8 } }, t.description || t.type),
                R(Text, { style: { width: 48, fontSize: 7, color: MUTED, paddingLeft: 8 } }, txnSourceLabel(t.source)),
                R(Text, { style: { width: 80, fontSize: 7.5, color: GREEN, ...s.right } }, formatCurrency(t.amount)),
              )
            ),
          )
        ),

        // Expense sections — label badge in header
        ...expenseSections.map(sec =>
          R(View, { key: `exp-${sec.label}` },
            R(View, { style: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', padding: '6 10', borderLeftWidth: 3, borderLeftColor: RED, marginTop: 12 } },
              R(View, { style: { backgroundColor: RED, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2, marginRight: 7 } },
                R(Text, { style: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#fff' } }, sec.label),
              ),
              R(Text, { style: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: RED } }, sec.name),
              R(Text, { style: { width: 80, ...s.right, fontSize: 8, fontFamily: 'Helvetica-Bold', color: RED } }, `(${formatCurrency(sec.total)})`),
            ),
            R(View, { style: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: BORDER } },
              R(Text, { style: { width: 76, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED } }, 'Date'),
              R(Text, { style: { flex: 1, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED } }, 'Description'),
              R(Text, { style: { width: 48, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, paddingLeft: 8 } }, 'Source'),
              R(Text, { style: { width: 80, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MUTED, ...s.right } }, 'Amount'),
            ),
            ...sec.txns.map((t, i) =>
              R(View, { key: t.id, style: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: i % 2 === 1 ? ALT : '#fff' } },
                R(Text, { style: { width: 76, fontSize: 7.5, color: MUTED } }, formatDate(t.transaction_date)),
                R(Text, { style: { flex: 1, fontSize: 7.5, paddingRight: 8 } }, t.description || t.type),
                R(Text, { style: { width: 48, fontSize: 7, color: MUTED, paddingLeft: 8 } }, txnSourceLabel(t.source)),
                R(Text, { style: { width: 80, fontSize: 7.5, color: RED, ...s.right } }, `(${formatCurrency(Math.abs(t.amount))})`),
              )
            ),
          )
        ),

        // Non-cash depreciation note
        ...(nonCashRows.length > 0 ? [
          R(View, { key: 'dep', style: { marginTop: 16, padding: '10 12', backgroundColor: ALT, borderRadius: 4, borderWidth: 1, borderColor: BORDER } },
            R(Text, { style: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BODY, marginBottom: 5 } },
              'Non-Cash Deductions — Depreciation Schedule'
            ),
            ...nonCashRows.map(e =>
              R(View, { key: e.label, style: { flexDirection: 'row', alignItems: 'center', marginTop: 4 } },
                R(View, { style: { backgroundColor: MUTED, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2, marginRight: 7 } },
                  R(Text, { style: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#fff' } }, e.label),
                ),
                R(Text, { style: { flex: 1, fontSize: 8, color: MUTED } }, e.name),
                R(Text, { style: { width: 80, fontSize: 8, color: RED, ...s.right } }, `(${formatCurrency(e.amount)})`),
              )
            ),
            R(Text, { style: { fontSize: 7, color: '#94a3b8', marginTop: 7 } },
              "Sourced from the Quantity Surveyor's schedule. No individual cash transactions are recorded."
            ),
          ),
        ] : []),

      ),

      R(View, { style: s.ftr },
        R(Text, { style: s.ftrTxt }, 'Inner Circle Financial Group — Confidential. Not financial or tax advice.'),
        R(Text, { style: s.ftrTxt }, `Generated ${now}`),
      ),
    )
  )
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    const { data: profile } = await supabase.from('users').select('full_name').eq('id', user.id).single()
    const ownerName = profile?.full_name ?? ''

    const url = new URL(request.url)
    const fy = (url.searchParams.get('fy') ?? 'FY25') as FyLabel
    const propertyId = url.searchParams.get('propertyId')

    const properties = await buildPropertyReports(supabase, user.id)
    const prop = propertyId ? properties.find(p => p.property.id === propertyId) : properties[0]
    if (!prop) return new Response('Property not found', { status: 404 })

    const doc = await buildTaxPdf(prop, fy, ownerName)
    const buffer = await renderPdf(doc)
    const uint8 = new Uint8Array(buffer)
    const filename = `ICFG-Tax-${prop.property.name.replace(/[^a-zA-Z0-9]/g, '-')}-${fy}.pdf`

    return new Response(uint8, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(uint8.length),
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return new Response('PDF generation failed', { status: 500 })
  }
}
