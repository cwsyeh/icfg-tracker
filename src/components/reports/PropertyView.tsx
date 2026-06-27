'use client'
import { useMemo } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { formatCurrency, formatCompact, calculateLoanBalance } from '@/lib/utils/finance'
import { FY_CHART_RANGE, fyEndDate, valuationAsOf } from './types'
import type { PropertyReport } from './types'

interface Props { property: PropertyReport }

const CARD: React.CSSProperties = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }

function compactTick(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`
  return `$${v}`
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDateLabel(label: string | undefined, isAnnual?: boolean): string {
  if (!label) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const [y, m, d] = label.split('-').map(Number)
    const fyStr = `FY${String(m >= 7 ? y + 1 : y).slice(-2)}`
    return isAnnual ? `${fyStr} (30 Jun ${y})` : `${d} ${MONTHS[m - 1]} ${y}`
  }
  return label
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: Record<string, unknown> }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const isAnnual = !!(payload[0]?.payload as Record<string, unknown> | undefined)?.isAnnual
  const displayLabel = formatDateLabel(label, isAnnual)
  return (
    <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.08)', fontSize: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{displayLabel}</div>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 700 }}>{compactTick(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function PropertyView({ property: p }: Props) {
  const data = useMemo(() => {
    // Current snapshot
    const val = p.latestValuation ?? 0
    const debt = p.activeLoans.reduce((s, l) => s + l.currentBalance, 0)
    const equity = val - debt
    const ltv = val > 0 ? (debt / val) * 100 : null

    // Find the latest FY with transactions, capped at the current financial year
    const now = new Date()
    const currentFyYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()
    const currentFy = `FY${String(currentFyYear).slice(-2)}`
    const fyYears = [...new Set(p.allTransactions.map(t => t.financial_year))].sort()
    const latestFy = fyYears.filter(fy => fy <= currentFy).slice(-1)[0] ?? currentFy
    const grossRent = p.allTransactions.filter(t => t.financial_year === latestFy && t.type === 'rent_income').reduce((s, t) => s + t.amount, 0)
    const depEntry = p.depreciation.find(d => d.financial_year === latestFy)
    const nonCash = (depEntry?.division_43_amount ?? 0) + (depEntry?.plant_equipment_amount ?? 0)
    const totalExp = p.allTransactions.filter(t => t.financial_year === latestFy && t.amount < 0 && t.type !== 'principal_payment').reduce((s, t) => s + Math.abs(t.amount), 0)
    const netResult = grossRent - totalExp - nonCash
    const grossYield = val > 0 && grossRent > 0 ? (grossRent / val) * 100 : null
    const netYield = val > 0 && grossRent > 0 ? (netResult / val) * 100 : null

    // Chart window: sold → full ownership life; active → 10-year window
    const soldDate = p.property.sold_date
    const soldPrice = p.property.sold_price
    const soldFy = soldDate
      ? (() => { const [y, m] = soldDate.split('-').map(Number); return `FY${String(m >= 7 ? y + 1 : y).slice(-2)}` })()
      : null
    const startDate = p.property.settlement_date ?? p.property.purchase_date
    const purchaseFy = startDate
      ? (() => { const [y, m] = startDate.split('-').map(Number); return `FY${String(m >= 7 ? y + 1 : y).slice(-2)}` })()
      : null

    const currentFy = FY_CHART_RANGE[FY_CHART_RANGE.length - 1]
    const endFyStr = soldFy ?? currentFy
    const startYr = purchaseFy ? 2000 + parseInt(purchaseFy.slice(2)) : 2000 + parseInt(FY_CHART_RANGE[0].slice(2))
    const endYr = 2000 + parseInt(endFyStr.slice(2))
    const chartFYs: string[] = Array.from({ length: endYr - startYr + 1 }, (_, i) => `FY${String(startYr + i).slice(-2)}`)

    const chartData = chartFYs.map(fy => {
      const isSalePoint = soldDate && soldPrice && fy === soldFy
      const endDate = isSalePoint ? soldDate : fyEndDate(fy as typeof FY_CHART_RANGE[number])
      const propVal = isSalePoint
        ? soldPrice
        : (() => {
            const formalVal = valuationAsOf(p.allValuations, endDate, null)
            if (formalVal !== null) return formalVal
            if (!p.property.purchase_date || p.property.purchase_date > endDate) return null
            const prop = p.property
            const settledByEnd = prop.settlement_date ? prop.settlement_date <= endDate : true
            if (prop.property_type === 'off_the_plan') {
              return settledByEnd ? (prop.purchase_price ?? 0) || null : (prop.deposit_paid ?? 0) || null
            }
            if (prop.property_type === 'house_and_land' || p.progressPayments.length > 0) {
              const landPrice = prop.purchase_price ?? 0
              const drawn = p.progressPayments
                .filter(pp => pp.drawn_date && pp.drawn_date <= endDate)
                .reduce((s, pp) => s + ((pp.bank_amount !== null || pp.self_amount !== null)
                  ? (pp.bank_amount ?? 0) + (pp.self_amount ?? 0)
                  : (pp.amount ?? 0)), 0)
              return (landPrice + drawn) || null
            }
            return (prop.purchase_price ?? 0) || null
          })()
      const propDebt = p.loans.reduce((ls, loan) => {
        if (loan.start_date > endDate) return ls
        if (loan.closed_date && loan.closed_date <= endDate) return ls
        return ls + calculateLoanBalance({
          originalAmount: loan.original_amount, annualRate: loan.interest_rate, termYears: loan.loan_term_years,
          startDate: loan.start_date, repaymentType: loan.repayment_type,
          ioPeriodYears: loan.io_period_years ?? 0, ioExpiryDate: loan.io_expiry_date, asOfDate: endDate,
        })
      }, 0)
      const fyTxns = p.allTransactions.filter(t => t.financial_year === fy)
      const rent = fyTxns.filter(t => t.type === 'rent_income').reduce((s, t) => s + t.amount, 0)
      const cashExp = fyTxns.filter(t => t.amount < 0 && t.type !== 'principal_payment').reduce((s, t) => s + Math.abs(t.amount), 0)
      const dep = p.depreciation.find(d => d.financial_year === fy)
      const depAmt = (dep?.division_43_amount ?? 0) + (dep?.plant_equipment_amount ?? 0)
      const cashNet = rent > 0 ? rent - cashExp : null
      const nonCash = rent > 0 ? -depAmt : null
      const net = cashNet !== null ? cashNet + (nonCash ?? 0) : null

      if (propVal === null && rent === 0) return null
      return {
        fy: fy as string,
        Value: propVal ?? undefined,
        Equity: propVal !== null && propDebt >= 0 ? propVal - propDebt : undefined,
        Debt: propDebt > 0 ? propDebt : undefined,
        cashNet,
        nonCash,
        netResult: net,
        grossYield: propVal && propVal > 0 && rent > 0 ? (rent / propVal) * 100 : undefined,
      }
    }).filter(Boolean) as { fy: string; Value?: number; Equity?: number; Debt?: number; cashNet: number | null; nonCash: number | null; netResult: number | null; grossYield?: number }[]

    const isSold = p.property.status === 'sold'
    const totalSaleCosts = (p.saleCosts ?? []).reduce((s, c) => s + c.amount, 0)
    const netProceeds = (p.property.sold_price ?? 0) - totalSaleCosts
    const contractAmt = p.progressPayments.reduce((s, pp) => s + (pp.amount ?? 0), 0)
    const totalAcq = p.acquisitionCosts.reduce((s, c) => s + c.amount, 0)
    const totalCapEx = p.allTransactions.filter(t => t.type === 'capital_expense').reduce((s, t) => s + Math.abs(t.amount), 0)
    const totalDepr = p.depreciation.reduce((s, d) => s + (d.division_43_amount ?? 0) + (d.plant_equipment_amount ?? 0), 0)
    const costBasis = (p.property.purchase_price ?? 0) + contractAmt + totalAcq + totalCapEx
    const estimatedGain = isSold && p.property.sold_price !== null ? netProceeds - costBasis : null

    // Capital Growth chart: combine all valuation dates with annual FY-end markers
    const fyEndDateSet = new Set<string>()
    chartFYs.forEach(fy => {
      const isSaleFy = soldDate && soldPrice && fy === soldFy
      fyEndDateSet.add(isSaleFy ? soldDate! : fyEndDate(fy as typeof FY_CHART_RANGE[number]))
    })

    const growthDates = new Set<string>(fyEndDateSet)
    p.allValuations.forEach(v => {
      if ((!startDate || v.valuation_date >= startDate) && (!soldDate || v.valuation_date <= soldDate)) {
        growthDates.add(v.valuation_date)
      }
    })

    const growthChartData = [...growthDates].sort().map(date => {
      const isSalePoint = !!(soldDate && soldPrice && date === soldDate)
      const propVal = isSalePoint
        ? soldPrice!
        : (() => {
            const fv = valuationAsOf(p.allValuations, date, null)
            if (fv !== null) return fv
            const prop = p.property
            if (!prop.purchase_date || prop.purchase_date > date) return null
            const settledByEnd = prop.settlement_date ? prop.settlement_date <= date : true
            if (prop.property_type === 'off_the_plan') {
              return settledByEnd ? (prop.purchase_price ?? 0) || null : (prop.deposit_paid ?? 0) || null
            }
            if (prop.property_type === 'house_and_land' || p.progressPayments.length > 0) {
              const landPrice = prop.purchase_price ?? 0
              const drawn = p.progressPayments
                .filter(pp => pp.drawn_date && pp.drawn_date <= date)
                .reduce((s, pp) => s + ((pp.bank_amount !== null || pp.self_amount !== null)
                  ? (pp.bank_amount ?? 0) + (pp.self_amount ?? 0)
                  : (pp.amount ?? 0)), 0)
              return (landPrice + drawn) || null
            }
            return (prop.purchase_price ?? 0) || null
          })()
      if (propVal === null) return null
      const propDebt = p.loans.reduce((ls, loan) => {
        if (loan.start_date > date) return ls
        if (loan.closed_date && loan.closed_date <= date) return ls
        return ls + calculateLoanBalance({
          originalAmount: loan.original_amount, annualRate: loan.interest_rate, termYears: loan.loan_term_years,
          startDate: loan.start_date, repaymentType: loan.repayment_type,
          ioPeriodYears: loan.io_period_years ?? 0, ioExpiryDate: loan.io_expiry_date, asOfDate: date,
        })
      }, 0)
      return {
        date,
        isAnnual: fyEndDateSet.has(date),
        Value: propVal,
        Equity: propVal - propDebt,
        Debt: propDebt > 0 ? propDebt : undefined,
      }
    }).filter(Boolean) as { date: string; isAnnual: boolean; Value: number; Equity: number; Debt?: number }[]

    const annualTicks = [...fyEndDateSet].sort()

    // Sold property summary metrics for hero card
    const totalGrossRent = p.allTransactions.filter(t => t.type === 'rent_income').reduce((s, t) => s + t.amount, 0)
    const totalCashExp = p.allTransactions.filter(t => t.amount < 0 && t.type !== 'principal_payment').reduce((s, t) => s + Math.abs(t.amount), 0)
    const totalRentalIncome = totalGrossRent - totalCashExp
    const ownershipDays = (() => {
      const from = startDate
      const to = soldDate
      if (!from || !to) return null
      return Math.round((new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24))
    })()
    const ownershipYears = ownershipDays !== null ? ownershipDays / 365.25 : null
    const annualGrowthRate = isSold && p.property.sold_price && costBasis > 0 && ownershipYears && ownershipYears > 0
      ? (Math.pow(p.property.sold_price / costBasis, 1 / ownershipYears) - 1) * 100
      : null

    const isPpor = p.property.usage === 'ppor'
    const activeDays = !isSold && startDate
      ? Math.round((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
      : null
    const activeYears = activeDays && activeDays > 0 ? activeDays / 365.25 : null
    const activeEstGain = !isSold && val > 0 && costBasis > 0 ? val - costBasis : null
    const activeGrowthRate = !isSold && val > 0 && costBasis > 0 && activeYears && activeYears > 0
      ? (Math.pow(val / costBasis, 1 / activeYears) - 1) * 100
      : null

    return { val, debt, equity, ltv, grossRent, grossYield, netYield, netResult, latestFy, chartData, growthChartData, annualTicks, soldFy, purchaseFy, isSold, estimatedGain, totalRentalIncome, annualGrowthRate, costBasis, ownershipDays, isPpor, activeEstGain, activeGrowthRate, contractAmt, totalAcq, totalCapEx, totalDepr }
  }, [p])

  const prop = p.property

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Hero card */}
      <div style={CARD}>
        <div style={{ background: '#0c1929', padding: '22px 28px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#f7c925', marginBottom: 8 }}>Property Performance</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-.3px', lineHeight: 1.1 }}>{prop.name}</div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', marginTop: 5 }}>{prop.street_address}, {prop.suburb} {prop.state} {prop.postcode}</div>
            </div>
            <span style={{ padding: '4px 12px', background: 'rgba(247,201,37,.15)', color: '#f7c925', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', borderRadius: 6 }}>
              {prop.usage === 'investment' ? 'Investment' : prop.usage === 'ppor' ? 'PPOR' : 'Mixed'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.1)' }}>
            {(data.isSold ? [
              { label: 'Sold Price', value: prop.sold_price ? formatCompact(prop.sold_price) : '—', sub: prop.sold_date ? `Settled ${prop.sold_date}` : 'Settlement date unknown' },
              { label: 'Cost Basis', value: data.costBasis > 0 ? formatCompact(data.costBasis) : '—', sub: 'Purchase + construction' },
              { label: 'Realised Capital Gain (est.)', value: data.estimatedGain !== null ? formatCompact(data.estimatedGain) : '—', sub: 'Net proceeds − cost basis', pos: data.estimatedGain !== null && data.estimatedGain > 0 },
              { label: 'Avg. Capital Growth', value: data.annualGrowthRate !== null ? `${data.annualGrowthRate.toFixed(1)}% p.a.` : '—', sub: 'Compounded annual return' },
              (() => { const fmt = (n: number) => n < 0 ? `(${formatCompact(Math.abs(n))})` : formatCompact(n); const pa = data.ownershipDays && data.ownershipDays > 0 ? Math.round(data.totalRentalIncome / data.ownershipDays * 365) : null; return { label: 'Net Rental Result', value: data.totalRentalIncome !== 0 ? `${fmt(data.totalRentalIncome)}${pa !== null ? ` / ${fmt(pa)} p.a.` : ''}` : '—', sub: 'Income minus expenses', neg: data.totalRentalIncome < 0 } })()
            ] : data.isPpor ? [
              { label: 'Current Value', value: data.val > 0 ? formatCompact(data.val) : '—', sub: p.isValFallback ? 'Purchase cost (est.)' : 'Latest valuation' },
              { label: 'Loan Balance', value: data.debt > 0 ? formatCompact(data.debt) : '—', sub: `${p.activeLoans.length} loan${p.activeLoans.length !== 1 ? 's' : ''}` },
              { label: 'Equity', value: data.val > 0 ? formatCompact(Math.abs(data.equity)) : '—', sub: data.equity < 0 ? 'Negative equity' : `LTV ${data.ltv !== null ? data.ltv.toFixed(0) : '—'}%`, neg: data.equity < 0 },
              { label: 'Est. Capital Gain', value: data.activeEstGain !== null ? formatCompact(data.activeEstGain) : '—', sub: 'Current value − cost basis', pos: data.activeEstGain !== null && data.activeEstGain > 0 },
              { label: 'Growth p.a.', value: data.activeGrowthRate !== null ? `${data.activeGrowthRate.toFixed(1)}% p.a.` : '—', sub: 'Compounded annual return' },
            ] : [
              { label: 'Current Value', value: data.val > 0 ? formatCompact(data.val) : '—', sub: p.isValFallback ? 'Purchase cost (est.)' : 'Latest valuation' },
              { label: 'Loan Balance', value: data.debt > 0 ? formatCompact(data.debt) : '—', sub: `${p.activeLoans.length} loan${p.activeLoans.length !== 1 ? 's' : ''}` },
              { label: 'Equity', value: data.val > 0 ? formatCompact(Math.abs(data.equity)) : '—', sub: data.equity < 0 ? 'Negative equity' : `LTV ${data.ltv !== null ? data.ltv.toFixed(0) : '—'}%`, neg: data.equity < 0 },
              { label: `${data.latestFy} Gross Yield`, value: data.grossYield !== null ? `${data.grossYield.toFixed(1)}%` : '—', sub: `${data.latestFy} gross rent` },
              { label: `${data.latestFy} Net Yield`, value: data.netYield !== null ? `${data.netYield >= 0 ? '+' : ''}${data.netYield.toFixed(1)}%` : '—', sub: 'After all deductions', neg: data.netYield !== null && data.netYield < 0 },
            ]).map((k, i) => (
              <div key={k.label} style={{ paddingRight: i < 4 ? 20 : 0 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, color: (k as {neg?: boolean}).neg ? '#fca5a5' : (k as {pos?: boolean}).pos ? '#86efac' : '#fff', fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginTop: 5 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PPOR — tax not applicable notice */}
      {data.isPpor && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>⚠</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#c2410c', marginBottom: 3 }}>ATO Rental Schedule Not Applicable — PPOR</div>
            <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.5 }}>
              This property is classified as your Principal Place of Residence (PPOR). Rental income and deductions under the ATO Rental Property Schedule (NAT 1836) generally do not apply for periods it was your primary residence. Capital gains may be exempt or partially exempt under the main residence exemption. Consult your accountant before lodging any tax return based on this report.
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      {data.chartData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 18 }}>
          <div style={CARD}>
            <div style={{ padding: '16px 22px 4px' }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Capital Growth</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{data.soldFy ? `Full ownership period${data.purchaseFy ? ` · ${data.purchaseFy}–${data.soldFy}` : ''} (sold)` : data.purchaseFy ? `Property value, debt and equity · from ${data.purchaseFy}` : 'Property value, debt and equity'}</div>
            </div>
            <div style={{ padding: '8px 22px 20px' }}>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
                  <XAxis dataKey="fy" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compactTick} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="Value" name="Value" stroke="#0c1929" strokeWidth={2} fill="rgba(12,25,41,0.06)" connectNulls />
                  <Area type="monotone" dataKey="Debt" name="Debt" stroke="#2563a8" strokeWidth={2} fill="rgba(37,99,168,0.08)" connectNulls />
                  <Area type="monotone" dataKey="Equity" name="Equity" stroke="#f7c925" strokeWidth={2.5} fill="rgba(247,201,37,0.12)" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
                {[{ label: 'Value', color: '#0c1929' }, { label: 'Debt', color: '#2563a8' }, { label: 'Equity', color: '#f7c925' }].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                    <div style={{ width: 12, height: 2, background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {data.isPpor ? (
            <div style={CARD}>
              <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Est. Capital Gain</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Current value minus adjusted cost basis</div>
              </div>
              <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(() => {
                  const row = (label: string, value: string, color?: string, bold?: boolean, topBorder?: boolean) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, paddingTop: topBorder ? 8 : 0, borderTop: topBorder ? '1px solid #e4e7f0' : undefined, marginTop: topBorder ? 4 : 0 }}>
                      <span style={{ color: '#5c6478' }}>{label}</span>
                      <span style={{ color: color ?? '#1a1e2e', fontWeight: bold ? 800 : 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
                    </div>
                  )
                  const fmt = (n: number) => n < 0 ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n)
                  const gain = data.activeEstGain
                  return (
                    <>
                      {row('Current value', data.val > 0 ? formatCurrency(data.val) : '—', '#1a1e2e', true)}
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 6, marginBottom: 2 }}>Cost basis</div>
                      {(p.property.purchase_price ?? 0) > 0 && row('Purchase price', formatCurrency(p.property.purchase_price ?? 0))}
                      {data.contractAmt > 0 && row('Construction contract', formatCurrency(data.contractAmt))}
                      {data.totalAcq > 0 && row('Acquisition costs', formatCurrency(data.totalAcq))}
                      {data.totalCapEx > 0 && row('Capital improvements', formatCurrency(data.totalCapEx))}
                      {row('Cost basis total', formatCurrency(data.costBasis), '#374151', true, true)}
                      {data.totalDepr > 0 && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, paddingTop: 4 }}>Note: {formatCurrency(data.totalDepr)} depreciation claimed — does not reduce CGT cost base.</div>}
                      {row('Est. capital gain', gain !== null ? fmt(gain) : '—', gain !== null && gain >= 0 ? '#15803d' : '#b91c1c', true, true)}
                    </>
                  )
                })()}
              </div>
            </div>
          ) : (
            <div style={CARD}>
              <div style={{ padding: '16px 22px 4px' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Net Rental Result</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Annual result after all expenses</div>
              </div>
              <div style={{ padding: '8px 22px 20px' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.chartData.filter(d => d.netResult !== null)} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} maxBarSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
                    <XAxis dataKey="fy" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compactTick} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={0} stroke="#e4e7f0" strokeWidth={1.5} />
                    <Bar dataKey="cashNet" name="Cash Result" stackId="r" isAnimationActive={false} fill="#0c1929" />
                    <Bar dataKey="nonCash" name="Non-Cash (Dep.)" stackId="r" isAnimationActive={false} fill="rgba(12,25,41,0.22)" radius={[0, 0, 2, 2]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                    <div style={{ width: 10, height: 10, background: '#0c1929', borderRadius: 2 }} />Cash
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                    <div style={{ width: 10, height: 10, background: 'rgba(12,25,41,0.22)', border: '1px solid rgba(12,25,41,0.3)', borderRadius: 2 }} />Non-cash (dep.)
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cashflow summary table — latest FY (investment only) */}
      {!data.isPpor && !data.isSold && <div style={CARD}>
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{data.latestFy} Cashflow Summary</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>For detailed ATO breakdown, use the Tax report</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, padding: 1 }}>
          {[
            { label: 'Gross Rent', value: data.grossRent > 0 ? formatCurrency(data.grossRent) : '—', color: '#15803d' },
            { label: 'Operating Expenses', value: formatCurrency(p.allTransactions.filter(t => t.financial_year === data.latestFy && t.amount < 0 && t.type !== 'principal_payment' && t.type !== 'depreciation').reduce((s, t) => s + Math.abs(t.amount), 0)), color: '#b91c1c' },
            { label: 'Non-Cash Deductions', value: (() => { const dep = p.depreciation.find(d => d.financial_year === data.latestFy); const amt = (dep?.division_43_amount ?? 0) + (dep?.plant_equipment_amount ?? 0); return amt > 0 ? formatCurrency(amt) : '—' })(), color: '#6b7280' },
            { label: 'Net Result', value: data.netResult !== 0 ? (data.netResult < 0 ? `(${formatCurrency(Math.abs(data.netResult))})` : formatCurrency(data.netResult)) : '—', color: data.netResult < 0 ? '#b91c1c' : '#15803d', bold: true },
          ].map(item => (
            <div key={item.label} style={{ padding: '18px 20px', background: '#fff', border: '1px solid #e4e7f0', margin: -1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 18, fontWeight: item.bold ? 900 : 700, color: item.color, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>}

      {/* Loan details */}
      {p.activeLoans.length > 0 && (
        <div style={CARD}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Loan Details</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px 90px 110px 100px 90px', gap: 12, padding: '8px 22px', borderBottom: '1px solid #f0f2f7', background: '#f9fafb' }}>
            {[['Lender', 'left'], ['Paid Down', 'left'], ['Balance', 'right'], ['Rate', 'right'], ['Repayment', 'left'], ['IO Expiry', 'right']].map(([h, a]) => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: a as 'left' | 'right' }}>{h}</div>
            ))}
          </div>
          {p.activeLoans.map((loan, i) => {
            const paid = loan.original_amount - loan.currentBalance
            const paidPct = loan.original_amount > 0 ? Math.min(100, (paid / loan.original_amount) * 100) : 0
            const ioMonths = loan.ioExpiryDate
              ? (new Date(loan.ioExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
              : null
            const expiryColor = ioMonths !== null && ioMonths <= 3 ? '#dc2626' : ioMonths !== null && ioMonths <= 6 ? '#b45309' : '#374151'
            const startYear = new Date(loan.start_date).getFullYear()
            const endYear = startYear + loan.loan_term_years
            return (
              <div key={loan.id} style={{ display: 'grid', gridTemplateColumns: '1fr 220px 90px 110px 100px 90px', gap: 12, padding: '14px 22px', borderBottom: i < p.activeLoans.length - 1 ? '1px solid #e4e7f0' : 'none', alignItems: 'center', fontSize: 13 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{loan.lender}</div>
                  <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                    {loan.account_suffix ? `…${loan.account_suffix} · ` : ''}{loan.purpose === 'investment' ? 'Investment' : 'Owner-occ.'} · matures {endYear}
                  </div>
                </div>
                <div>
                  <div style={{ height: 4, background: '#e4e7f0', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ width: `${paidPct}%`, height: '100%', background: '#f7c925' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#9ca3af' }}>
                    <span>{paidPct.toFixed(0)}% paid</span>
                    <span>{formatCompact(paid)} of {formatCompact(loan.original_amount)}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatCompact(loan.currentBalance)}</div>
                <div style={{ textAlign: 'right' }}>{loan.interest_rate.toFixed(2)}% <span style={{ color: '#9ca3af', fontSize: 11 }}>({loan.rate_type})</span></div>
                <div style={{ fontSize: 12, color: '#374151' }}>{loan.repayment_type === 'interest_only' ? 'Interest Only' : 'P&I'}</div>
                <div style={{ textAlign: 'right', fontWeight: ioMonths !== null && ioMonths <= 6 ? 700 : 400, color: expiryColor, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {loan.ioExpiryDate ?? '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
