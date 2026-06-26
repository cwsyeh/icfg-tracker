'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import { formatCurrency, calculateLoanBalance, getFinancialYear } from '@/lib/utils/finance'
import type { Property, Loan, Valuation, Transaction, DepreciationSchedule, LoanBalance, LoanSecurity, PropertyAcquisitionCost, AcquisitionCostType, PropertySaleCost, SaleCostType, ConstructionProgressPayment } from '@/lib/types/database'

type EnrichedLoan = Loan & { current_balance: number; io_expiry_date: string | null }

interface Props {
  property: Property
  sharePercentage: number
  valuations: Valuation[]
  loans: EnrichedLoan[]
  loanBalances: LoanBalance[]
  loanSecurities: LoanSecurity[]
  userProperties: Pick<Property, 'id' | 'name'>[]
  latestSecurityValuations: Record<string, number>
  transactions: Transaction[]
  depreciation: DepreciationSchedule[]
  latestValuation: number | null
  totalLoanBalance: number
  equity: number | null
  ltv: number | null
}

const TABS = ['Overview', 'Finance', 'Transactions']
const GOLD = '#f7c925'
const BLUE = '#2563a8'
const NAVY = '#0c1929'
const CHART_COLORS = ['#2563a8', '#f7c925', '#15803d', '#c8332a', '#7c3aed', '#ea580c']

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)',
  padding: '20px 22px', marginBottom: 16,
}
const lbl: React.CSSProperties = { fontSize: 10.5, color: '#9ca3af', marginBottom: 3 }
const val: React.CSSProperties = { fontSize: 13.5, color: '#1a1e2e', fontWeight: 500 }
const sHead: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase',
  letterSpacing: '.08em', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #e4e7f0',
}

// ── Delayed Tooltip ───────────────────────────────────────────
function DelayedTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mousePos = useRef({ x: 0, y: 0 })

  const onEnter = useCallback((e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY }
    timer.current = setTimeout(() => setPos({ ...mousePos.current }), 1000)
  }, [])
  const onMove = useCallback((e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onLeave = useCallback(() => {
    clearTimeout(timer.current)
    setPos(null)
  }, [])

  return (
    <div onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
      {pos && text && (
        <div style={{
          position: 'fixed', left: pos.x + 12, top: pos.y - 36, zIndex: 200,
          background: '#1a1e2e', color: '#fff', padding: '7px 11px',
          borderRadius: 7, fontSize: 12, maxWidth: 320, whiteSpace: 'normal',
          lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><div style={lbl}>{label}</div><div style={val}>{value}</div></div>
}

// ── LTV Donut ────────────────────────────────────────────────
function LTVDonut({ equity, debt }: { equity: number; debt: number }) {
  const total = equity + debt
  if (total <= 0) return null
  const data = [
    { name: 'Equity', value: Math.max(0, equity) },
    { name: 'Debt', value: debt },
  ]
  const ltv = Math.round((debt / total) * 100)
  return (
    <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
      <PieChart width={140} height={140}>
        <Pie data={data} cx={65} cy={65} innerRadius={44} outerRadius={62} dataKey="value" strokeWidth={0}>
          <Cell fill={GOLD} />
          <Cell fill={BLUE} />
        </Pie>
      </PieChart>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: NAVY, lineHeight: 1 }}>{ltv}%</div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>LTV</div>
      </div>
    </div>
  )
}

// ── Valuation Growth Chart ────────────────────────────────────
interface ValuationPoint {
  date: string
  value: number
  label: string
  stageName?: string
}

function ValuationChart({ valuations, purchasePrice, purchaseDate, constructionPoints, completionDate, completionBaseValue, soldDate, soldPrice }: {
  valuations: Valuation[]
  purchasePrice: number | null
  purchaseDate: string | null
  constructionPoints?: ValuationPoint[]
  completionDate?: string | null
  completionBaseValue?: number
  soldDate?: string | null
  soldPrice?: number | null
}) {
  const isHnL = constructionPoints !== undefined
  const isConstructionComplete = isHnL && !!completionDate && completionBaseValue != null && completionBaseValue > 0

  const data = useMemo(() => {
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
    const points: ValuationPoint[] = []
    if (constructionPoints && constructionPoints.length > 0) {
      points.push(...constructionPoints)
    } else if (purchaseDate && purchasePrice) {
      points.push({ date: purchaseDate, value: purchasePrice, label: new Date(purchaseDate).getFullYear().toString(), stageName: 'Purchase' })
    }
    ;[...valuations].reverse().forEach(v => {
      points.push({ date: v.valuation_date, value: v.amount, label: new Date(v.valuation_date).getFullYear().toString(), stageName: 'Valuation' })
    })
    if (soldDate && soldPrice) {
      points.push({ date: soldDate, value: soldPrice, label: fmtDate(soldDate), stageName: 'Sale' })
    }
    return points
  }, [valuations, purchasePrice, purchaseDate, constructionPoints, soldDate, soldPrice])

  if (data.length < 2) return (
    <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
      {isHnL ? 'Draw progress payments to track construction value' : 'Add valuations to see growth chart'}
    </div>
  )

  const growthBase = isConstructionComplete ? completionBaseValue! : data[0].value
  const latestValue = data[data.length - 1].value
  const growthPct = ((latestValue - growthBase) / growthBase * 100).toFixed(1)
  const growthPositive = latestValue >= growthBase

  const growthLabel = isConstructionComplete
    ? 'Growth since completion'
    : isHnL
      ? 'Growth since land settlement'
      : 'Growth since purchase'

  const basePriceLabel = isConstructionComplete
    ? 'Land + build cost'
    : isHnL
      ? 'Land price'
      : 'Purchase price'

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div>
          <div style={lbl}>{growthLabel}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: growthPositive ? '#15803d' : '#c8332a' }}>
            {growthPositive ? '+' : ''}{growthPct}%
          </div>
        </div>
        <div>
          <div style={lbl}>{basePriceLabel}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{formatCurrency(isConstructionComplete ? completionBaseValue! : data[0].value)}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity={0.2} />
              <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as ValuationPoint
              return (
                <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  {p.stageName && <div style={{ color: '#5c6478', marginBottom: 3, fontWeight: 600 }}>{p.stageName}</div>}
                  <div style={{ fontWeight: 800, color: '#1a1e2e' }}>{formatCurrency(p.value)}</div>
                  <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                    {new Date(p.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              )
            }}
          />
          <Area type="monotone" dataKey="value" stroke={GOLD} strokeWidth={2.5} fill="url(#valGrad)" dot={{ fill: GOLD, r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Construction interest capitalisation estimator ────────────
// Methodology: monthly charge on drawn balance at the start of each month.
// Land loan proxy = purchase_price (fully drawn at settlement).
// Construction balance steps up at the start of each month based on
// stages drawn in the prior month — no intra-month arithmetic needed.
// Final partial month is pro-rated by calendar days (ATO-standard).
function estimateConstructionInterest({
  progressPayments,
  annualRatePct,
  landPrice,
  constructionStartDate,
  completionDate,
}: {
  progressPayments: ConstructionProgressPayment[]
  annualRatePct: number
  landPrice: number
  constructionStartDate: string | null
  completionDate: string | null
}): number {
  if (!constructionStartDate || annualRatePct <= 0 || landPrice <= 0) return 0
  const start = new Date(constructionStartDate)
  const end = completionDate ? new Date(completionDate) : new Date()
  if (end <= start) return 0

  const monthlyRate = annualRatePct / 100 / 12

  const allDrawn = progressPayments
    .filter(p => p.drawn_date)
    .sort((a, b) => new Date(a.drawn_date!).getTime() - new Date(b.drawn_date!).getTime())

  const drawnAmt = (p: ConstructionProgressPayment) =>
    (p.bank_amount != null || p.self_amount != null)
      ? (p.bank_amount ?? 0) + (p.self_amount ?? 0)
      : (p.amount ?? 0)

  // Construction balance drawn as at the start of a given month
  const constructionBalanceAt = (monthStart: Date) =>
    allDrawn
      .filter(p => new Date(p.drawn_date!) < monthStart)
      .reduce((s, p) => s + drawnAmt(p), 0)

  let totalInterest = 0
  let monthStart = new Date(start.getFullYear(), start.getMonth(), 1)

  while (monthStart < end) {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
    const balance = landPrice + constructionBalanceAt(monthStart)
    const monthlyInterest = balance * monthlyRate

    if (monthEnd <= end) {
      totalInterest += monthlyInterest
    } else {
      // Pro-rate the final partial month by calendar days
      const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / 86400000
      const daysInPeriod = (end.getTime() - monthStart.getTime()) / 86400000
      totalInterest += monthlyInterest * (daysInPeriod / daysInMonth)
    }

    monthStart = monthEnd
  }

  return Math.round(totalInterest)
}

// Expense types that qualify as holding costs during construction
const CAPITALISATION_TYPES = new Set([
  'interest_expense', 'council_rates', 'water_rates', 'insurance',
  'strata_body_corp', 'bank_fees',
])

// Whether a transaction auto-qualifies for capitalisation based on construction window + type
function isAutoCapitalised(tx: Transaction, startDate: string | null, endDate: string | null): boolean {
  if (!startDate) return false
  if (!CAPITALISATION_TYPES.has(tx.type)) return false
  if (tx.amount >= 0) return false
  if (tx.transaction_date < startDate) return false
  if (endDate && tx.transaction_date > endDate) return false
  return true
}

// Effective capitalised state: null=auto, true=forced-in, false=forced-out
function effectiveCapitalised(tx: Transaction, startDate: string | null, endDate: string | null): boolean {
  if (tx.capitalised === false) return false
  if (tx.capitalised === true) return true
  return isAutoCapitalised(tx, startDate, endDate)
}

// Returns both the actual confirmed interest (from recorded transactions) and
// the monthly estimate — callers decide what goes into the cost base (actual only)
// and what to show as a reference comparison (estimate).
// Actual: sum interest_expense txs from construction start; pro-rate the period
// that spans completion. Estimate: always computed for comparison regardless.
function resolveCapitalisedInterest({
  transactions,
  progressPayments,
  annualRatePct,
  landPrice,
  constructionStartDate,
  completionDate,
}: {
  transactions: Transaction[]
  progressPayments: ConstructionProgressPayment[]
  annualRatePct: number
  landPrice: number
  constructionStartDate: string | null
  completionDate: string | null
}): { actual: number; estimated: number; hasActual: boolean } {
  const estimated = estimateConstructionInterest({ progressPayments, annualRatePct, landPrice, constructionStartDate, completionDate })

  if (!constructionStartDate) return { actual: 0, estimated, hasActual: false }

  // Actual = sum of all effectively-capitalised transactions (user-flagged or auto-qualified)
  const capitalisedTxs = transactions.filter(tx =>
    effectiveCapitalised(tx, constructionStartDate, completionDate)
  )

  if (capitalisedTxs.length > 0) {
    const total = capitalisedTxs.reduce((s, tx) => s + Math.abs(tx.amount), 0)
    return { actual: Math.round(total), estimated, hasActual: true }
  }

  return { actual: 0, estimated, hasActual: false }
}

// ── Multi-Loan Amortisation Chart ─────────────────────────────
function piBalanceAt(principal: number, monthlyRate: number, totalMonths: number, elapsed: number): number {
  if (totalMonths <= 0) return principal
  if (monthlyRate === 0) return Math.max(0, principal - (principal / totalMonths) * elapsed)
  const pmt = principal * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) / (Math.pow(1 + monthlyRate, totalMonths) - 1)
  return Math.max(0, principal * Math.pow(1 + monthlyRate, elapsed) - pmt * (Math.pow(1 + monthlyRate, elapsed) - 1) / monthlyRate)
}

function computeLoanPoints(loan: EnrichedLoan): { year: number; balance: number }[] {
  const start = new Date(loan.start_date)
  const n = loan.loan_term_years * 12
  const monthlyRate = loan.interest_rate / 100 / 12
  const ioM = loan.io_expiry_date
    ? Math.max(0, (new Date(loan.io_expiry_date).getFullYear() - start.getFullYear()) * 12 + (new Date(loan.io_expiry_date).getMonth() - start.getMonth()))
    : (loan.io_period_years ?? 0) * 12
  const isIO = loan.repayment_type === 'interest_only' || loan.repayment_type === 'interest_in_advance'

  // Reforecast: from rfM onwards, use rfBal + current rate + remaining term
  const rfM = loan.reforecast_date
    ? Math.max(0, (new Date(loan.reforecast_date).getFullYear() - start.getFullYear()) * 12 + (new Date(loan.reforecast_date).getMonth() - start.getMonth()))
    : null
  const rfBal = loan.reforecast_balance != null ? Number(loan.reforecast_balance) : null

  const points = []
  for (let m = 0; m <= n; m += 6) {
    const d = new Date(start)
    d.setMonth(d.getMonth() + m)
    const x = d.getFullYear() + d.getMonth() / 12
    let bal: number

    if (rfM !== null && rfBal !== null && m >= rfM) {
      // Post-reforecast: P&I from rfBal with current rate, remaining term to original maturity
      bal = piBalanceAt(rfBal, monthlyRate, n - rfM, m - rfM)
    } else if (isIO) {
      if (m <= ioM) {
        bal = loan.original_amount
      } else {
        bal = piBalanceAt(loan.original_amount, monthlyRate, n - ioM, m - ioM)
      }
    } else {
      bal = piBalanceAt(loan.original_amount, monthlyRate, n, m)
    }
    points.push({ year: x, balance: Math.round(bal) })
  }
  return points
}

function loanLabel(loan: EnrichedLoan) {
  return `${loan.lender}${loan.account_suffix ? ` · ${loan.account_suffix}` : ''}`
}

// Decimal year: 2024 + month/12 (month 0-indexed). Jan 2024 → 2024.0, Jul 2024 → 2024.5
function toDecimalYear(dateStr: string): number {
  const d = new Date(dateStr)
  return d.getFullYear() + d.getMonth() / 12
}

function MultiLoanChart({ loans, loanBalances }: { loans: EnrichedLoan[], loanBalances: LoanBalance[] }) {
  const { data, keys, actualKeys, minX, maxX } = useMemo(() => {
    if (loans.length === 0) return { data: [], keys: [], actualKeys: [], minX: 0, maxX: 0 }
    const allXValues = new Set<number>()
    const byKey: Record<string, Record<number, number>> = {}
    const actualByKey: Record<string, Record<number, number>> = {}
    const actualKeysList: string[] = []

    loans.forEach(loan => {
      const k = loanLabel(loan)
      byKey[k] = {}
      computeLoanPoints(loan).forEach(p => {
        allXValues.add(p.year)
        byKey[k][p.year] = p.balance
      })

      // Actual paydown: one point per recorded snapshot (monthly granularity)
      const balances = loanBalances
        .filter(b => b.loan_id === loan.id)
        .sort((a, b) => a.balance_date.localeCompare(b.balance_date))

      if (balances.length > 0) {
        const ak = `${k}||actual`
        actualByKey[ak] = {}
        // Start anchor at exact loan origination date
        const startX = toDecimalYear(loan.start_date)
        actualByKey[ak][startX] = loan.original_amount
        allXValues.add(startX)
        // Each snapshot at its own decimal year (redraws cause balance to go up — handled naturally)
        balances.forEach(b => {
          const x = toDecimalYear(b.balance_date)
          allXValues.add(x)
          actualByKey[ak][x] = Number(b.balance)
        })
        actualKeysList.push(ak)
      }
    })

    const sortedXValues = Array.from(allXValues).sort((a, b) => a - b)
    const rows = sortedXValues.map(x => {
      const row: Record<string, number | null> = { x }
      Object.entries(byKey).forEach(([k, vals]) => { row[k] = vals[x] !== undefined ? vals[x] : null })
      Object.entries(actualByKey).forEach(([k, vals]) => { row[k] = vals[x] !== undefined ? vals[x] : null })
      return row
    })
    const lo = sortedXValues[0] ?? 0
    const hi = sortedXValues[sortedXValues.length - 1] ?? 0
    return { data: rows, keys: Object.keys(byKey), actualKeys: actualKeysList, minX: Math.floor(lo), maxX: Math.ceil(hi) }
  }, [loans, loanBalances])

  if (data.length === 0) return null

  const hasActual = actualKeys.length > 0

  const yearTicks = Array.from({ length: maxX - minX + 1 }, (_, i) => minX + i)

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={[minX, maxX]}
            ticks={yearTicks}
            tickFormatter={(x: number) => String(Math.round(x))}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            formatter={(v: unknown, name: unknown) => {
              const n = String(name)
              const label = n.endsWith('||actual')
                ? `${n.replace('||actual', '')} (actual)`
                : n
              return [formatCurrency(Number(v)), label]
            }}
            labelFormatter={(label) => {
              const x = Number(label)
              const year = Math.floor(x)
              const month = Math.round((x - year) * 12)
              if (month === 0) return String(year)
              const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${names[month] ?? ''} ${year}`
            }}
            contentStyle={{ fontSize: 12, border: '1px solid #e4e7f0', borderRadius: 8 }}
            labelStyle={{ color: '#5c6478' }}
          />
          {/* Scheduled amortisation — dotted */}
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} strokeDasharray="4 3" dot={false} opacity={0.7} connectNulls={true} />
          ))}
          {/* Actual paydown — monthly granularity, handles redraws naturally */}
          {actualKeys.map(ak => {
            const baseKey = ak.replace('||actual', '')
            const i = keys.indexOf(baseKey)
            const color = CHART_COLORS[i % CHART_COLORS.length]
            return (
              <Line
                key={ak}
                type="linear"
                dataKey={ak}
                stroke={color}
                strokeWidth={2.5}
                connectNulls={true}
                dot={(props: { cx?: number; cy?: number; index?: number; value?: number }) => {
                  const loan = loans.find(l => loanLabel(l) === baseKey)
                  const rowX = (data[props.index ?? 0] as Record<string, number | null>)?.x as number | undefined
                  const startX = loan ? toDecimalYear(loan.start_date) : null
                  // Only show dot at January (month 0) or July (month 6)
                  const rowMonth = rowX != null ? Math.round((rowX - Math.floor(rowX)) * 12) : -1
                  const isSixMonthMark = rowMonth === 0 || rowMonth === 6
                  const isActualPoint = props.value != null && rowX !== startX && isSixMonthMark
                  if (!isActualPoint || props.cx == null || props.cy == null) return <g key={props.index} />
                  return (
                    <g key={props.index}>
                      <circle cx={props.cx} cy={props.cy} r={4} fill={color} stroke="#fff" strokeWidth={2} />
                    </g>
                  )
                }}
                legendType="none"
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {keys.map((k, i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth="2" strokeDasharray="4 3" opacity="0.7"/></svg>
            <span style={{ fontSize: 11.5, color: '#5c6478' }}>{k} (scheduled)</span>
          </div>
        ))}
        {hasActual && (
          <>
            <div style={{ width: 1, height: 14, background: '#e4e7f0', margin: '0 2px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#5c6478" strokeWidth="2.5"/></svg>
              <span style={{ fontSize: 11.5, color: '#5c6478' }}>Actual paydown</span>
            </div>
          </>
        )}
      </div>

      {/* Ahead / behind callout */}
      {hasActual && (() => {
        const callouts = loans.flatMap(l => {
            const latest = [...loanBalances]
              .filter(b => b.loan_id === l.id)
              .sort((a, b) => b.balance_date.localeCompare(a.balance_date))[0]
            if (!latest) return []
            const scheduled = calculateLoanBalance({
              originalAmount: l.original_amount,
              annualRate: l.interest_rate,
              termYears: l.loan_term_years,
              startDate: l.start_date,
              repaymentType: l.repayment_type,
              ioExpiryDate: l.io_expiry_date,
              ioPeriodYears: l.io_period_years ?? 0,
              asOfDate: latest.balance_date,
            })
            const diff = scheduled - Number(latest.balance)
            return [{ label: loanLabel(l), diff, balance_date: latest.balance_date }]
          })
        if (callouts.length === 0) return null
        return (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {callouts.map(c => (
              <div key={c.label} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 20, background: c.diff > 0 ? '#dcfce7' : c.diff < 0 ? '#fef2f2' : '#f0f2f7', color: c.diff > 0 ? '#15803d' : c.diff < 0 ? '#c8332a' : '#5c6478', fontWeight: 600 }}>
                {c.label} — {c.diff > 0 ? `${formatCurrency(c.diff)} ahead of schedule` : c.diff < 0 ? `${formatCurrency(Math.abs(c.diff))} behind schedule` : 'on schedule'} as of {c.balance_date}
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

// ── Transaction Category Pie ──────────────────────────────────
const TX_SHORT_LABELS: Record<string, string> = {
  rent_income: 'Rent',
  other_income: 'Other income',
  interest_expense: 'Interest',
  principal_payment: 'Principal',
  council_rates: 'Council rates',
  water_rates: 'Water charges',
  insurance: 'Insurance',
  property_management_fee: 'Mgmt fee',
  repairs_maintenance: 'Repairs',
  advertising: 'Advertising',
  legal_fees: 'Legal fees',
  bank_fees: 'Bank fees',
  strata_body_corp: 'Strata / body corp',
  land_tax: 'Land tax',
  borrowing_expenses: 'Borrowing expenses',
  cleaning: 'Cleaning',
  capital_expense: 'Capital expense',
  depreciation: 'Depreciation',
  other_expense: 'Other expense',
}

const INCOME_TYPES = new Set(['rent_income', 'other_income'])
const EXCLUDE_FROM_BREAKDOWN = new Set(['principal_payment'])
const TX_PIE_COLORS: Record<string, string> = {
  rent_income: '#15803d', other_income: '#22c55e',
  property_management_fee: '#2563a8', repairs_maintenance: '#7c3aed',
  council_rates: '#ea580c', water_rates: '#06b6d4', insurance: '#f59e0b',
  strata_body_corp: '#8b5cf6', advertising: '#ec4899',
  bank_fees: '#6b7280', legal_fees: '#9f1239',
  land_tax: '#78350f', borrowing_expenses: '#c2410c', cleaning: '#0e7490',
  capital_expense: '#b45309', depreciation: '#4b5563',
  interest_expense: '#c8332a', principal_payment: '#1d4ed8',
  other_expense: '#94a3b8',
}

function TxPieChart({ transactions }: { transactions: Transaction[] }) {
  const pieData = useMemo(() => {
    const totals: Record<string, number> = {}
    transactions.filter(tx => !EXCLUDE_FROM_BREAKDOWN.has(tx.type)).forEach(tx => {
      const key = tx.type
      totals[key] = (totals[key] ?? 0) + Math.abs(tx.amount)
    })
    return Object.entries(totals)
      .map(([type, value]) => ({ name: TX_SHORT_LABELS[type] ?? type.replace(/_/g, ' '), type, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
  }, [transactions])

  const totalIncome = transactions.filter(tx => INCOME_TYPES.has(tx.type)).reduce((s, tx) => s + tx.amount, 0)
  const totalExpense = transactions.filter(tx => !INCOME_TYPES.has(tx.type) && !EXCLUDE_FROM_BREAKDOWN.has(tx.type)).reduce((s, tx) => s + Math.abs(tx.amount), 0)
  const grandTotal = totalIncome + totalExpense

  if (pieData.length === 0) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
      No transactions yet
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={lbl}>Income</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{formatCurrency(totalIncome)}</div>
          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{grandTotal > 0 ? `${Math.round(totalIncome / grandTotal * 100)}% of total` : '—'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={lbl}>Expenses</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#c8332a' }}>({formatCurrency(totalExpense)})</div>
          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{grandTotal > 0 ? `${Math.round(totalExpense / grandTotal * 100)}% of total` : '—'}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" outerRadius={72} dataKey="value" strokeWidth={0}>
            {pieData.map((entry) => (
              <Cell key={entry.type} fill={TX_PIE_COLORS[entry.type] ?? '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: unknown) => formatCurrency(Number(v))}
            contentStyle={{ fontSize: 11, border: '1px solid #e4e7f0', borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {(() => {
        const grandTotal = pieData.reduce((s, e) => s + e.value, 0)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {pieData.slice(0, 6).map(entry => (
              <div key={entry.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: TX_PIE_COLORS[entry.type] ?? '#94a3b8', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#5c6478', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#1a1e2e' }}>{formatCurrency(entry.value)}</span>
                  <span style={{ fontSize: 10.5, color: '#9ca3af', minWidth: 34, textAlign: 'right' }}>{grandTotal > 0 ? `${Math.round(entry.value / grandTotal * 100)}%` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

// ── Monthly Cashflow Chart ────────────────────────────────────
function currentFYInfo() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fyYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()
  const label = `FY${String(fyYear).slice(2)}`
  const from = `${fyYear - 1}-07-01`
  const to = `${fyYear}-06-30`
  // All months Jul–Jun, clipped to current month
  const currentYM = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const months: string[] = []
  let y = fyYear - 1, m = 7
  while (y < fyYear || m <= 6) {
    const ym = `${y}-${pad(m)}`
    if (ym <= currentYM) months.push(ym)
    m++; if (m > 12) { m = 1; y++ }
  }
  return { label, from, to, months }
}

function CashflowChart({ transactions, compact, fyOnly }: { transactions: Transaction[]; compact?: boolean; fyOnly?: boolean }) {
  const data = useMemo(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')

    let months: string[]
    if (fyOnly) {
      months = currentFYInfo().months
    } else if (transactions.length > 0) {
      // Derive month window from the transactions' date range
      const dates = transactions.map(tx => tx.transaction_date.slice(0, 7)).sort()
      const [fromY, fromM] = dates[0].split('-').map(Number)
      const [toY, toM] = dates[dates.length - 1].split('-').map(Number)
      months = []
      let y = fromY, m = fromM
      while (y < toY || (y === toY && m <= toM)) {
        months.push(`${y}-${pad(m)}`)
        m++; if (m > 12) { m = 1; y++ }
      }
    } else {
      months = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
      }
    }

    const byMonth: Record<string, { income: number; expense: number }> = {}
    months.forEach(m => { byMonth[m] = { income: 0, expense: 0 } })
    transactions.filter(tx => !EXCLUDE_FROM_BREAKDOWN.has(tx.type)).forEach(tx => {
      const month = tx.transaction_date.slice(0, 7)
      if (byMonth[month]) {
        if (tx.amount >= 0) byMonth[month].income += tx.amount
        else byMonth[month].expense += Math.abs(tx.amount)
      }
    })
    return months.map(month => ({
      month: month.slice(2),
      income: Math.round(byMonth[month].income),
      expense: Math.round(byMonth[month].expense),
    }))
  }, [transactions])

  return (
    <div>
      {!compact && <div style={{ borderTop: '1px solid #e4e7f0', margin: '20px 0 16px' }} />}
      {!compact && <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 14px' }}>Monthly Cashflow</h3>}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
          <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            formatter={(v: unknown, name: unknown) => [formatCurrency(Number(v)), String(name)]}
            contentStyle={{ fontSize: 11, border: '1px solid #e4e7f0', borderRadius: 8 }}
            labelStyle={{ color: '#5c6478' }}
          />
          <ReferenceLine y={0} stroke="#e4e7f0" />
          <Bar dataKey="income" name="Income" fill="#15803d" opacity={0.85} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expense" name="Expense" fill="#c8332a" opacity={0.75} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
        {[{ label: 'Income', color: '#15803d' }, { label: 'Expense', color: '#c8332a' }].map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} />
            <span style={{ fontSize: 11, color: '#5c6478' }}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────
type PendingImportRow = {
  transaction_date: string
  type: string
  amount: number
  description: string | null
  ownership_note: string | null
  financial_year: string
  duplicate: boolean
  removed?: boolean
}

type NewLoanForm = {
  lender: string; account_suffix: string; loan_limit: string
  interest_rate: string; rate_type: string; repayment_type: string
  loan_term_years: string; start_date: string; io_expiry_date: string
  fixed_rate_expiry: string; purpose: string; deductible_portion_percent: string
  refinanced_from_loan_id: string
}

const EMPTY_NEW_LOAN_FORM: NewLoanForm = {
  lender: '', account_suffix: '', loan_limit: '',
  interest_rate: '', rate_type: 'variable', repayment_type: 'principal_and_interest',
  loan_term_years: '30', start_date: '', io_expiry_date: '', fixed_rate_expiry: '',
  purpose: 'investment', deductible_portion_percent: '100', refinanced_from_loan_id: '',
}

const EMPTY_RF_FORM = {
  settlement_date: '', lender: '', account_suffix: '', loan_limit: '',
  interest_rate: '', rate_type: 'variable', repayment_type: 'principal_and_interest',
  loan_term_years: '', io_expiry_date: '', fixed_rate_expiry: '', purpose: '', notes: '',
}

type LoanStatementPreview = {
  loanId: string        // '' when auto-detect found no match
  loanLabel: string
  jobId: string | null
  balance: number
  balanceDate: string
  detectedRate: number | null
  applyRate: boolean
  rows: PendingImportRow[]
  balanceSnapshots: { date: string; balance: number }[]
  // from enhanced parser
  detectedLoanLimit: number | null
  detectedStartDate: string | null
  detectedLoanType: string | null
  // create new loan flow
  createMode: boolean
  newLoanForm: NewLoanForm | null
  // payout detection
  markClosed: boolean
}

// ── Main component ────────────────────────────────────────────
export default function PropertyTabs({ property, sharePercentage, valuations, loans, loanBalances, loanSecurities, userProperties, latestSecurityValuations, transactions, depreciation, latestValuation, totalLoanBalance, equity, ltv }: Props) {
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m) - 1] ?? m
    return `${d} ${mon} ${y}`
  }
  const [tab, setTab] = useState(0)

  // ── Acquisition costs ──
  const ACQ_LABELS: Record<AcquisitionCostType, string> = {
    stamp_duty: 'Stamp duty',
    legal_conveyancing: 'Legal / conveyancing',
    building_inspection: 'Building & pest inspection',
    buyers_agent: "Buyer's agent fee",
    qs_report: 'QS report',
    soil_test_da: 'Soil test / DA costs',
    loan_establishment: 'Loan establishment fee',
    other: 'Other',
  }
  const [acquisitionCosts, setAcquisitionCosts] = useState<PropertyAcquisitionCost[]>([])
  const [acqLoading, setAcqLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/properties/acquisition-costs?propertyId=${property.id}`)
      .then(r => r.json())
      .then(d => { if (d.costs) setAcquisitionCosts(d.costs) })
      .finally(() => setAcqLoading(false))
  }, [property.id])

  // ── Sale costs ──
  const SALE_LABELS: Record<SaleCostType, string> = {
    agent_commission: 'Agent commission',
    legal_conveyancing: 'Legal / conveyancing',
    advertising: 'Advertising / marketing',
    auction_fees: 'Auction fees',
    other: 'Other',
  }
  const [saleCosts, setSaleCosts] = useState<PropertySaleCost[]>([])
  const [saleOthersExpanded, setSaleOthersExpanded] = useState(false)
  const [editingSaleCosts, setEditingSaleCosts] = useState(false)
  const [saleForm, setSaleForm] = useState<{ type: SaleCostType; amount: string; description: string }[]>([])
  const [saleError, setSaleError] = useState<string | null>(null)
  const [saleSaving, setSaleSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/properties/sale-costs?propertyId=${property.id}`)
      .then(r => r.json())
      .then(d => { if (d.costs) setSaleCosts(d.costs) })
  }, [property.id])

  const [progressPayments, setProgressPayments] = useState<ConstructionProgressPayment[]>([])
  const [ppLoading, setPpLoading] = useState(false)

  useEffect(() => {
    if (property.property_type !== 'house_and_land') return
    setPpLoading(true)
    fetch(`/api/construction/progress-payments?propertyId=${property.id}`)
      .then(r => r.json())
      .then(d => { if (d.payments) setProgressPayments(d.payments) })
      .finally(() => setPpLoading(false))
  }, [property.id, property.property_type])

  // Sync local construction status from server after router.refresh() completes
  useEffect(() => {
    setLocalConstructionStatus(property.construction_status ?? 'pre_construction')
  }, [property.construction_status])

  const isArchived = property.status === 'archived'
  const isReadOnly = isArchived

  // When no formal valuation exists, fall back to purchase cost (land + build contract for H&L)
  const purchaseCostFallback = (property.purchase_price ?? 0) + (property.property_type === 'house_and_land' ? (property.construction_contract_amount ?? 0) : 0)
  const displayValuation = latestValuation ?? (purchaseCostFallback > 0 ? purchaseCostFallback : null)
  const isValuationFallback = latestValuation === null && displayValuation !== null

  // ── Capitalised overrides (local until next router.refresh) ──
  const [capOverrides, setCapOverrides] = useState<Record<string, boolean | null>>({})
  const txCapitalised = (tx: Transaction) => {
    const override = capOverrides[tx.id]
    if (override !== undefined) return override
    return tx.capitalised
  }
  const txEffectiveCapitalised = (tx: Transaction) =>
    effectiveCapitalised({ ...tx, capitalised: txCapitalised(tx) }, property.construction_start_date ?? null, property.construction_completion_date ?? null)

  // ── Overview edit modals ──
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({ name: '', street_address: '', suburb: '', state: '', postcode: '', usage: '', mixed_use_investment_percent: '', purchase_date: '', settlement_date: '', purchase_price: '' })
  type AcqRow = { type: AcquisitionCostType; amount: string; description: string }
  const [acqForm, setAcqForm] = useState<AcqRow[]>([])
  const [editingAcqCosts, setEditingAcqCosts] = useState(false)
  const [acqSaving, setAcqSaving] = useState(false)
  const [acqError, setAcqError] = useState<string | null>(null)
  const [localDepreciation, setLocalDepreciation] = useState<DepreciationSchedule[]>(depreciation)
  const [deprModalOpen, setDeprModalOpen] = useState(false)
  const [deprEditing, setDeprEditing] = useState<DepreciationSchedule | null>(null)
  const [deprForm, setDeprForm] = useState({ financial_year: 'FY25', division_43: '', plant_equipment: '', source: '', notes: '' })
  const [deprSaving, setDeprSaving] = useState(false)
  const [deprError, setDeprError] = useState<string | null>(null)
  const [deprParsing, setDeprParsing] = useState(false)
  const [deprParseError, setDeprParseError] = useState<string | null>(null)
  const [deprPreview, setDeprPreview] = useState<{ financial_year: string; plant_equipment_amount: number; division_43_amount: number; conflict: boolean }[] | null>(null)
  const [deprPreviewSource, setDeprPreviewSource] = useState('')
  const [deprConfirming, setDeprConfirming] = useState(false)
  const [deprPastCollapsed, setDeprPastCollapsed] = useState(true)
  const [acqOthersExpanded, setAcqOthersExpanded] = useState(false)
  const [deprDeleteMode, setDeprDeleteMode] = useState(false)
  const [deprSelected, setDeprSelected] = useState<Set<string>>(new Set())
  const [deprBulkDeleting, setDeprBulkDeleting] = useState(false)
  const [deprGenOpen, setDeprGenOpen] = useState(false)
  const [deprGenForm, setDeprGenForm] = useState({ div43_annual: '', div40_year1: '', div40_life: '10', schedule_start: '', source: '' })
  const deprFileInputRef = useRef<HTMLInputElement>(null)
  const [editingInsurance, setEditingInsurance] = useState(false)
  const [insuranceForm, setInsuranceForm] = useState({ insurance_provider: '', insurance_policy_number: '', insurance_expiry: '', insurance_premium: '', pm_agency: '', pm_name: '', pm_phone: '', pm_email: '', pm_fee_percent: '', lease_expiry_date: '', construction_builder: '', construction_contract_amount: '', construction_start_date: '', capitalise_construction_interest: false, construction_status: 'pre_construction' })
  const [editingBroker, setEditingBroker] = useState(false)
  const [brokerForm, setBrokerForm] = useState({ broker_name: '', broker_company: '', broker_phone: '', broker_email: '', broker_license: '' })
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(property.photo_url ?? null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── Property lifecycle modals ──
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showSoldModal, setShowSoldModal] = useState(false)
  const [soldForm, setSoldForm] = useState({ sold_date: '', sold_price: '', agent_commission: '', legal_conveyancing: '', advertising: '', auction_fees: '' })
  const [soldSaving, setSoldSaving] = useState(false)
  const [soldError, setSoldError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting2, setDeleting2] = useState(false)
  const [propDeleteError, setPropDeleteError] = useState<string | null>(null)

  async function markAsSold() {
    if (!soldForm.sold_date) { setSoldError('Sale date is required'); return }
    setSoldSaving(true); setSoldError(null)
    try {
      const res = await fetch('/api/properties/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates: { status: 'sold', sold_date: soldForm.sold_date, sold_price: soldForm.sold_price ? parseFloat(soldForm.sold_price) : null } })
      })
      const data = await res.json()
      if (!data.success) { setSoldError(data.error ?? 'Save failed'); return }
      // Save any sale costs entered in the modal
      const costEntries: { type: SaleCostType; amount: number; description: null }[] = []
      const costFields: [keyof typeof soldForm, SaleCostType][] = [
        ['agent_commission', 'agent_commission'], ['legal_conveyancing', 'legal_conveyancing'],
        ['advertising', 'advertising'], ['auction_fees', 'auction_fees'],
      ]
      for (const [field, type] of costFields) {
        const val = parseFloat(soldForm[field])
        if (!isNaN(val) && val > 0) costEntries.push({ type, amount: val, description: null })
      }
      if (costEntries.length > 0) {
        await fetch('/api/properties/sale-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, costs: costEntries }) })
        setSaleCosts(costEntries.map(c => ({ ...c, id: '', property_id: property.id, date: null, created_at: '' }) as PropertySaleCost))
      }
      setShowSoldModal(false); router.refresh()
    } catch { setSoldError('Network error') }
    finally { setSoldSaving(false) }
  }

  async function archiveProperty() {
    await fetch('/api/properties/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: property.id, updates: { status: 'archived' } })
    })
    router.push('/portfolio')
  }

  async function unsaleProperty() {
    await fetch('/api/properties/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: property.id, updates: { status: 'active', sold_date: null, sold_price: null } })
    })
    router.refresh()
  }

  async function restoreProperty() {
    await fetch('/api/properties/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: property.id, updates: { status: 'active' } })
    })
    router.refresh()
  }

  async function deleteProperty() {
    setDeleting2(true); setPropDeleteError(null)
    try {
      const res = await fetch('/api/properties/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, confirm: deleteConfirm })
      })
      const data = await res.json()
      if (data.success) { router.push('/portfolio') }
      else setPropDeleteError(data.error ?? 'Delete failed')
    } catch { setPropDeleteError('Network error') }
    finally { setDeleting2(false) }
  }

  // ── Construction complete modal ──
  const [showCompleteConstruction, setShowCompleteConstruction] = useState(false)
  const [completionDate, setCompletionDate] = useState('')
  const [completionSaving, setCompletionSaving] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  async function markConstructionComplete() {
    if (!completionDate) { setCompletionError('Completion date is required'); return }
    setCompletionSaving(true); setCompletionError(null)
    try {
      const res = await fetch('/api/properties/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates: { construction_status: 'completed', construction_completion_date: completionDate } })
      })
      const data = await res.json()
      if (!data.success) { setCompletionError(data.error ?? 'Save failed'); return }
      // Auto-mark any undrawn progress payments as drawn on the completion date
      const undrawn = progressPayments.filter(p => !p.drawn_date)
      await Promise.all(undrawn.map(p =>
        fetch('/api/construction/progress-payments', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id, propertyId: property.id, drawn_date: completionDate }),
        })
      ))
      if (undrawn.length > 0) setProgressPayments(prev => prev.map(p => p.drawn_date ? p : { ...p, drawn_date: completionDate }))
      setShowCompleteConstruction(false); router.refresh()
    } catch { setCompletionError('Network error') }
    finally { setCompletionSaving(false) }
  }

  // ── Progress payments ──
  type PPForm = { stage_name: string; amount: string; percentage: string; scheduled_date: string; notes: string }
  const emptyPPForm: PPForm = { stage_name: '', amount: '', percentage: '', scheduled_date: '', notes: '' }
  const [ppCollapsed, setPpCollapsed] = useState(property.construction_status === 'completed')
  // Track status locally to avoid stale closure bugs when markDrawn/undrawnPayment run before router.refresh() settles
  const [localConstructionStatus, setLocalConstructionStatus] = useState(property.construction_status ?? 'pre_construction')
  const [showDrawLoanPrompt, setShowDrawLoanPrompt] = useState(false)
  const [ppModalOpen, setPpModalOpen] = useState(false)
  const [ppEditId, setPpEditId] = useState<string | null>(null)
  const [ppForm, setPpForm] = useState<PPForm>(emptyPPForm)
  const [ppSaving, setPpSaving] = useState(false)
  const [ppError, setPpError] = useState<string | null>(null)
  const [ppDeleteId, setPpDeleteId] = useState<string | null>(null)
  const [ppDrawnId, setPpDrawnId] = useState<string | null>(null)
  const [ppDrawnDate, setPpDrawnDate] = useState('')
  const [ppDrawnBank, setPpDrawnBank] = useState('')
  const [ppDrawnSelf, setPpDrawnSelf] = useState('')
  const [ppDrawnSaving, setPpDrawnSaving] = useState(false)
  const [ppDrawnError, setPpDrawnError] = useState<string | null>(null)

  const STANDARD_STAGES = [
    { name: 'Deposit', pct: 5 },
    { name: 'Slab', pct: 15 },
    { name: 'Frame', pct: 20 },
    { name: 'Lockup', pct: 30 },
    { name: 'Fixing / Fit-out', pct: 20 },
    { name: 'Practical Completion', pct: 10 },
  ]

  function ppStatus(p: ConstructionProgressPayment): 'drawn' | 'overdue' | 'upcoming' | 'unscheduled' {
    if (p.drawn_date) return 'drawn'
    if (p.scheduled_date && new Date(p.scheduled_date) < new Date()) return 'overdue'
    if (p.scheduled_date) return 'upcoming'
    return 'unscheduled'
  }

  function ppAmountChange(val: string) {
    const contract = property.construction_contract_amount
    const amt = parseFloat(val)
    const pct = contract && !isNaN(amt) ? parseFloat(((amt / contract) * 100).toFixed(2)).toString() : ''
    setPpForm(x => ({ ...x, amount: val, percentage: pct }))
  }

  function ppPctChange(val: string) {
    const contract = property.construction_contract_amount
    const pct = parseFloat(val)
    const amt = contract && !isNaN(pct) ? String(Math.round((pct / 100) * contract)) : ''
    setPpForm(x => ({ ...x, percentage: val, amount: amt }))
  }

  async function saveProgressPayment() {
    if (!ppForm.stage_name.trim()) { setPpError('Stage name is required'); return }
    setPpSaving(true); setPpError(null)
    try {
      const body = {
        propertyId: property.id,
        stage_name: ppForm.stage_name.trim(),
        amount: ppForm.amount ? parseFloat(ppForm.amount) : null,
        scheduled_date: ppForm.scheduled_date || null,
        notes: ppForm.notes || null,
        sort_order: ppEditId ? undefined : progressPayments.length,
        ...(ppEditId ? { id: ppEditId } : {}),
      }
      const res = await fetch('/api/construction/progress-payments', {
        method: ppEditId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { setPpError(data.error); return }
      if (ppEditId) {
        const updated = progressPayments.map(p => p.id === ppEditId ? { ...p, stage_name: body.stage_name, amount: body.amount, scheduled_date: body.scheduled_date, notes: body.notes ?? null } : p)
        if (body.scheduled_date) {
          await reorderAndSync(updated)
        } else {
          setProgressPayments(updated)
        }
      } else {
        const all = [...progressPayments, data.payment]
        if (data.payment.scheduled_date) {
          await reorderAndSync(all)
        } else {
          setProgressPayments(all)
        }
      }
      setPpModalOpen(false); setPpEditId(null); setPpForm(emptyPPForm)
    } catch { setPpError('Network error') }
    finally { setPpSaving(false) }
  }

  async function deleteProgressPayment(id: string) {
    await fetch('/api/construction/progress-payments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, propertyId: property.id }),
    })
    setProgressPayments(prev => prev.filter(p => p.id !== id))
    setPpDeleteId(null)
  }

  async function markDrawn() {
    if (!ppDrawnId) return
    setPpDrawnSaving(true); setPpDrawnError(null)
    try {
      const drawnDate = ppDrawnDate || new Date().toISOString().slice(0, 10)
      const bankAmt = ppDrawnBank ? parseFloat(ppDrawnBank) : null
      const selfAmt = ppDrawnSelf ? parseFloat(ppDrawnSelf) : null
      const res = await fetch('/api/construction/progress-payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ppDrawnId, propertyId: property.id,
          drawn_date: drawnDate,
          bank_amount: bankAmt,
          self_amount: selfAmt,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setPpDrawnError(data.error)
      } else {
        setProgressPayments(prev => prev.map(p => p.id === ppDrawnId
          ? { ...p, drawn_date: drawnDate, bank_amount: bankAmt, self_amount: selfAmt }
          : p
        ))
        setPpDrawnId(null); setPpDrawnDate(''); setPpDrawnBank(''); setPpDrawnSelf(''); setPpDrawnError(null)
        // Prompt to update loan balance when bank funds were drawn
        if (bankAmt && bankAmt > 0) setShowDrawLoanPrompt(true)
        // Auto-advance from pre_construction to in_progress on first draw
        if (localConstructionStatus === 'pre_construction') {
          setLocalConstructionStatus('in_progress')
          await fetch('/api/properties/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyId: property.id, updates: { construction_status: 'in_progress' } }),
          })
          router.refresh()
        }
      }
    } catch { setPpDrawnError('Network error') }
    finally { setPpDrawnSaving(false) }
  }

  async function undrawnPayment(id: string) {
    await fetch('/api/construction/progress-payments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, propertyId: property.id, drawn_date: null, bank_amount: null, self_amount: null }),
    })
    setProgressPayments(prev => prev.map(p => p.id === id ? { ...p, drawn_date: null, bank_amount: null, self_amount: null } : p))
    setPpDrawnId(null); setPpDrawnDate(''); setPpDrawnBank(''); setPpDrawnSelf(''); setPpDrawnError(null)
    const remainingDrawn = progressPayments.filter(p => p.id !== id && p.drawn_date != null)
    if (localConstructionStatus === 'completed') {
      // Revert fully to pre_construction if nothing remains drawn, otherwise in_progress
      const newStatus = remainingDrawn.length === 0 ? 'pre_construction' : 'in_progress'
      setLocalConstructionStatus(newStatus)
      await fetch('/api/properties/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates: { construction_status: newStatus, construction_completion_date: null } }),
      })
      router.refresh()
    } else if (localConstructionStatus === 'in_progress' && remainingDrawn.length === 0) {
      setLocalConstructionStatus('pre_construction')
      await fetch('/api/properties/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates: { construction_status: 'pre_construction' } }),
      })
      router.refresh()
    }
  }

  async function undoCompletion() {
    setLocalConstructionStatus('pre_construction')
    await fetch('/api/properties/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: property.id, updates: { construction_status: 'pre_construction', construction_completion_date: null } }),
    })
    router.refresh()
  }

  async function reorderAndSync(payments: ConstructionProgressPayment[]) {
    const sorted = [...payments].sort((a, b) => {
      const aDate = a.scheduled_date ? new Date(a.scheduled_date).getTime() : null
      const bDate = b.scheduled_date ? new Date(b.scheduled_date).getTime() : null
      if (aDate !== null && bDate !== null) return aDate - bDate
      if (aDate !== null) return -1
      if (bDate !== null) return 1
      const aIdx = STANDARD_STAGES.findIndex(s => s.name.toLowerCase() === a.stage_name.toLowerCase())
      const bIdx = STANDARD_STAGES.findIndex(s => s.name.toLowerCase() === b.stage_name.toLowerCase())
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
      if (aIdx !== -1) return -1
      if (bIdx !== -1) return 1
      return a.sort_order - b.sort_order
    })
    const toUpdate = sorted.filter((p, i) => p.sort_order !== i)
    await Promise.all(toUpdate.map((p, _) => {
      const newOrder = sorted.indexOf(p)
      return fetch('/api/construction/progress-payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, propertyId: property.id, sort_order: newOrder }),
      })
    }))
    setProgressPayments(sorted.map((p, i) => ({ ...p, sort_order: i })))
  }

  async function loadStandardStages() {
    const contract = property.construction_contract_amount
    const existingNames = new Set(progressPayments.map(p => p.stage_name.toLowerCase()))
    const missing = STANDARD_STAGES.filter(s => !existingNames.has(s.name.toLowerCase()))
    if (missing.length === 0) return
    const inserted: ConstructionProgressPayment[] = []
    for (const s of missing) {
      const amount = contract ? Math.round((s.pct / 100) * contract) : null
      const res = await fetch('/api/construction/progress-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, stage_name: s.name, amount, sort_order: 0 }),
      })
      const d = await res.json()
      if (d.payment) inserted.push(d.payment)
    }
    await reorderAndSync([...progressPayments, ...inserted])
  }

  // ── Begin construction modal (vacant land → H&L) ──
  const [showBeginConstruction, setShowBeginConstruction] = useState(false)
  const [isConstructionEdit, setIsConstructionEdit] = useState(false)
  const [beginConstructionForm, setBeginConstructionForm] = useState({ builder: '', contract_amount: '', start_date: '', capitalise: false, status: 'pre_construction' as 'pre_construction' | 'in_progress' })
  const [beginConstructionSaving, setBeginConstructionSaving] = useState(false)
  const [beginConstructionError, setBeginConstructionError] = useState<string | null>(null)

  async function beginConstruction() {
    const f = beginConstructionForm
    if (f.status === 'in_progress' && !f.start_date) { setBeginConstructionError('Date commenced is required when in progress'); return }
    setBeginConstructionSaving(true); setBeginConstructionError(null)
    try {
      const updates: Record<string, unknown> = {
        property_type: 'house_and_land',
        construction_status: f.status,
        capitalise_construction_interest: f.capitalise,
      }
      if (f.builder.trim()) updates.construction_builder = f.builder.trim()
      if (f.contract_amount) updates.construction_contract_amount = parseFloat(f.contract_amount)
      if (f.start_date) updates.construction_start_date = f.start_date
      const res = await fetch('/api/properties/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates })
      })
      const data = await res.json()
      if (data.success) { setShowBeginConstruction(false); router.refresh() }
      else setBeginConstructionError(data.error ?? 'Save failed')
    } catch { setBeginConstructionError('Network error') }
    finally { setBeginConstructionSaving(false) }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('propertyId', property.id)
      const res = await fetch('/api/properties/upload-photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.photo_url) setPhotoUrl(data.photo_url)
    } catch { /* silent */ }
    finally { setPhotoUploading(false); if (photoInputRef.current) photoInputRef.current.value = '' }
  }

  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ count: number; skipped?: number } | { error: string } | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [addingTx, setAddingTx] = useState(false)
  const [editForm, setEditForm] = useState({ transaction_date: '', type: '', description: '', amount: '', loan_id: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [showDupModal, setShowDupModal] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteSelected, setDeleteSelected] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; countdown: number } | null>(null)
  const [sortCol, setSortCol] = useState<'transaction_date' | 'type' | 'amount' | 'financial_year'>('transaction_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterFY, setFilterFY] = useState('')
  const [chartPeriod, setChartPeriod] = useState<'' | 'month' | '3m' | '6m' | 'fy'>('3m')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [pendingImport, setPendingImport] = useState<{ rows: PendingImportRow[]; jobId: string | null; insuranceMeta?: { provider: string | null; policy_number: string | null; expiry: string | null; premium: number | null } | null; applyInsurance?: boolean; pmMeta?: { agency: string | null; name: string | null; phone: string | null; email: string | null; fee_percent: number | null } | null; applyPM?: boolean } | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedLoanId, setSelectedLoanId] = useState('')
  const [rentalDragActive, setRentalDragActive] = useState(false)
  const [loanDragActive, setLoanDragActive] = useState(false)
  const [expenseDragActive, setExpenseDragActive] = useState(false)
  const [expenseProcessing, setExpenseProcessing] = useState(false)
  const [expenseUploadError, setExpenseUploadError] = useState<string | null>(null)
  const [loanProcessing, setLoanProcessing] = useState(false)
  const [loanStatementQueue, setLoanStatementQueue] = useState<{ file: File; loanId: string }[]>([])
  // Loan card kebab menu
  const [openKebabId, setOpenKebabId] = useState<string | null>(null)
  // Loan edit state
  const [editingLoan, setEditingLoan] = useState<EnrichedLoan | null>(null)
  const [loanForm, setLoanForm] = useState<Record<string, string>>({})
  const [loanSecurityForm, setLoanSecurityForm] = useState<{ propertyIds: string[]; outsideEnabled: boolean; outsideDescription: string; outsideValue: string }>({ propertyIds: [], outsideEnabled: false, outsideDescription: '', outsideValue: '' })
  const [loanSaving, setLoanSaving] = useState(false)
  const [loanSaveError, setLoanSaveError] = useState<string | null>(null)
  // Loan balance state
  const [updatingLoanId, setUpdatingLoanId] = useState<string | null>(null)
  const [manualBalanceForm, setManualBalanceForm] = useState({ amount: '', date: '', rate: '' })
  const [manualBalanceSaving, setManualBalanceSaving] = useState(false)
  const [manualBalanceError, setManualBalanceError] = useState<string | null>(null)
  const [reforecastPending, setReforecastPending] = useState<{ loanId: string; balance: number; date: string; rate: number | null } | null>(null)
  const [loanStatementPreview, setLoanStatementPreview] = useState<LoanStatementPreview | null>(null)
  const [loanStatementSaving, setLoanStatementSaving] = useState(false)
  const [loanStatementError, setLoanStatementError] = useState<string | null>(null)
  const [loanUploadError, setLoanUploadError] = useState<string | null>(null)
  // Add loan modal
  const [showAddLoanModal, setShowAddLoanModal] = useState(false)
  const [addLoanForm, setAddLoanForm] = useState<NewLoanForm>(EMPTY_NEW_LOAN_FORM)
  const [addLoanSecurityForm, setAddLoanSecurityForm] = useState<{ propertyIds: string[]; outsideEnabled: boolean; outsideDescription: string; outsideValue: string }>({ propertyIds: [], outsideEnabled: false, outsideDescription: '', outsideValue: '' })
  const [addLoanSaving, setAddLoanSaving] = useState(false)
  const [addLoanError, setAddLoanError] = useState<string | null>(null)
  // Closed loans toggle
  const [showClosedLoans, setShowClosedLoans] = useState(false)
  // Payout loan
  const [payoutLoanId, setPayoutLoanId] = useState<string | null>(null)
  const [payoutDate, setPayoutDate] = useState('')
  const [payoutSaving, setPayoutSaving] = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  // Delete loan
  const [deleteLoanId, setDeleteLoanId] = useState<string | null>(null)
  const [deleteLoanSaving, setDeleteLoanSaving] = useState(false)
  const [deleteLoanError, setDeleteLoanError] = useState<string | null>(null)
  // Reinstate loan
  const [reinstateLoanId, setReinstateLoanId] = useState<string | null>(null)
  const [reinstateLoanSaving, setReinstateLoanSaving] = useState(false)
  const [reinstateLoanError, setReinstateLoanError] = useState<string | null>(null)
  // Edit modal action (for closed loans)
  const [loanModalAction, setLoanModalAction] = useState<'none' | 'delete' | 'reinstate'>('none')
  // ── Refinance / Add Loan wizard ───────────────────────────────
  const [rfLoan, setRfLoan] = useState<EnrichedLoan | null>(null)
  const [rfMode, setRfMode] = useState<'add' | 'refinance'>('refinance')
  const [rfIsNewLoan, setRfIsNewLoan] = useState(false)
  const [rfStep, setRfStep] = useState<'prequel' | 'gate1' | 'gate2' | 'upload' | 'details' | 'confirm'>('prequel')
  const [rfDocs, setRfDocs] = useState({ closing: false, contract: false, statement: false })
  const [rfGate2Checks, setRfGate2Checks] = useState<Record<string, boolean>>({})
  const [rfParsedClosing, setRfParsedClosing] = useState<{ balance: number; balanceDate: string; lender: string | null; account: string | null } | null>(null)
  const [rfParsedContract, setRfParsedContract] = useState<{ lender: string | null; account: string | null; loanLimit: number | null; rate: number | null; rateType: string | null; repaymentType: string | null; loanTermYears: number | null; ioExpiryDate: string | null; fixedRateExpiry: string | null } | null>(null)
  const [rfParsedStatement, setRfParsedStatement] = useState<{ lender: string | null; account: string | null; balance: number; balanceDate: string; rate: number | null; loanLimit: number | null; startDate: string | null; loanType: string | null; rows: PendingImportRow[]; jobId: string | null } | null>(null)
  const [rfUploading, setRfUploading] = useState({ closing: false, contract: false, statement: false })
  const [rfUploadError, setRfUploadError] = useState<string | null>(null)
  const [rfForm, setRfForm] = useState({ ...EMPTY_RF_FORM })
  const [rfSecurityIds, setRfSecurityIds] = useState<string[]>([])
  const [rfOutsideEnabled, setRfOutsideEnabled] = useState(false)
  const [rfOutsideDescription, setRfOutsideDescription] = useState('')
  const [rfOutsideValue, setRfOutsideValue] = useState('')
  const [rfSaving, setRfSaving] = useState(false)
  const [rfSaveError, setRfSaveError] = useState<string | null>(null)

  // Valuation modal
  const [valKebabId, setValKebabId] = useState<string | null>(null)
  const [showValuationModal, setShowValuationModal] = useState(false)
  const [editingValuationId, setEditingValuationId] = useState<string | null>(null)
  const [valForm, setValForm] = useState({ valuation_date: '', amount: '', type: 'bank_valuation', source: '', notes: '' })
  const [valSaving, setValSaving] = useState(false)
  const [valError, setValError] = useState<string | null>(null)
  const [deleteValuationId, setDeleteValuationId] = useState<string | null>(null)
  const [valDeleteSaving, setValDeleteSaving] = useState(false)

  const loanFileInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const expenseFileInputRef = useRef<HTMLInputElement>(null)
  const rfClosingInputRef = useRef<HTMLInputElement>(null)
  const rfContractInputRef = useRef<HTMLInputElement>(null)
  const rfStatementInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const recentTx = transactions.slice(0, 5)

  // Group transactions by (date, type, amount) to find duplicates
  const duplicateGroups = useMemo(() => {
    const groups: Record<string, Transaction[]> = {}
    transactions.forEach(tx => {
      const key = `${tx.transaction_date}|${tx.type}|${tx.amount}`
      if (!groups[key]) groups[key] = []
      groups[key].push(tx)
    })
    return Object.values(groups).filter(g => g.length > 1)
  }, [transactions])

  function openAddValuation() {
    setEditingValuationId(null)
    setValForm({ valuation_date: new Date().toISOString().slice(0, 10), amount: '', type: 'bank_valuation', source: '', notes: '' })
    setValError(null)
    setShowValuationModal(true)
  }

  function openEditValuation(v: Valuation) {
    setEditingValuationId(v.id)
    setValForm({ valuation_date: v.valuation_date, amount: String(v.amount), type: v.type, source: v.source ?? '', notes: v.notes ?? '' })
    setValError(null)
    setShowValuationModal(true)
  }

  async function saveValuation() {
    setValSaving(true)
    setValError(null)
    const amount = parseFloat(valForm.amount)
    if (!valForm.valuation_date || isNaN(amount) || amount <= 0) {
      setValError('Date and amount are required.')
      setValSaving(false)
      return
    }
    try {
      const url = editingValuationId ? '/api/valuations/update' : '/api/valuations/create'
      const body: Record<string, unknown> = {
        propertyId: property.id,
        valuation_date: valForm.valuation_date,
        amount,
        type: valForm.type,
        source: valForm.source || null,
        notes: valForm.notes || null,
      }
      if (editingValuationId) body.id = editingValuationId
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setValError(data.error ?? 'Save failed'); setValSaving(false); return }
      setShowValuationModal(false)
      router.refresh()
    } catch {
      setValError('Network error')
    }
    setValSaving(false)
  }

  async function deleteValuation(id: string) {
    setValDeleteSaving(true)
    try {
      const res = await fetch('/api/valuations/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, propertyId: property.id }) })
      if (!res.ok) { setValDeleteSaving(false); return }
      setDeleteValuationId(null)
      router.refresh()
    } catch { /* ignore */ }
    setValDeleteSaving(false)
  }

  function openEdit(tx: Transaction) {
    setEditingTx(tx)
    setEditForm({ transaction_date: tx.transaction_date, type: tx.type, description: tx.description ?? '', amount: String(tx.amount), loan_id: tx.loan_id ?? '' })
    setEditError(null)
  }

  function openAdd() {
    setAddingTx(true)
    setEditForm({ transaction_date: new Date().toISOString().slice(0, 10), type: 'rent_income', description: '', amount: '', loan_id: '' })
    setEditError(null)
  }

  async function saveOverview(updates: Record<string, unknown>) {
    setOverviewSaving(true)
    setOverviewError(null)
    try {
      const res = await fetch('/api/properties/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id, updates }),
      })
      const data = await res.json()
      if (data.success) {
        setEditingDetails(false); setEditingInsurance(false); setEditingBroker(false)
        router.refresh()
      } else {
        setOverviewError(data.error ?? 'Save failed')
      }
    } catch { setOverviewError('Network error') }
    finally { setOverviewSaving(false) }
  }

  async function toggleCapitalised(tx: Transaction) {
    const current = txEffectiveCapitalised(tx)
    const next: boolean | null = current ? false : null
    setCapOverrides(prev => ({ ...prev, [tx.id]: next }))
    fetch('/api/transactions/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tx.id, propertyId: property.id, updates: { capitalised: next } }),
    })
  }

  async function saveEdit() {
    if (!editingTx) return
    if (LOAN_REQUIRED_TYPES.includes(editForm.type) && !editForm.loan_id) {
      setEditError('Please select the loan this transaction belongs to')
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/transactions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTx.id,
          propertyId: property.id,
          updates: {
            transaction_date: editForm.transaction_date,
            type: editForm.type,
            description: editForm.description || null,
            amount: parseFloat(editForm.amount),
            loan_id: editForm.loan_id || null,
          },
        }),
      })
      const data = await res.json()
      if (data.success) { setEditingTx(null); router.refresh() }
      else setEditError(data.error ?? 'Save failed')
    } catch { setEditError('Network error') }
    finally { setEditSaving(false) }
  }

  const LOAN_REQUIRED_TYPES = ['interest_expense', 'principal_payment']

  async function saveAdd() {
    const amt = parseFloat(editForm.amount)
    if (!editForm.transaction_date || !editForm.type || isNaN(amt)) {
      setEditError('Date, type and amount are required')
      return
    }
    if (LOAN_REQUIRED_TYPES.includes(editForm.type) && !editForm.loan_id) {
      setEditError('Please select the loan this transaction belongs to')
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/transactions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          transaction_date: editForm.transaction_date,
          type: editForm.type,
          amount: amt,
          description: editForm.description || null,
          loan_id: editForm.loan_id || null,
        }),
      })
      const data = await res.json()
      if (data.success) { setAddingTx(false); router.refresh() }
      else setEditError(data.error ?? 'Save failed')
    } catch { setEditError('Network error') }
    finally { setEditSaving(false) }
  }

  async function deleteFromEdit() {
    if (!editingTx) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/transactions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [editingTx.id], propertyId: property.id }),
      })
      const data = await res.json()
      if (data.success) { setEditingTx(null); router.refresh() }
      else setEditError(data.error ?? 'Delete failed')
    } catch { setEditError('Network error') }
    finally { setEditSaving(false) }
  }

  function openDupModal() {
    const preSelected = new Set<string>()
    duplicateGroups.forEach(group => {
      group.slice(1).forEach(tx => preSelected.add(tx.id))
    })
    setSelectedForDelete(preSelected)
    setDeleteError(null)
    setShowDupModal(true)
  }

  async function confirmDeleteDuplicates() {
    if (selectedForDelete.size === 0) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/transactions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedForDelete), propertyId: property.id }),
      })
      const data = await res.json()
      if (data.success) {
        setShowDupModal(false)
        router.refresh()
      } else {
        setDeleteError(data.error ?? `Server error ${res.status}`)
      }
    } catch (e) {
      setDeleteError('Network error — please try again')
    } finally {
      setDeleting(false)
    }
  }

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'amount' ? 'desc' : 'asc') }
    setPage(1)
  }

  function toggleDeleteSelect(id: string) {
    setDeleteSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function initiateDelete() {
    if (deleteSelected.size === 0) return
    setShowDeleteConfirm(true)
  }

  function confirmDelete() {
    setPendingDelete({ ids: Array.from(deleteSelected), countdown: 10 })
    setDeleteSelected(new Set())
    setDeleteMode(false)
    setShowDeleteConfirm(false)
  }

  // Countdown — fires actual delete when it hits 0
  useEffect(() => {
    if (!pendingDelete) return
    if (pendingDelete.countdown === 0) {
      const ids = pendingDelete.ids
      setPendingDelete(null)
      fetch('/api/transactions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, propertyId: property.id }),
      }).then(() => router.refresh())
      return
    }
    const t = setTimeout(() => setPendingDelete(p => p ? { ...p, countdown: p.countdown - 1 } : null), 1000)
    return () => clearTimeout(t)
  }, [pendingDelete])

  const fyOptions = useMemo(() => [...new Set(transactions.map(tx => tx.financial_year).filter(Boolean))].sort().reverse(), [transactions])
  const typeOptions = useMemo(() => [...new Set(transactions.map(tx => tx.type))].sort(), [transactions])

  const visibleTransactions = useMemo(() => {
    let rows = [...transactions]
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      rows = rows.filter(tx =>
        tx.description?.toLowerCase().includes(q) ||
        tx.type.replace(/_/g, ' ').includes(q) ||
        tx.transaction_date.includes(q)
      )
    }
    if (filterType) rows = rows.filter(tx => tx.type === filterType)
    if (filterFY) rows = rows.filter(tx => tx.financial_year === filterFY)
    rows.sort((a, b) => {
      let cmp = 0
      if (sortCol === 'transaction_date') cmp = a.transaction_date.localeCompare(b.transaction_date)
      else if (sortCol === 'type') cmp = a.type.localeCompare(b.type)
      else if (sortCol === 'amount') cmp = a.amount - b.amount
      else if (sortCol === 'financial_year') cmp = (a.financial_year ?? '').localeCompare(b.financial_year ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [transactions, filterSearch, filterType, filterFY, sortCol, sortDir])

  const chartTransactions = useMemo(() => {
    if (filterFY) {
      const fyNum = parseInt(filterFY.slice(2))
      const fyStart = `${1999 + fyNum}-07-01`
      const fyEnd = `${2000 + fyNum}-06-30`
      return transactions.filter(tx => tx.financial_year === filterFY && tx.transaction_date >= fyStart && tx.transaction_date <= fyEnd)
    }
    if (!chartPeriod) return transactions
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    let from = ''
    if (chartPeriod === 'month') from = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
    else if (chartPeriod === '3m') from = ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1))
    else if (chartPeriod === '6m') from = ymd(new Date(now.getFullYear(), now.getMonth() - 5, 1))
    else if (chartPeriod === 'fy') from = now.getMonth() >= 6 ? `${now.getFullYear()}-07-01` : `${now.getFullYear() - 1}-07-01`
    return from ? transactions.filter(tx => tx.transaction_date >= from) : transactions
  }, [transactions, chartPeriod, filterFY])

  const totalPages = Math.max(1, Math.ceil(visibleTransactions.length / PAGE_SIZE))
  const pagedTransactions = visibleTransactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function processRentalFiles(files: File[]) {
    if (files.length === 0) return
    setUploading(true)
    setUploadResult(null)
    const allPreviewRows: PendingImportRow[] = []
    let lastJobId: string | null = null
    let pmMeta: { agency: string | null; name: string | null; phone: string | null; email: string | null; fee_percent: number | null } | null = null
    const errors: string[] = []
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('propertyId', property.id)
        const res = await fetch('/api/uploads/rental-statement', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.success && data.preview) {
          allPreviewRows.push(...data.preview)
          lastJobId = data.job_id ?? null
          if (data.pm && !pmMeta) pmMeta = data.pm
        } else {
          errors.push(`${file.name}: ${data.error ?? 'Upload failed'}`)
        }
      } catch {
        errors.push(`${file.name}: Network error`)
      }
    }
    setUploading(false)
    setShowUploadModal(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (allPreviewRows.length > 0) {
      setPendingImport({ rows: allPreviewRows, jobId: lastJobId, pmMeta, applyPM: false })
      if (errors.length > 0) console.warn('Some files failed:', errors)
    } else {
      setUploadResult({ error: errors.join(' · ') || 'No transactions found' })
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    processRentalFiles(files)
  }

  async function confirmImport() {
    if (!pendingImport) return
    setImportSaving(true)
    setImportError(null)
    const toImport = pendingImport.rows.filter(r => !r.removed)
    try {
      const calls: Promise<Response>[] = [
        fetch('/api/transactions/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: toImport, propertyId: property.id, jobId: pendingImport.jobId }),
        }),
      ]
      if (pendingImport.applyInsurance && pendingImport.insuranceMeta) {
        const m = pendingImport.insuranceMeta
        calls.push(fetch('/api/properties/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: property.id,
            updates: {
              ...(m.provider != null ? { insurance_provider: m.provider } : {}),
              ...(m.policy_number != null ? { insurance_policy_number: m.policy_number } : {}),
              ...(m.expiry != null ? { insurance_expiry: m.expiry } : {}),
              ...(m.premium != null ? { insurance_premium: m.premium } : {}),
            },
          }),
        }))
      }
      if (pendingImport.applyPM && pendingImport.pmMeta) {
        const m = pendingImport.pmMeta
        calls.push(fetch('/api/properties/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: property.id,
            updates: {
              ...(m.agency != null ? { pm_agency: m.agency } : {}),
              ...(m.name != null ? { pm_name: m.name } : {}),
              ...(m.phone != null ? { pm_phone: m.phone } : {}),
              ...(m.email != null ? { pm_email: m.email } : {}),
              ...(m.fee_percent != null ? { pm_fee_percent: m.fee_percent } : {}),
            },
          }),
        }))
      }
      const [res] = await Promise.all(calls)
      const data = await res.json()
      if (data.success) {
        setPendingImport(null)
        setUploadResult({ count: data.transactions_created })
        router.refresh()
      } else {
        setImportError(data.error ?? 'Import failed')
      }
    } catch {
      setImportError('Network error — please try again')
    } finally {
      setImportSaving(false)
    }
  }

  function removeImportRow(i: number) {
    if (!pendingImport) return
    setPendingImport(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, removed: true } : r) } : null)
  }

  function restoreImportRow(i: number) {
    if (!pendingImport) return
    setPendingImport(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, removed: false } : r) } : null)
  }

  function updateImportRowType(i: number, type: string) {
    if (!pendingImport) return
    setPendingImport(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, type } : r) } : null)
  }

  // ── Loan balance handlers ─────────────────────────────────────
  function openManualBalance(loan: EnrichedLoan) {
    setUpdatingLoanId(loan.id)
    setReforecastPending(null)
    setManualBalanceForm({
      amount: loan.actual_balance !== null ? String(loan.actual_balance) : String(loan.current_balance),
      date: loan.balance_date ?? new Date().toISOString().slice(0, 10),
      rate: String(loan.interest_rate ?? ''),
    })
    setManualBalanceError(null)
  }

  async function saveManualBalance(loanId: string) {
    setManualBalanceSaving(true)
    setManualBalanceError(null)
    const newBalance = parseFloat(manualBalanceForm.amount)
    const newRate = manualBalanceForm.rate ? parseFloat(manualBalanceForm.rate) : null
    try {
      const res = await fetch('/api/loans/update-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, propertyId: property.id, actualBalance: newBalance, balanceDate: manualBalanceForm.date, newRate }),
      })
      const data = await res.json()
      if (data.success) {
        setUpdatingLoanId(null)
        setReforecastPending({ loanId, balance: newBalance, date: manualBalanceForm.date, rate: newRate })
      } else {
        setManualBalanceError(data.error ?? 'Save failed')
      }
    } catch { setManualBalanceError('Network error') }
    finally { setManualBalanceSaving(false) }
  }

  async function confirmReforecast() {
    if (!reforecastPending) return
    await fetch('/api/loans/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId: reforecastPending.loanId,
        propertyId: property.id,
        updates: { reforecast_balance: reforecastPending.balance, reforecast_date: reforecastPending.date },
      }),
    })
    setReforecastPending(null)
    router.refresh()
  }

  function skipReforecast() {
    setReforecastPending(null)
    router.refresh()
  }

  function openEditLoan(loan: EnrichedLoan) {
    setEditingLoan(loan)
    setLoanForm({
      lender: loan.lender ?? '',
      account_suffix: loan.account_suffix ?? '',
      repayment_type: loan.repayment_type ?? 'principal_and_interest',
      rate_type: loan.rate_type ?? 'variable',
      original_amount: String(loan.original_amount ?? ''),
      interest_rate: String(loan.interest_rate ?? ''),
      rate_effective_date: loan.rate_effective_date ?? '',
      maturity_date: (() => {
        if (!loan.start_date || !loan.loan_term_years) return ''
        const d = new Date(loan.start_date)
        d.setFullYear(d.getFullYear() + loan.loan_term_years)
        return d.toISOString().slice(0, 10)
      })(),
      io_expiry_date: loan.io_expiry_date ?? '',
      start_date: loan.start_date ?? '',
      fixed_rate_expiry: loan.fixed_rate_expiry ?? '',
      purpose: loan.purpose ?? '',
      notes: loan.notes ?? '',
    })
    setLoanSecurityForm({
      propertyIds: loanSecurities.filter(ls => ls.loan_id === loan.id).map(ls => ls.property_id),
      outsideEnabled: !!(loan.outside_security_description || loan.outside_security_value),
      outsideDescription: loan.outside_security_description ?? '',
      outsideValue: loan.outside_security_value != null ? String(loan.outside_security_value) : '',
    })
    setLoanSaveError(null)
  }

  async function saveLoan() {
    if (!editingLoan) return
    setLoanSaving(true)
    setLoanSaveError(null)

    // Closed loans: only notes are editable
    if (editingLoan.status === 'closed') {
      try {
        const res = await fetch('/api/loans/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loanId: editingLoan.id, propertyId: property.id, updates: { notes: loanForm.notes || null } }),
        })
        const data = await res.json()
        if (data.success) { closeEditModal(); router.refresh() }
        else setLoanSaveError(data.error ?? 'Save failed')
      } catch { setLoanSaveError('Network error') }
      finally { setLoanSaving(false) }
      return
    }

    const updates: Record<string, string | number | null> = {
      lender: loanForm.lender || null,
      account_suffix: loanForm.account_suffix || null,
      repayment_type: loanForm.repayment_type || null,
      rate_type: loanForm.rate_type || null,
      original_amount: loanForm.original_amount ? parseFloat(loanForm.original_amount) : null,
      interest_rate: loanForm.interest_rate ? parseFloat(loanForm.interest_rate) : null,
      rate_effective_date: loanForm.rate_effective_date || null,
      loan_term_years: (() => {
        if (!loanForm.maturity_date || !loanForm.start_date) return null
        const start = new Date(loanForm.start_date)
        const end = new Date(loanForm.maturity_date)
        return Math.round((end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      })(),
      io_expiry_date: loanForm.io_expiry_date || null,
      start_date: loanForm.start_date || null,
      fixed_rate_expiry: loanForm.fixed_rate_expiry || null,
      purpose: loanForm.purpose || null,
      notes: loanForm.notes || null,
    }
    if (loanSecurityForm.outsideEnabled && !loanSecurityForm.outsideValue) {
      setLoanSaveError('Outside portfolio security value is required')
      setLoanSaving(false)
      return
    }
    try {
      const [res, secRes] = await Promise.all([
        fetch('/api/loans/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loanId: editingLoan.id, propertyId: property.id, updates }),
        }),
        fetch('/api/loans/update-securities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanId: editingLoan.id,
            propertyId: property.id,
            securityPropertyIds: loanSecurityForm.propertyIds,
            outsideSecurityDescription: loanSecurityForm.outsideEnabled
              ? (loanSecurityForm.outsideDescription.trim() || 'Outside portfolio')
              : null,
            outsideSecurityValue: loanSecurityForm.outsideEnabled && loanSecurityForm.outsideValue
              ? parseFloat(loanSecurityForm.outsideValue)
              : null,
          }),
        }),
      ])
      const data = await res.json()
      const secData = await secRes.json()
      if (data.success && secData.success) { closeEditModal(); router.refresh() }
      else setLoanSaveError(data.error ?? secData.error ?? 'Save failed')
    } catch { setLoanSaveError('Network error') }
    finally { setLoanSaving(false) }
  }

  async function saveAddLoan() {
    const f = addLoanForm
    if (!f.lender.trim()) { setAddLoanError('Lender name is required'); return }
    setAddLoanSaving(true)
    setAddLoanError(null)
    try {
      const res = await fetch('/api/loans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          lender: f.lender.trim(),
          account_suffix: f.account_suffix.trim() || null,
          loan_limit: f.loan_limit ? parseFloat(f.loan_limit) : null,
          original_amount: f.loan_limit ? parseFloat(f.loan_limit) : null,
          interest_rate: f.interest_rate ? parseFloat(f.interest_rate) : null,
          rate_type: f.rate_type || 'variable',
          repayment_type: f.repayment_type || 'principal_and_interest',
          loan_term_years: f.loan_term_years ? parseInt(f.loan_term_years) : null,
          start_date: f.start_date || null,
          io_expiry_date: f.io_expiry_date || null,
          fixed_rate_expiry: f.fixed_rate_expiry || null,
          purpose: f.purpose || null,
          deductible_portion_percent: f.deductible_portion_percent ? parseFloat(f.deductible_portion_percent) : null,
          refinanced_from_loan_id: f.refinanced_from_loan_id || null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        // Wire up securities if any selected
        if (addLoanSecurityForm.propertyIds.length > 0 || addLoanSecurityForm.outsideEnabled) {
          await fetch('/api/loans/update-securities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              loanId: data.loanId,
              propertyId: property.id,
              securityPropertyIds: addLoanSecurityForm.propertyIds,
              outsideSecurityDescription: addLoanSecurityForm.outsideEnabled
                ? (addLoanSecurityForm.outsideDescription.trim() || 'Outside portfolio')
                : null,
              outsideSecurityValue: addLoanSecurityForm.outsideEnabled && addLoanSecurityForm.outsideValue
                ? parseFloat(addLoanSecurityForm.outsideValue)
                : null,
            }),
          })
        }
        setShowAddLoanModal(false)
        setAddLoanForm(EMPTY_NEW_LOAN_FORM)
        setAddLoanSecurityForm({ propertyIds: [], outsideEnabled: false, outsideDescription: '', outsideValue: '' })
        router.refresh()
      } else setAddLoanError(data.error ?? 'Failed to create loan')
    } catch { setAddLoanError('Network error') }
    finally { setAddLoanSaving(false) }
  }

  function closeEditModal() {
    setEditingLoan(null)
    setLoanModalAction('none')
    setLoanSaveError(null)
  }

  // ── Refinance wizard helpers ──────────────────────────────────
  function closeRfWizard() {
    setRfLoan(null)
    setRfMode('refinance')
    setRfStep('prequel')
    setRfDocs({ closing: false, contract: false, statement: false })
    setRfGate2Checks({})
    setRfParsedClosing(null); setRfParsedContract(null); setRfParsedStatement(null)
    setRfUploading({ closing: false, contract: false, statement: false })
    setRfUploadError(null)
    setRfForm({ ...EMPTY_RF_FORM })
    setRfSecurityIds([])
    setRfOutsideEnabled(false); setRfOutsideDescription(''); setRfOutsideValue('')
    setRfSaving(false); setRfSaveError(null)
  }

  function openRfWizard(loan: EnrichedLoan) {
    const existingSecurity = loanSecurities.filter(ls => ls.loan_id === loan.id).map(ls => ls.property_id)
    setRfMode('refinance')
    setRfIsNewLoan(false)
    setRfLoan(loan)
    setRfStep('prequel')
    setRfDocs({ closing: false, contract: false, statement: false })
    setRfGate2Checks({})
    setRfParsedClosing(null); setRfParsedContract(null); setRfParsedStatement(null)
    setRfUploading({ closing: false, contract: false, statement: false })
    setRfUploadError(null)
    setRfForm({ ...EMPTY_RF_FORM, purpose: loan.purpose ?? 'investment' })
    setRfSecurityIds(existingSecurity)
    setRfOutsideEnabled(false); setRfOutsideDescription(''); setRfOutsideValue('')
    setRfSaving(false); setRfSaveError(null)
  }

  function openRfWizardAdd() {
    setRfMode('add')
    setRfIsNewLoan(false)
    setRfLoan(null)
    setRfStep('prequel')
    setRfDocs({ closing: false, contract: false, statement: false })
    setRfGate2Checks({})
    setRfParsedClosing(null); setRfParsedContract(null); setRfParsedStatement(null)
    setRfUploading({ closing: false, contract: false, statement: false })
    setRfUploadError(null)
    setRfForm({ ...EMPTY_RF_FORM })
    setRfSecurityIds([property.id])
    setRfOutsideEnabled(false); setRfOutsideDescription(''); setRfOutsideValue('')
    setRfSaving(false); setRfSaveError(null)
  }

  function getRfGate2Fields(docs: { closing: boolean; contract: boolean; statement: boolean }) {
    const fields: Array<{ key: string; label: string; description: string }> = []
    const settlementRequired = rfMode === 'refinance' || rfIsNewLoan
    if (!docs.statement && settlementRequired && (rfMode === 'refinance' ? !docs.closing : true))
      fields.push({ key: 'settlement_date', label: rfMode === 'add' ? 'Loan start date' : 'Settlement / discharge date', description: rfMode === 'add' ? 'When this loan started' : 'When the refinance settled' })
    if (!docs.statement)
      fields.push({ key: 'opening_balance', label: 'Opening balance', description: 'Amount drawn at settlement/start' })
    if (!docs.statement && !docs.contract)
      fields.push({ key: 'account_number', label: 'New loan account number', description: 'Account number from new lender' })
    if (!docs.contract) {
      if (!docs.statement)
        fields.push({ key: 'loan_amount', label: 'Original loan amount / credit limit', description: 'Approved credit limit' })
      fields.push({ key: 'loan_term', label: 'Loan term (years)', description: 'e.g. 30 years' })
      fields.push({ key: 'repayment_type', label: 'Repayment type', description: 'Principal & Interest, or Interest Only' })
      fields.push({ key: 'interest_rate', label: 'Interest rate', description: 'Current annual rate (% p.a.)' })
      fields.push({ key: 'rate_type', label: 'Rate type', description: 'Fixed or variable' })
    }
    return fields
  }

  function getRfAutoFillPreview(docs: { closing: boolean; contract: boolean; statement: boolean }) {
    const filled: string[] = []
    const needed: string[] = []
    if (docs.statement) { filled.push('Settlement date', 'Opening balance', 'Account number', 'Original loan amount') }
    else { needed.push('Opening balance'); if (!docs.closing) needed.push('Settlement date') }
    if (docs.contract) { filled.push('Original loan amount', 'Interest rate', 'Rate type', 'Repayment type', 'Loan term') }
    else {
      if (!docs.statement) needed.push('Original loan amount')
      needed.push('Loan term', 'Repayment type', 'Interest rate', 'Rate type')
      if (!docs.statement) needed.push('Account number')
    }
    if (docs.closing) filled.push('Discharge verification')
    return { filled: [...new Set(filled)], needed: [...new Set(needed)] }
  }

  function getIoRemaining(dateStr: string): string {
    if (!dateStr) return ''
    const today = new Date(); today.setHours(0,0,0,0)
    const exp = new Date(dateStr); exp.setHours(0,0,0,0)
    if (exp <= today) return 'Expired'
    let y = exp.getFullYear() - today.getFullYear()
    let m = exp.getMonth() - today.getMonth()
    if (m < 0) { y--; m += 12 }
    return y > 0 ? `${y} yr${y !== 1 ? 's' : ''}${m > 0 ? ` ${m} mo` : ''}` : `${m} mo`
  }

  function buildRfFormFromParsed() {
    const form = { ...EMPTY_RF_FORM, purpose: rfLoan?.purpose ?? rfForm.purpose ?? 'investment' }
    const c = rfParsedClosing, k = rfParsedContract, s = rfParsedStatement
    if (s?.startDate) form.settlement_date = s.startDate
    else if (c?.balanceDate) form.settlement_date = c.balanceDate
    if (k?.lender) form.lender = k.lender
    else if (s?.lender) form.lender = s.lender
    if (s?.account) form.account_suffix = s.account
    else if (k?.account) form.account_suffix = k.account
    if (k?.loanLimit != null) form.loan_limit = String(k.loanLimit)
    else if (s?.loanLimit != null) form.loan_limit = String(s.loanLimit)
    if (k?.rate != null) form.interest_rate = String(k.rate)
    else if (s?.rate != null) form.interest_rate = String(s.rate)
    if (k?.rateType) form.rate_type = k.rateType
    if (k?.repaymentType) form.repayment_type = k.repaymentType
    else if (s?.loanType) form.repayment_type = s.loanType
    if (k?.loanTermYears != null) form.loan_term_years = String(k.loanTermYears)
    if (k?.ioExpiryDate) form.io_expiry_date = k.ioExpiryDate
    if (k?.fixedRateExpiry) form.fixed_rate_expiry = k.fixedRateExpiry
    setRfForm(form)
  }

  async function uploadRfDoc(type: 'closing' | 'contract' | 'statement', file: File) {
    setRfUploading(u => ({ ...u, [type]: true }))
    setRfUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('propertyId', property.id)
      if (type === 'closing') fd.append('loanId', rfLoan!.id)

      if (type === 'contract') {
        const res = await fetch('/api/uploads/loan-contract', { method: 'POST', body: fd })
        const data = await res.json()
        if (!data.success) { setRfUploadError(data.error ?? 'Parse failed'); return }
        setRfParsedContract({
          lender: data.lender, account: data.account_suffix, loanLimit: data.loan_limit,
          rate: data.interest_rate, rateType: data.rate_type, repaymentType: data.repayment_type,
          loanTermYears: data.loan_term_years, ioExpiryDate: data.io_expiry_date,
          fixedRateExpiry: data.fixed_rate_expiry,
        })
      } else {
        const res = await fetch('/api/uploads/loan-statement', { method: 'POST', body: fd })
        const data = await res.json()
        if (!data.success) { setRfUploadError(data.error ?? 'Parse failed'); return }
        if (type === 'closing') {
          setRfParsedClosing({ balance: data.balance, balanceDate: data.balance_date, lender: data.detected_lender, account: data.detected_account })
        } else {
          setRfParsedStatement({
            lender: data.detected_lender, account: data.detected_account,
            balance: data.balance, balanceDate: data.balance_date,
            rate: data.detected_rate, loanLimit: data.detected_loan_limit,
            startDate: data.detected_start_date, loanType: data.detected_loan_type ?? null,
            rows: (data.preview ?? []).filter((r: PendingImportRow) => !r.duplicate),
            jobId: data.job_id,
          })
        }
      }
    } catch { setRfUploadError('Upload failed — check your connection') }
    finally { setRfUploading(u => ({ ...u, [type]: false })) }
  }

  function copyRfChecklist() {
    const gate2 = getRfGate2Fields(rfDocs)
    const unchecked = gate2.filter(f => !rfGate2Checks[f.key])
    const loanLabel = rfLoan ? `${rfLoan.lender}${rfLoan.account_suffix ? ` · ${rfLoan.account_suffix}` : ''}` : 'New loan'
    const lines = [
      rfMode === 'add' ? 'ICFG Property Tracker — Add Loan Checklist' : 'ICFG Property Tracker — Refinance Checklist',
      `Loan: ${loanLabel}`,
      '',
      'Documents to gather:',
      ...(rfMode === 'refinance' && !rfDocs.closing ? [`  • Closing statement from ${rfLoan?.lender ?? 'old lender'}`] : []),
      ...(!rfDocs.contract ? ['  • Loan contract / letter of offer from new lender'] : []),
      ...(!rfDocs.statement ? ['  • First statement from new lender'] : []),
      ...(unchecked.length > 0 ? ['', 'Information to have ready:'] : []),
      ...unchecked.map(f => `  • ${f.label} — ${f.description}`),
    ]
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
  }

  async function submitWizard() {
    if (!rfForm.lender.trim()) { setRfSaveError('New lender name is required'); return }
    if (!rfForm.interest_rate) { setRfSaveError('Interest rate is required'); return }
    if ((rfMode === 'refinance' || rfIsNewLoan) && !rfForm.settlement_date) { setRfSaveError('Settlement date is required'); return }
    if (rfOutsideEnabled && !rfOutsideValue) { setRfSaveError('Please enter an estimated value for the outside property'); return }
    setRfSaving(true); setRfSaveError(null)
    try {
      // 1. Close old loan (refinance only)
      if (rfMode === 'refinance' && rfLoan) {
        const newLoanLabel = `${rfForm.lender.trim()}${rfForm.account_suffix.trim() ? ` · ${rfForm.account_suffix.trim()}` : ''}`
        const autoNote = `Refinanced to ${newLoanLabel} on ${rfForm.settlement_date}`
        const existingNotes = rfLoan.notes ? rfLoan.notes.trim() : ''
        const updatedNotes = existingNotes ? `${existingNotes}\n${autoNote}` : autoNote
        const closeRes = await fetch('/api/loans/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loanId: rfLoan.id, propertyId: property.id, updates: { status: 'closed', closed_date: rfForm.settlement_date, notes: updatedNotes } }),
        })
        const closeData = await closeRes.json()
        if (!closeData.success) { setRfSaveError(closeData.error ?? 'Failed to close old loan'); return }
      }

      // 2. Create new loan
      const createRes = await fetch('/api/loans/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          lender: rfForm.lender.trim(),
          account_suffix: rfForm.account_suffix.trim() || null,
          loan_limit: rfForm.loan_limit ? parseFloat(rfForm.loan_limit) : null,
          original_amount: rfForm.loan_limit ? parseFloat(rfForm.loan_limit) : null,
          interest_rate: rfForm.interest_rate ? parseFloat(rfForm.interest_rate) : null,
          rate_type: rfForm.rate_type || 'variable',
          repayment_type: rfForm.repayment_type || 'principal_and_interest',
          loan_term_years: rfForm.loan_term_years ? parseInt(rfForm.loan_term_years) : null,
          start_date: rfForm.settlement_date || null,
          io_expiry_date: rfForm.io_expiry_date || null,
          fixed_rate_expiry: rfForm.fixed_rate_expiry || null,
          purpose: rfForm.purpose || null,
          notes: rfForm.notes || null,
          actual_balance: rfParsedStatement?.balance ?? null,
          balance_date: rfParsedStatement?.balanceDate ?? rfForm.settlement_date,
          refinanced_from_loan_id: rfMode === 'refinance' && rfLoan ? rfLoan.id : null,
          status: 'active',
        }),
      })
      const createData = await createRes.json()
      if (!createData.success) { setRfSaveError(createData.error ?? 'Failed to create new loan'); return }
      const newLoanId: string = createData.loanId

      // 3. Carry forward security
      await fetch('/api/loans/update-securities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId: newLoanId, propertyId: property.id, securityPropertyIds: rfSecurityIds,
          outsideSecurityDescription: rfOutsideEnabled ? (rfOutsideDescription.trim() || 'Outside portfolio') : null,
          outsideSecurityValue: rfOutsideEnabled && rfOutsideValue ? parseFloat(rfOutsideValue) : null,
        }),
      })

      // 4. Import first statement transactions if available
      if (rfParsedStatement && rfParsedStatement.rows.length > 0) {
        await fetch('/api/loans/confirm-statement', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: property.id, loanId: newLoanId,
            jobId: rfParsedStatement.jobId,
            balance: rfParsedStatement.balance, balanceDate: rfParsedStatement.balanceDate,
            transactions: rfParsedStatement.rows,
            balanceSnapshots: [{ date: rfParsedStatement.balanceDate, balance: rfParsedStatement.balance }],
          }),
        })
      }

      closeRfWizard()
      router.refresh()
    } catch { setRfSaveError('Network error — please try again') }
    finally { setRfSaving(false) }
  }

  async function reinstateLoan(loanId: string) {
    setReinstateLoanSaving(true)
    setReinstateLoanError(null)
    try {
      const res = await fetch('/api/loans/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, propertyId: property.id, updates: { status: 'active', closed_date: null } }),
      })
      const data = await res.json()
      if (data.success) { setReinstateLoanId(null); closeEditModal(); router.refresh() }
      else setReinstateLoanError(data.error ?? 'Reinstate failed')
    } catch { setReinstateLoanError('Network error') }
    finally { setReinstateLoanSaving(false) }
  }

  async function handlePayoutLoan(loanId: string) {
    if (!payoutDate) return
    setPayoutSaving(true)
    setPayoutError(null)
    try {
      const res = await fetch('/api/loans/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, propertyId: property.id, updates: { status: 'closed', closed_date: payoutDate } }),
      })
      const data = await res.json()
      if (data.success) { setPayoutLoanId(null); setPayoutDate(''); router.refresh() }
      else setPayoutError(data.error ?? 'Payout failed')
    } catch { setPayoutError('Network error') }
    finally { setPayoutSaving(false) }
  }

  async function deleteLoan(loanId: string) {
    setDeleteLoanSaving(true)
    setDeleteLoanError(null)
    try {
      const res = await fetch('/api/loans/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, propertyId: property.id }),
      })
      const data = await res.json()
      if (data.success) { setDeleteLoanId(null); closeEditModal(); router.refresh() }
      else setDeleteLoanError(data.error ?? 'Delete failed')
    } catch { setDeleteLoanError('Network error') }
    finally { setDeleteLoanSaving(false) }
  }

  function autoMatchLoan(detectedLender: string | null, detectedAccount: string | null): string {
    if (!detectedLender && !detectedAccount) return ''
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const l of loans) {
      const lenderMatch = detectedLender && normalise(l.lender).includes(normalise(detectedLender))
      const accountMatch = detectedAccount && l.account_suffix &&
        normalise(l.account_suffix).endsWith(normalise(detectedAccount).slice(-4))
      if (lenderMatch && accountMatch) return l.id
      if (lenderMatch && !detectedAccount) return l.id
      if (accountMatch && !detectedLender) return l.id
    }
    return ''
  }

  async function processLoanFile(file: File, loanId?: string) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('propertyId', property.id)
    if (loanId) formData.append('loanId', loanId)
    setLoanProcessing(true)
    setLoanUploadError(null)
    try {
      const res = await fetch('/api/uploads/loan-statement', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        const matchedId = loanId || autoMatchLoan(data.detected_lender, data.detected_account)
        const loan = loans.find(l => l.id === matchedId)
        const isUnmatched = !matchedId
        setLoanStatementPreview({
          loanId: matchedId,
          loanLabel: loan ? `${loan.lender}${loan.account_suffix ? ` · ${loan.account_suffix}` : ''}` : (data.detected_lender ?? ''),
          jobId: data.job_id ?? null,
          balance: data.balance,
          balanceDate: data.balance_date,
          detectedRate: data.detected_rate ?? null,
          applyRate: false,
          rows: data.preview ?? [],
          balanceSnapshots: data.balance_snapshots ?? [],
          detectedLoanLimit: data.detected_loan_limit ?? null,
          detectedStartDate: data.detected_start_date ?? null,
          detectedLoanType: data.detected_loan_type ?? null,
          createMode: isUnmatched,
          newLoanForm: isUnmatched ? {
            ...EMPTY_NEW_LOAN_FORM,
            lender: data.detected_lender ?? '',
            account_suffix: data.detected_account ?? '',
            loan_limit: data.detected_loan_limit != null ? String(data.detected_loan_limit) : '',
            interest_rate: data.detected_rate != null ? String(data.detected_rate) : '',
            repayment_type: data.detected_loan_type === 'interest_only' ? 'interest_only' : 'principal_and_interest',
            start_date: data.detected_start_date ?? '',
          } : null,
          markClosed: false,
        })
      } else {
        setLoanUploadError(data.error ?? 'Loan statement upload failed')
      }
    } catch {
      setLoanUploadError('Network error — upload failed')
    } finally {
      setLoanProcessing(false)
      setShowUploadModal(false)
    }
  }

  function handleLoanFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (loanFileInputRef.current) loanFileInputRef.current.value = ''
    if (files.length === 0) return
    if (files.length > 1) {
      setLoanStatementQueue(files.slice(1).map(f => ({ file: f, loanId: selectedLoanId || '' })))
    }
    processLoanFile(files[0], selectedLoanId || undefined)
  }

  async function processExpenseFiles(files: File[]) {
    if (files.length === 0) return
    setExpenseProcessing(true)
    setExpenseUploadError(null)
    const allRows: PendingImportRow[] = []
    let lastJobId: string | null = null
    let insuranceMeta: { provider: string | null; policy_number: string | null; expiry: string | null; premium: number | null } | null = null
    const errors: string[] = []
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('propertyId', property.id)
        const res = await fetch('/api/uploads/expense-document', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.success) {
          allRows.push(...(data.preview ?? []))
          lastJobId = data.job_id ?? null
          if (data.insurance && !insuranceMeta) insuranceMeta = data.insurance
        } else {
          errors.push(`${file.name}: ${data.error ?? 'Upload failed'}`)
        }
      } catch {
        errors.push(`${file.name}: Network error`)
      }
    }
    setExpenseProcessing(false)
    if (expenseFileInputRef.current) expenseFileInputRef.current.value = ''
    if (allRows.length > 0) {
      setShowUploadModal(false)
      setPendingImport({ rows: allRows, jobId: lastJobId, insuranceMeta, applyInsurance: false })
      if (errors.length > 0) setExpenseUploadError(errors.join(' · '))
    } else {
      setExpenseUploadError(errors.join(' · ') || 'No transactions found')
    }
  }

  function handleExpenseFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (expenseFileInputRef.current) expenseFileInputRef.current.value = ''
    processExpenseFiles(files)
  }

  async function confirmLoanStatement() {
    if (!loanStatementPreview) return
    setLoanStatementSaving(true)
    setLoanStatementError(null)
    const toImport = loanStatementPreview.rows.filter(r => !r.removed)
    try {
      let resolvedLoanId = loanStatementPreview.loanId

      // Create new loan first if in create mode
      if (loanStatementPreview.createMode && loanStatementPreview.newLoanForm) {
        const f = loanStatementPreview.newLoanForm
        if (!f.lender.trim()) { setLoanStatementError('Lender name is required'); setLoanStatementSaving(false); return }
        const createRes = await fetch('/api/loans/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: property.id,
            lender: f.lender.trim(),
            account_suffix: f.account_suffix.trim() || null,
            loan_limit: f.loan_limit ? parseFloat(f.loan_limit) : null,
            original_amount: f.loan_limit ? parseFloat(f.loan_limit) : loanStatementPreview.balance,
            interest_rate: f.interest_rate ? parseFloat(f.interest_rate) : null,
            rate_type: f.rate_type || 'variable',
            repayment_type: f.repayment_type || 'principal_and_interest',
            loan_term_years: f.loan_term_years ? parseInt(f.loan_term_years) : null,
            start_date: f.start_date || null,
            io_expiry_date: f.io_expiry_date || null,
            fixed_rate_expiry: f.fixed_rate_expiry || null,
            purpose: f.purpose || null,
            deductible_portion_percent: f.deductible_portion_percent ? parseFloat(f.deductible_portion_percent) : null,
            refinanced_from_loan_id: f.refinanced_from_loan_id || null,
            actual_balance: loanStatementPreview.balance,
            balance_date: loanStatementPreview.balanceDate,
          }),
        })
        const createData = await createRes.json()
        if (!createData.success) { setLoanStatementError(createData.error ?? 'Failed to create loan'); setLoanStatementSaving(false); return }
        resolvedLoanId = createData.loanId
      }

      if (!resolvedLoanId) { setLoanStatementError('Please select or create a loan first'); setLoanStatementSaving(false); return }

      const res = await fetch('/api/loans/confirm-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          loanId: resolvedLoanId,
          jobId: loanStatementPreview.jobId,
          balance: loanStatementPreview.balance,
          balanceDate: loanStatementPreview.balanceDate,
          transactions: toImport,
          balanceSnapshots: loanStatementPreview.balanceSnapshots,
          ...(loanStatementPreview.applyRate && loanStatementPreview.detectedRate != null
            ? { newRate: loanStatementPreview.detectedRate }
            : {}),
        }),
      })
      const data = await res.json()
      if (data.success) {
        // Mark loan as paid out if user checked the payout box
        if (loanStatementPreview.markClosed) {
          await fetch('/api/loans/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              loanId: resolvedLoanId,
              propertyId: property.id,
              updates: { status: 'closed', closed_date: loanStatementPreview.balanceDate },
            }),
          })
        }
        setLoanStatementPreview(null)
        if (loanStatementQueue.length > 0) {
          const [next, ...rest] = loanStatementQueue
          setLoanStatementQueue(rest)
          processLoanFile(next.file, next.loanId || undefined)
        } else {
          router.refresh()
        }
      } else setLoanStatementError(data.error ?? 'Confirm failed')
    } catch { setLoanStatementError('Network error') }
    finally { setLoanStatementSaving(false) }
  }

  function removeLoanStatementRow(i: number) {
    setLoanStatementPreview(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, removed: true } : r) } : null)
  }

  function restoreLoanStatementRow(i: number) {
    setLoanStatementPreview(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, removed: false } : r) } : null)
  }

  function updateLoanStatementRowType(i: number, type: string) {
    setLoanStatementPreview(p => p ? { ...p, rows: p.rows.map((r, idx) => idx === i ? { ...r, type } : r) } : null)
  }

  function removeLoanStatementDuplicates() {
    setLoanStatementPreview(p => p ? { ...p, rows: p.rows.map(r => r.duplicate ? { ...r, removed: true } : r) } : null)
  }

  async function handleDeprFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setDeprParsing(true)
    setDeprParseError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('propertyId', property.id)
      const settlementOrPurchase = property.settlement_date ?? property.purchase_date
      if (settlementOrPurchase) fd.append('purchaseDate', settlementOrPurchase)
      const res = await fetch('/api/uploads/depreciation-schedule', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Parse failed')
      setDeprPreviewSource(json.source ?? file.name)
      setDeprPreview(json.entries)
    } catch (err) {
      setDeprParseError(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setDeprParsing(false)
    }
  }

  async function handleDeprConfirm() {
    if (!deprPreview) return
    setDeprConfirming(true)
    try {
      const results = await Promise.all(deprPreview.map(e =>
        fetch('/api/depreciation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property_id: property.id,
            financial_year: e.financial_year,
            plant_equipment_amount: e.plant_equipment_amount,
            division_43_amount: e.division_43_amount,
            source: deprPreviewSource || null,
          }),
        }).then(r => r.json() as Promise<DepreciationSchedule>)
      ))
      setLocalDepreciation(prev => {
        const map = new Map(prev.map(d => [d.financial_year, d]))
        results.forEach(d => { if (d.id) map.set(d.financial_year, d) })
        return [...map.values()]
      })
      setDeprPreview(null)
    } catch (err) {
      setDeprParseError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setDeprConfirming(false)
    }
  }

  async function handleSaveDepr() {
    const div43 = parseFloat(deprForm.division_43) || 0
    const plantEq = parseFloat(deprForm.plant_equipment) || 0
    if (div43 === 0 && plantEq === 0) { setDeprError('Enter at least one depreciation amount.'); return }
    setDeprSaving(true)
    setDeprError(null)
    try {
      const res = await fetch('/api/depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          financial_year: deprForm.financial_year,
          division_43_amount: div43,
          plant_equipment_amount: plantEq,
          source: deprForm.source || null,
          notes: deprForm.notes || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Save failed') }
      const saved: DepreciationSchedule = await res.json()
      setLocalDepreciation(prev => {
        const idx = prev.findIndex(d => d.id === saved.id)
        return idx >= 0 ? prev.map((d, i) => i === idx ? saved : d) : [...prev, saved]
      })
      setDeprModalOpen(false)
    } catch (err) {
      setDeprError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setDeprSaving(false)
    }
  }

  async function handleDeleteDepr(id: string) {
    if (!confirm('Delete this depreciation year? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/depreciation?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setLocalDepreciation(prev => prev.filter(d => d.id !== id))
      setDeprSelected(prev => { const next = new Set(prev); next.delete(id); return next })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleDeprBulkDelete() {
    const ids = [...deprSelected]
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} depreciation year${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setDeprBulkDeleting(true)
    try {
      await Promise.all(ids.map(id => fetch(`/api/depreciation?id=${id}`, { method: 'DELETE' })))
      setLocalDepreciation(prev => prev.filter(d => !ids.includes(d.id)))
      setDeprSelected(new Set())
      setDeprDeleteMode(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeprBulkDeleting(false)
    }
  }

  function handleDeprGenerate() {
    const div43Annual = parseFloat(deprGenForm.div43_annual.replace(/,/g, '')) || 0
    const div40Year1 = parseFloat(deprGenForm.div40_year1.replace(/,/g, '')) || 0
    const start = deprGenForm.schedule_start
    if ((div43Annual <= 0 && div40Year1 <= 0) || !start) return

    const startDate = new Date(start)
    const startMonth = startDate.getMonth()
    const startYear = startDate.getFullYear()
    const fyYear = startMonth >= 6 ? startYear + 1 : startYear
    const existingFYs = new Set(localDepreciation.map(d => d.financial_year))

    // Div 40: diminishing value — derive implied cost from Year 1 amount + pro-rata
    const div40Rate = 2 / parseInt(deprGenForm.div40_life)  // 200% / effective life
    let div40WDV = 0
    if (div40Year1 > 0) {
      const fyEnd0 = new Date(`${fyYear}-06-30`)
      const days0 = Math.round((fyEnd0.getTime() - startDate.getTime()) / 86400000) + 1
      const impliedCost = div40Year1 / (div40Rate * days0 / 365)
      div40WDV = impliedCost - div40Year1
    }

    const entries: { financial_year: string; plant_equipment_amount: number; division_43_amount: number; conflict: boolean }[] = []
    for (let yr = 0; yr < 40; yr++) {
      const fy = fyYear + yr
      const fyLabel = `FY${String(fy).slice(2)}`

      // Div 43 — straight line, year 1 pro-rated
      let d43 = 0
      if (div43Annual > 0) {
        if (yr === 0) {
          const fyEnd = new Date(`${fy}-06-30`)
          const days = Math.round((fyEnd.getTime() - startDate.getTime()) / 86400000) + 1
          d43 = Math.round(div43Annual * days / 365)
        } else {
          d43 = Math.round(div43Annual)
        }
      }

      // Div 40 — diminishing value
      let d40 = 0
      if (div40Year1 > 0) {
        if (yr === 0) {
          d40 = Math.round(div40Year1)
        } else {
          const deduction = Math.round(div40WDV * div40Rate)
          if (deduction >= 1) { d40 = deduction; div40WDV -= deduction }
        }
      }

      if (d43 <= 0 && d40 <= 0) continue
      entries.push({ financial_year: fyLabel, plant_equipment_amount: d40, division_43_amount: d43, conflict: existingFYs.has(fyLabel) })
    }

    setDeprPreview(entries)
    const parts = []
    if (div43Annual > 0) parts.push(`Div 43 $${Math.round(div43Annual).toLocaleString()}/yr`)
    if (div40Year1 > 0) parts.push(`Div 40 $${Math.round(div40Year1).toLocaleString()} yr1 (${deprGenForm.div40_life}yr life)`)
    setDeprPreviewSource(deprGenForm.source || `Auto-generated — ${parts.join(', ')}`)
    setDeprGenOpen(false)
  }

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1360, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        button { transition: filter .12s, opacity .12s, background-color .12s; }
        button:hover:not(:disabled) { filter: brightness(0.9); }
        button:active:not(:disabled) { filter: brightness(0.8); }
        button.icon-btn { transition: background-color .12s, color .12s; }
        button.icon-btn:hover:not(:disabled) { filter: none; background-color: #e8eaf0 !important; color: #1a1e2e !important; }
        button.icon-btn:active:not(:disabled) { background-color: #d1d5db !important; }
      `}</style>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
      <input ref={loanFileInputRef} type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={handleLoanFileUpload} />
      <input ref={expenseFileInputRef} type="file" accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={handleExpenseFileUpload} />

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#5c6478', marginBottom: 20 }}>
        <Link href="/properties" style={{ color: BLUE, fontWeight: 600, textDecoration: 'none' }}>Properties</Link>
        <span style={{ color: '#9ca3af' }}>›</span>
        <strong style={{ color: '#1a1e2e', fontWeight: 800 }}>{property.name}</strong>
        {property.status === 'archived' && (
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: '#f3f4f6', color: '#6b7280', marginLeft: 4 }}>Archived</span>
        )}
        {property.status === 'sold' && (
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: '#f3e8ff', color: '#7c3aed', marginLeft: 4 }}>Sold</span>
        )}
      </div>

      {/* Archived banner */}
      {isArchived && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f3f4f6', border: '1px solid #e4e7f0', borderRadius: 10, padding: '10px 16px', marginBottom: 18, fontSize: 12.5, color: '#6b7280' }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="14" height="3" rx="1"/><path d="M2 6v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6"/><path d="M6 10h4"/>
          </svg>
          <span style={{ flex: 1 }}>This property is archived and read-only. Open Property Details to restore it.</span>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {/* Current Value */}
          {(() => {
            const latestVal = valuations.slice().sort((a, b) => b.valuation_date.localeCompare(a.valuation_date))[0]
            const valDate = latestVal?.valuation_date
            let dotColor = '#9ca3af'; let subText = 'No valuation recorded'
            if (valDate) {
              const months = (new Date().getFullYear() - new Date(valDate).getFullYear()) * 12 + new Date().getMonth() - new Date(valDate).getMonth()
              dotColor = months < 6 ? '#15803d' : months < 12 ? '#d97706' : '#c8332a'
              subText = months === 0 ? 'This month' : months === 1 ? '1 month ago' : `${months} months ago`
              if (months >= 12) subText += ' — consider revaluation'
            }
            return (
              <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize: 11, color: '#5c6478', marginBottom: 6 }}>Current Value</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 3 }}>
                  {displayValuation ? formatCurrency(displayValuation) : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {valDate && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />}
                  {isValuationFallback ? 'Purchase cost (no valuation)' : subText}
                </div>
              </div>
            )
          })()}

          {/* Total Debt */}
          {(() => {
            const activeLoans = loans.filter(l => l.status === 'active')
            const closedLoans = loans.filter(l => l.status === 'closed')
            const totalDrawnBank = progressPayments
              .filter(p => p.drawn_date != null && p.bank_amount != null && p.bank_amount > 0)
              .reduce((s, p) => s + (p.bank_amount ?? 0), 0)
            const showDrawFallback = activeLoans.length === 0 && totalDrawnBank > 0
            const displayDebt = showDrawFallback ? totalDrawnBank : totalLoanBalance
            return (
              <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize: 11, color: '#5c6478', marginBottom: 6 }}>Total Debt</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 3, color: displayDebt > 0 ? '#c8332a' : '#1a1e2e' }}>{formatCurrency(displayDebt)}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                  {showDrawFallback
                    ? 'Lender draws (no loan recorded)'
                    : <>
                        {activeLoans.length} active loan{activeLoans.length !== 1 ? 's' : ''}
                        {closedLoans.length > 0 && <span style={{ marginLeft: 4 }}>· {closedLoans.length} closed</span>}
                      </>
                  }
                </div>
              </div>
            )
          })()}

          {/* Equity */}
          {(() => {
            const totalDrawnBank = progressPayments
              .filter(p => p.drawn_date != null && p.bank_amount != null && p.bank_amount > 0)
              .reduce((s, p) => s + (p.bank_amount ?? 0), 0)
            const effectiveDebt = loans.filter(l => l.status === 'active').length === 0 && totalDrawnBank > 0
              ? totalDrawnBank : totalLoanBalance
            const displayEquity = equity ?? (displayValuation !== null ? displayValuation - effectiveDebt : null)
            const isEstimated = equity === null && displayEquity !== null
            const isNeg = displayEquity !== null && displayEquity < 0
            return (
              <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize: 11, color: '#5c6478', marginBottom: 6 }}>Equity</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 3, color: displayEquity === null ? '#1a1e2e' : isNeg ? '#c8332a' : '#15803d' }}>
                  {displayEquity !== null ? formatCurrency(displayEquity) : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                  {displayEquity === null ? '—' : isNeg ? 'Negative equity' : isEstimated ? 'Est. (no valuation)' : 'Positive equity'}
                </div>
              </div>
            )
          })()}

          {/* LTV */}
          {(() => {
            const totalDrawnBank = progressPayments
              .filter(p => p.drawn_date != null && p.bank_amount != null && p.bank_amount > 0)
              .reduce((s, p) => s + (p.bank_amount ?? 0), 0)
            const effectiveDebt = loans.filter(l => l.status === 'active').length === 0 && totalDrawnBank > 0
              ? totalDrawnBank : totalLoanBalance
            const displayLtv = ltv ?? (displayValuation ? Math.round((effectiveDebt / displayValuation) * 100) : null)
            const isEstimated = ltv === null && displayLtv !== null
            const dotColor = displayLtv === null ? '#9ca3af' : displayLtv < 70 ? '#15803d' : displayLtv < 80 ? '#d97706' : '#c8332a'
            const subText = displayLtv === null ? '—' : displayLtv < 70 ? 'Good position' : displayLtv < 80 ? 'Moderate' : 'High LTV'
            const valueColor = displayLtv === null ? '#1a1e2e' : displayLtv < 70 ? '#15803d' : displayLtv < 80 ? '#d97706' : '#c8332a'
            return (
              <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize: 11, color: '#5c6478', marginBottom: 6 }}>LTV</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 3, color: valueColor }}>{displayLtv !== null ? `${displayLtv}%` : '—'}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {displayLtv !== null && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />}
                  {isEstimated ? `${subText} (est.)` : subText}
                </div>
              </div>
            )
          })()}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e4e7f0', marginBottom: 20, gap: 2 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            padding: '10px 18px', fontSize: 13, cursor: 'pointer', border: 'none', background: 'transparent',
            borderBottom: `2px solid ${tab === i ? BLUE : 'transparent'}`, marginBottom: -2,
            color: tab === i ? BLUE : '#5c6478', fontWeight: tab === i ? 700 : 400,
            borderRadius: '7px 7px 0 0', transition: '.15s'
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setTab(3)} style={{
          padding: '8px 16px', fontSize: 12.5, cursor: 'pointer',
          border: '1px solid',
          borderColor: tab === 3 ? '#d97706 #d97706 transparent #d97706' : '#e4e7f0 #e4e7f0 transparent #e4e7f0',
          background: tab === 3 ? '#fef3c7' : '#fafaf8',
          borderBottom: tab === 3 ? '2px solid #fef3c7' : '2px solid transparent',
          marginBottom: -2,
          color: tab === 3 ? '#92400e' : '#9ca3af', fontWeight: tab === 3 ? 700 : 500,
          borderRadius: '6px 6px 0 0', transition: '.15s'
        }}>Depreciation</button>
      </div>

      {/* ══ OVERVIEW ══════════════════════════════════════════════ */}
      {tab === 0 && (
        <div>

          {/* ── Vacant land banner ── */}
          {property.property_type === 'land' && !isReadOnly && (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                <span style={{ fontSize: 22 }}>🏗️</span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1e2e', marginBottom: 3 }}>Vacant Land</div>
                  <div style={{ fontSize: 12, color: '#5c6478' }}>Ready to build? Add a builder and contract to start tracking construction progress.</div>
                </div>
              </div>
              <button onClick={() => { setBeginConstructionForm({ builder: '', contract_amount: '', start_date: '', capitalise: false, status: 'pre_construction' }); setBeginConstructionError(null); setShowBeginConstruction(true) }}
                style={{ padding: '8px 14px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                Begin Construction
              </button>
            </div>
          )}

          {/* ── Construction banner (H&L, not yet complete) ── */}
          {property.property_type === 'house_and_land' && localConstructionStatus !== 'completed' && (() => {
            const isInProgress = localConstructionStatus === 'in_progress'
            const bannerBg = isInProgress ? '#fffbeb' : '#eff6ff'
            const bannerBorder = isInProgress ? '#fde68a' : '#bfdbfe'
            const badgeBg = isInProgress ? '#d97706' : '#2563a8'
            const badgeLabel = isInProgress ? 'In Progress' : 'Pre-Construction'
            return (
              <div style={{ background: bannerBg, border: `1px solid ${bannerBorder}`, borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <span style={{ fontSize: 22 }}>🏗️</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1e2e' }}>House & Land — Construction</span>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: badgeBg, color: '#fff' }}>{badgeLabel}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                      {property.construction_builder && <span style={{ fontSize: 12, color: '#5c6478' }}>Builder: <strong>{property.construction_builder}</strong></span>}
                      {property.construction_contract_amount != null && <span style={{ fontSize: 12, color: '#5c6478' }}>Contract: <strong>{formatCurrency(property.construction_contract_amount)}</strong></span>}
                      {property.land_value != null && <span style={{ fontSize: 12, color: '#5c6478' }}>Land: <strong>{formatCurrency(property.land_value)}</strong></span>}
                      {property.construction_start_date && (
                        <span style={{ fontSize: 12, color: '#5c6478' }}>
                          {isInProgress ? 'Commenced:' : 'Est. start:'} <strong>{fmtDate(property.construction_start_date)}</strong>
                          {(() => {
                            const diff = Math.floor((Date.now() - new Date(property.construction_start_date!).getTime()) / 86400000)
                            if (isInProgress && diff >= 0) return <span style={{ marginLeft: 4, color: '#d97706', fontWeight: 700 }}>({diff} day{diff !== 1 ? 's' : ''})</span>
                            if (!isInProgress && diff < 0) return <span style={{ marginLeft: 4, color: '#2563a8', fontWeight: 700 }}>({Math.abs(diff)} day{Math.abs(diff) !== 1 ? 's' : ''} away)</span>
                            return null
                          })()}
                        </span>
                      )}
                      {property.capitalise_construction_interest && <span style={{ fontSize: 12, color: '#5c6478' }}>Interest: <strong>Capitalised</strong></span>}
                    </div>
                  </div>
                </div>
                {!isReadOnly && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => {
                      setBeginConstructionForm({
                        builder: property.construction_builder ?? '',
                        contract_amount: property.construction_contract_amount != null ? String(property.construction_contract_amount) : '',
                        start_date: property.construction_start_date ?? '',
                        capitalise: property.capitalise_construction_interest ?? false,
                        status: (property.construction_status as 'pre_construction' | 'in_progress') ?? 'pre_construction',
                      })
                      setBeginConstructionError(null)
                      setIsConstructionEdit(true)
                      setShowBeginConstruction(true)
                    }} style={{ padding: '8px 14px', background: 'transparent', color: '#5c6478', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => { setCompletionDate(''); setCompletionError(null); setShowCompleteConstruction(true) }}
                      style={{ padding: '8px 14px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      Mark as Complete
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Progress Payments Schedule (H&L only) ── */}
          {property.property_type === 'house_and_land' && (() => {
            const totalContract = property.construction_contract_amount ?? 0
            const totalDrawn = progressPayments.filter(p => p.drawn_date).reduce((s, p) => {
                const hasSplit = p.bank_amount != null || p.self_amount != null
                return s + (hasSplit ? (p.bank_amount ?? 0) + (p.self_amount ?? 0) : (p.amount ?? 0))
              }, 0)
            const totalScheduled = progressPayments.reduce((s, p) => s + (p.amount ?? 0), 0)
            const outstanding = totalScheduled - totalDrawn
            const hasContract = totalContract > 0
            const totalPct = hasContract ? Math.round((totalScheduled / totalContract) * 100) : null
            const sumMismatch = hasContract && progressPayments.length > 0 && Math.abs(totalScheduled - totalContract) > 100
            const missingStageCount = STANDARD_STAGES.filter(s => !progressPayments.some(p => p.stage_name.toLowerCase() === s.name.toLowerCase())).length
            return (
              <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: !ppCollapsed && progressPayments.length > 0 ? '1px solid #e4e7f0' : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => setPpCollapsed(c => !c)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: ppCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .18s' }}>
                          <path d="M3 5l4 4 4-4" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1e2e' }}>Progress Payments</span>
                      </button>
                      {progressPayments.length > 0 && (
                        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#5c6478' }}>
                          {hasContract && <span>Contract: <strong style={{ color: '#1a1e2e' }}>{formatCurrency(totalContract)}</strong></span>}
                          <span>Drawn: <strong style={{ color: '#15803d' }}>{formatCurrency(totalDrawn)}</strong></span>
                          {outstanding >= 0
                            ? <span>Outstanding: <strong style={{ color: outstanding > 0 ? '#d97706' : '#9ca3af' }}>{formatCurrency(outstanding)}</strong></span>
                            : <span>Overspent: <strong style={{ color: '#b91c1c' }}>{formatCurrency(Math.abs(outstanding))}</strong></span>
                          }
                        </div>
                      )}
                    </div>
                    {localConstructionStatus === 'completed' && (
                      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: '#9ca3af', paddingLeft: 21 }}>
                        {property.construction_builder && (
                          <span>Builder: <strong style={{ color: '#5c6478' }}>{property.construction_builder}</strong></span>
                        )}
                        {property.construction_contract_amount != null && (
                          <span>Build cost: <strong style={{ color: '#5c6478' }}>{formatCurrency(property.construction_contract_amount)}</strong></span>
                        )}
                        {property.construction_completion_date && (
                          <span>Completed: <strong style={{ color: '#5c6478' }}>{new Date(property.construction_completion_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></span>
                        )}
                      </div>
                    )}
                  </div>
                  {!isReadOnly && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {localConstructionStatus === 'completed' && (
                        <button onClick={undoCompletion}
                          style={{ padding: '5px 11px', background: '#f0f2f7', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: '#5c6478' }}>
                          Undo completion
                        </button>
                      )}
                      {missingStageCount > 0 && (
                        <button onClick={loadStandardStages}
                          style={{ padding: '5px 11px', background: '#f0f2f7', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: '#5c6478' }}>
                          {progressPayments.length === 0 ? 'Load standard stages' : `+ ${missingStageCount} missing stage${missingStageCount > 1 ? 's' : ''}`}
                        </button>
                      )}
                      <button onClick={() => { setPpForm(emptyPPForm); setPpEditId(null); setPpError(null); setPpModalOpen(true) }}
                        style={{ padding: '5px 11px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                        + Add stage
                      </button>
                    </div>
                  )}
                </div>

                {!ppCollapsed && ppLoading && <div style={{ padding: '16px 18px', fontSize: 12.5, color: '#9ca3af' }}>Loading…</div>}

                {!ppCollapsed && !ppLoading && progressPayments.length === 0 && (
                  <div style={{ padding: '20px 18px', fontSize: 12.5, color: '#9ca3af', textAlign: 'center' }}>
                    No stages added yet.{!isReadOnly && ' Use "Load standard stages" or add manually.'}
                  </div>
                )}

                {!ppCollapsed && !ppLoading && progressPayments.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    {sumMismatch && (
                      <div style={{ margin: '10px 14px 0', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', display: 'flex', gap: 8 }}>
                        <span>⚠</span>
                        <span>Stages total {formatCurrency(totalScheduled)}{totalPct !== null ? ` (${totalPct}%)` : ''} — contract is {formatCurrency(totalContract)}. Difference: {formatCurrency(Math.abs(totalScheduled - totalContract))}.</span>
                      </div>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: sumMismatch ? 10 : 0 }}>
                      <colgroup>
                        <col style={{ width: 155 }} />
                        <col style={{ width: 120 }} />
                        <col style={{ width: 88 }} />
                        <col style={{ width: 230 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 100 }} />
                      </colgroup>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          {['Stage', hasContract ? 'Amount / %' : 'Amount', 'Scheduled', 'Drawn', 'Status', ''].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: h.startsWith('Amount') || h === '' ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {progressPayments.map((p, i) => {
                          const status = ppStatus(p)
                          const statusStyle: Record<string, React.CSSProperties> = {
                            drawn: { background: '#dcfce7', color: '#15803d' },
                            overdue: { background: '#fee2e2', color: '#b91c1c' },
                            upcoming: { background: '#eff6ff', color: '#1d4ed8' },
                            unscheduled: { background: '#f3f4f6', color: '#6b7280' },
                          }
                          const statusLabel = { drawn: 'Drawn', overdue: 'Overdue', upcoming: 'Upcoming', unscheduled: 'Pending' }
                          const derivedPct = hasContract && p.amount != null ? ((p.amount / totalContract) * 100).toFixed(1).replace(/\.0$/, '') : null
                          const isConfirmingDelete = ppDeleteId === p.id
                          return (
                            <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f0f2f7', background: isConfirmingDelete ? '#fef2f2' : undefined }}>
                              <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a1e2e' }}>{p.stage_name}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {p.amount != null
                                  ? <><span style={{ fontWeight: 600 }}>{formatCurrency(p.amount)}</span>{derivedPct && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 5 }}>{derivedPct}%</span>}</>
                                  : <span style={{ color: '#9ca3af' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 14px', color: '#5c6478', whiteSpace: 'nowrap' }}>
                                {p.scheduled_date ? fmtDate(p.scheduled_date) : <span style={{ color: '#9ca3af' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                                {p.drawn_date ? (() => {
                                  const drawnTotal = (p.bank_amount ?? 0) + (p.self_amount ?? 0)
                                  const hasSplit = p.bank_amount != null || p.self_amount != null
                                  const drawnDiff = hasSplit && p.amount != null ? drawnTotal - p.amount : null
                                  const drawnMismatch = drawnDiff != null && Math.abs(drawnDiff) > 0.5
                                  return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ color: '#5c6478' }}>{fmtDate(p.drawn_date)}</span>
                                      {hasSplit && (
                                        <span style={{ fontSize: 10.5, color: '#6b7280' }}>
                                          {p.bank_amount != null && `🏦 ${formatCurrency(p.bank_amount)}`}
                                          {p.bank_amount != null && p.self_amount != null && ' / '}
                                          {p.self_amount != null && `👤 ${formatCurrency(p.self_amount)}`}
                                        </span>
                                      )}
                                      {drawnMismatch && drawnDiff != null && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: drawnDiff > 0 ? '#b91c1c' : '#15803d' }}>
                                          {drawnDiff > 0 ? `⚠ ${formatCurrency(drawnDiff)} overspent` : `✓ ${formatCurrency(Math.abs(drawnDiff))} savings`}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })() : <span style={{ color: '#9ca3af' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 14px' }}>
                                <span style={{ ...statusStyle[status], padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                                  {statusLabel[status]}
                                </span>
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {!isReadOnly && (
                                  isConfirmingDelete
                                    ? <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>Delete?</span>
                                        <button onClick={() => deleteProgressPayment(p.id)} style={{ padding: '3px 9px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Yes</button>
                                        <button onClick={() => setPpDeleteId(null)} style={{ padding: '3px 9px', background: '#f0f2f7', color: '#5c6478', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>No</button>
                                      </div>
                                    : <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                        {!p.drawn_date
                                          ? <button onClick={() => { setPpDrawnId(p.id); setPpDrawnDate(''); setPpDrawnBank(p.amount != null ? String(p.amount) : ''); setPpDrawnSelf('') }}
                                              style={{ padding: '3px 9px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                              Mark drawn
                                            </button>
                                          : <button onClick={() => { setPpDrawnId(p.id); setPpDrawnDate(p.drawn_date ?? ''); setPpDrawnBank(p.bank_amount != null ? String(p.bank_amount) : ''); setPpDrawnSelf(p.self_amount != null ? String(p.self_amount) : '') }}
                                              style={{ padding: '3px 9px', background: '#eff6ff', color: '#0369a1', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                              Edit draw
                                            </button>
                                        }
                                        <button onClick={() => {
                                          const contract = property.construction_contract_amount
                                          const pct = contract && p.amount != null ? parseFloat(((p.amount / contract) * 100).toFixed(2)).toString() : ''
                                          setPpForm({ stage_name: p.stage_name, amount: p.amount != null ? String(p.amount) : '', percentage: pct, scheduled_date: p.scheduled_date ?? '', notes: p.notes ?? '' })
                                          setPpEditId(p.id); setPpError(null); setPpModalOpen(true)
                                        }} style={{ padding: '3px 9px', background: '#f0f2f7', color: '#5c6478', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                          Edit
                                        </button>
                                        <button onClick={() => setPpDeleteId(p.id)}
                                          style={{ padding: '3px 9px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                          ×
                                        </button>
                                      </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {progressPayments.length > 1 && totalScheduled > 0 && (
                        <tfoot>
                          <tr style={{ borderTop: '2px solid #e4e7f0', background: '#f8fafc' }}>
                            <td style={{ padding: '9px 14px', fontWeight: 800, fontSize: 12, color: '#1a1e2e' }}>Total</td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                              {formatCurrency(totalScheduled)}{totalPct !== null && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 5 }}>{totalPct}%</span>}
                            </td>
                            <td />
                            <td style={{ padding: '9px 14px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {totalDrawn > 0 ? (() => {
                                const netVariance = totalDrawn - totalScheduled
                                const hasVariance = Math.abs(netVariance) > 0.5
                                return (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 800, fontSize: 12, color: '#15803d' }}>{formatCurrency(totalDrawn)}</span>
                                    {hasVariance
                                      ? <span style={{ fontSize: 10, fontWeight: 700, color: netVariance > 0 ? '#b91c1c' : '#15803d' }}>
                                          {netVariance > 0 ? `⚠ ${formatCurrency(netVariance)} overspent` : `✓ ${formatCurrency(Math.abs(netVariance))} savings`}
                                        </span>
                                      : totalDrawn < totalScheduled
                                        ? <span style={{ fontSize: 10.5, color: '#9ca3af' }}>{formatCurrency(totalScheduled - totalDrawn)} remaining</span>
                                        : null
                                    }
                                  </div>
                                )
                              })() : <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Row 1: Photo | Property Details | Property Manager */}
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
            {/* Property photo / map card */}
            <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', minHeight: 200 }}>
              <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
              {photoUrl
                ? <img src={photoUrl} alt={property.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <iframe
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(`${property.street_address}, ${property.suburb} ${property.state} ${property.postcode}`)}&output=embed&z=15`}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', minHeight: 200 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
              }
              {/* Address overlay */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,.65))', padding: '24px 16px 12px' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 2 }}>{property.name}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.75)' }}>{property.street_address}, {property.suburb} {property.state} {property.postcode}</div>
              </div>
              {/* Upload button */}
              {!isReadOnly && (
                <button onClick={() => photoInputRef.current?.click()} disabled={photoUploading}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.45)', border: 'none', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#fff', cursor: photoUploading ? 'default' : 'pointer', backdropFilter: 'blur(4px)', fontWeight: 600 }}>
                  {photoUploading ? 'Uploading…' : photoUrl ? '↺ Change photo' : '+ Add photo'}
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
              <div style={{ ...card, marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Property Details</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: property.status === 'active' ? '#dcfce7' : property.status === 'sold' ? '#f3e8ff' : '#f3f4f6',
                      color: property.status === 'active' ? '#15803d' : property.status === 'sold' ? '#7c3aed' : '#6b7280',
                    }}>
                      {property.status === 'active' ? 'Active' : property.status === 'sold' ? 'Sold' : 'Archived'}
                    </span>
                    <button onClick={() => { setDetailsForm({ name: property.name ?? '', street_address: property.street_address ?? '', suburb: property.suburb ?? '', state: property.state ?? '', postcode: property.postcode ?? '', usage: property.usage ?? 'investment', mixed_use_investment_percent: property.mixed_use_investment_percent != null ? String(property.mixed_use_investment_percent) : '', purchase_date: property.purchase_date ?? '', settlement_date: property.settlement_date ?? '', purchase_price: property.purchase_price != null ? String(property.purchase_price) : '' }); setAcqForm(acquisitionCosts.map(c => ({ type: c.type, amount: String(c.amount), description: c.description ?? '' }))); setOverviewError(null); setEditingDetails(true) }}
                      style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
                  <Field label="Street address" value={property.street_address} />
                  <Field label="Suburb" value={property.suburb} />
                  <Field label="State" value={property.state} />
                  <Field label="Postcode" value={property.postcode} />
                  <Field label="Usage" value={property.usage === 'investment' ? 'Investment' : property.usage === 'ppor' ? 'PPOR' : 'Mixed'} />
                  <Field label="Your share" value={`${sharePercentage}%`} />
                  {property.property_type === 'off_the_plan' && <Field label="Type" value="Off The Plan" />}
                </div>
                {!(property.property_type === 'house_and_land' && property.construction_status !== 'completed') && (() => {
                  const isHnLComplete = property.property_type === 'house_and_land' && property.construction_status === 'completed'
                  const totalCost = isHnLComplete
                    ? (property.purchase_price ?? 0) + (property.construction_contract_amount ?? 0)
                    : (property.purchase_price ?? 0)
                  return (
                    <>
                      <div style={{ ...sHead, marginTop: 4 }}>Purchase</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
                        <Field label="Contract date" value={property.purchase_date ?? '—'} />
                        <Field label="Settlement date" value={property.settlement_date ?? '—'} />
                        <Field label="Total cost" value={totalCost > 0 ? formatCurrency(totalCost) : '—'} />
                        {property.property_type === 'off_the_plan' && property.deposit_paid != null && (
                          <Field label="Deposit paid" value={formatCurrency(property.deposit_paid)} />
                        )}
                      </div>
                    </>
                  )
                })()}
                {/* Cost base */}
                {!acqLoading && (() => {
                  const isHnL = property.property_type === 'house_and_land'
                  const totalAcq = acquisitionCosts.reduce((s, c) => s + c.amount, 0)
                  const totalCapEx = transactions.filter(tx => tx.type === 'capital_expense').reduce((s, tx) => s + Math.abs(tx.amount), 0)
                  const totalDepr = depreciation.filter(d => d.financial_year <= currentFYInfo().label).reduce((s, d) => s + d.division_43_amount + d.plant_equipment_amount, 0)
                  const contractAmt = isHnL ? (property.construction_contract_amount ?? 0) : 0
                  const propertyValue = (property.purchase_price ?? 0) + contractAmt
                  const avgRate = loans.length > 0 ? loans.reduce((s, l) => s + l.interest_rate, 0) / loans.length : 0
                  const capResolved = (isHnL && property.capitalise_construction_interest)
                    ? resolveCapitalisedInterest({
                        transactions: transactions.map(tx => ({ ...tx, capitalised: txCapitalised(tx) })),
                        progressPayments,
                        annualRatePct: avgRate,
                        landPrice: property.purchase_price ?? 0,
                        constructionStartDate: property.construction_start_date ?? null,
                        completionDate: property.construction_completion_date ?? null,
                      })
                    : { actual: 0, estimated: 0, hasActual: false }
                  // Only confirmed actual interest goes into the cost base
                  const capInterest = capResolved.actual
                  const costBase = propertyValue + totalAcq + capInterest + totalCapEx - totalDepr
                  return acquisitionCosts.length > 0 || totalCapEx > 0 || isHnL ? (
                    <div style={{ paddingTop: 10, borderTop: '1px solid #f0f2f7' }}>
                      <div style={{ ...sHead, marginBottom: 8 }}>Cost Base</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {/* Line 1: Land & Build (or Purchase) */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                          <span style={{ color: '#5c6478' }}>{isHnL ? 'Land & construction' : 'Purchase'}</span>
                          <span>{formatCurrency(propertyValue)}</span>
                        </div>
                        {/* Line 2: Acquisition & Holding (actual only) */}
                        {(acquisitionCosts.length > 0 || capInterest > 0) && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                            <span style={{ color: '#5c6478' }}>Acquisition{capInterest > 0 ? ' & holding' : ''}</span>
                            <span>{formatCurrency(totalAcq + capInterest)}</span>
                          </div>
                        )}
                        {/* Est. holding reference line (no actual yet) */}
                        {isHnL && property.capitalise_construction_interest && !capResolved.hasActual && capResolved.estimated > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#9ca3af' }}>
                            <span>Est. holding (not yet confirmed)</span>
                            <span>~{formatCurrency(capResolved.estimated)}</span>
                          </div>
                        )}
                        {/* Adjustments */}
                        {totalCapEx > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#5c6478' }}>Capital works</span><span>{formatCurrency(totalCapEx)}</span></div>}
                        {totalDepr > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span style={{ color: '#5c6478' }}>Less depreciation</span><span style={{ color: '#c8332a' }}>({formatCurrency(totalDepr)})</span></div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, paddingTop: 6, borderTop: '1px solid #e4e7f0', marginTop: 2 }}><span>Cost base</span><span>{formatCurrency(costBase)}</span></div>
                      </div>
                    </div>
                  ) : null
                })()}

              </div>
              {property.status === 'sold' ? (() => {
                const totalSaleCosts = saleCosts.reduce((s, c) => s + c.amount, 0)
                const netProceeds = (property.sold_price ?? 0) - totalSaleCosts
                const totalAcqSale = acquisitionCosts.reduce((s, c) => s + c.amount, 0)
                const totalCapExSale = transactions.filter(tx => tx.type === 'capital_expense').reduce((s, tx) => s + Math.abs(tx.amount), 0)
                const totalDeprSale = depreciation.filter(d => d.financial_year <= currentFYInfo().label).reduce((s, d) => s + d.division_43_amount + d.plant_equipment_amount, 0)
                const contractAmtSale = progressPayments.reduce((s, p) => s + (p.amount ?? 0), 0)
                const costBaseSale = (property.purchase_price ?? 0) + contractAmtSale + totalAcqSale + totalCapExSale - totalDeprSale
                const realisedGain = netProceeds - costBaseSale
                const sRow = (label: string, value: string, color?: string) => (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: '#5c6478' }}>{label}</span>
                    <span style={{ color: color ?? '#1a1e2e' }}>{value}</span>
                  </div>
                )
                return (
                  <div style={{ ...card, marginBottom: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Sale &amp; Capital Gain</h3>
                      {!isReadOnly && (
                        <button onClick={() => { setSaleForm(saleCosts.map(c => ({ type: c.type, amount: String(c.amount), description: c.description ?? '' }))); setSoldForm(f => ({ ...f, sold_date: property.sold_date ?? '', sold_price: property.sold_price != null ? String(property.sold_price) : '' })); setSaleError(null); setEditingSaleCosts(true) }}
                          style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 2 }}>Gross proceeds</div>
                      {property.sold_price != null
                        ? sRow('Sale price', formatCurrency(property.sold_price))
                        : <div style={{ fontSize: 11.5, color: '#9ca3af' }}>No sale price recorded.</div>}
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginTop: 8, marginBottom: 2 }}>Sale costs</div>
                      {saleCosts.length > 0 ? (() => {
                        const named = saleCosts.filter(c => c.type !== 'other')
                        const others = saleCosts.filter(c => c.type === 'other')
                        const othersTotal = others.reduce((s, c) => s + c.amount, 0)
                        return (
                          <>
                            {named.map((c, i) => <div key={i}>{sRow(SALE_LABELS[c.type], `− ${formatCurrency(c.amount)}`, '#c8332a')}</div>)}
                            {others.length > 0 && (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, alignItems: 'center' }}>
                                  <button onClick={() => setSaleOthersExpanded(v => !v)}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#5c6478', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ fontSize: 10, display: 'inline-block', transform: saleOthersExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
                                    Other{others.length > 1 ? ` (${others.length})` : ''}
                                  </button>
                                  <span style={{ color: '#c8332a' }}>− {formatCurrency(othersTotal)}</span>
                                </div>
                                {saleOthersExpanded && others.map((c, i) => (
                                  <div key={i} style={{ paddingLeft: 16 }}>{sRow(c.description || 'Other', `− ${formatCurrency(c.amount)}`, '#c8332a')}</div>
                                ))}
                              </>
                            )}
                          </>
                        )
                      })() : <div style={{ fontSize: 11.5, color: '#9ca3af' }}>No sale costs recorded.</div>}
                      {saleCosts.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, paddingTop: 5, borderTop: '1px solid #f0f2f7', marginTop: 1, color: '#374151' }}>
                          <span>Sale costs total</span><span>− {formatCurrency(totalSaleCosts)}</span>
                        </div>
                      )}
                      {property.sold_price != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, paddingTop: 8, marginTop: 4, borderTop: '2px solid #e4e7f0' }}>
                          <span>Net proceeds</span><span>{formatCurrency(netProceeds)}</span>
                        </div>
                      )}
                      {property.sold_price != null && property.purchase_price != null && (
                        <>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginTop: 10, marginBottom: 2 }}>Capital gain / loss</div>
                          {sRow('Net proceeds', formatCurrency(netProceeds))}
                          {sRow('Less: adjusted cost base', `− ${formatCurrency(costBaseSale)}`)}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, paddingTop: 8, marginTop: 4, borderTop: '2px solid #e4e7f0' }}>
                            <span>Realised {realisedGain >= 0 ? 'gain' : 'loss'}</span>
                            <span style={{ color: realisedGain >= 0 ? '#15803d' : '#c8332a' }}>
                              {realisedGain >= 0 ? '+' : ''}{formatCurrency(realisedGain)}
                            </span>
                          </div>
                          {realisedGain > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#5c6478', marginTop: 4 }}>
                              <span>50% CGT discount (if held &gt;12 months)</span>
                              <span style={{ fontWeight: 600, color: '#15803d' }}>+{formatCurrency(realisedGain / 2)}</span>
                            </div>
                          )}
                          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 6 }}>Indicative only — consult your accountant for final CGT position.</div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })() : (
              <div style={{ ...card, marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Insurance</h3>
                  {!isReadOnly && <button onClick={() => { setInsuranceForm({ insurance_provider: property.insurance_provider ?? '', insurance_policy_number: property.insurance_policy_number ?? '', insurance_expiry: property.insurance_expiry ?? '', insurance_premium: property.insurance_premium != null ? String(property.insurance_premium) : '', pm_agency: property.pm_agency ?? '', pm_name: property.pm_name ?? '', pm_phone: property.pm_phone ?? '', pm_email: property.pm_email ?? '', pm_fee_percent: property.pm_fee_percent != null ? String(property.pm_fee_percent) : '', lease_expiry_date: property.lease_expiry_date ?? '', construction_builder: property.construction_builder ?? '', construction_contract_amount: property.construction_contract_amount != null ? String(property.construction_contract_amount) : '', construction_start_date: property.construction_start_date ?? '', capitalise_construction_interest: property.capitalise_construction_interest ?? false, construction_status: property.construction_status ?? 'pre_construction' }); setOverviewError(null); setEditingInsurance(true) }}
                    style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Edit</button>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                  <Field label="Provider" value={property.insurance_provider ?? '—'} />
                  <Field label="Policy number" value={property.insurance_policy_number ?? '—'} />
                  <Field label="Expiry date" value={property.insurance_expiry ?? '—'} />
                  <Field label="Annual premium" value={property.insurance_premium != null ? formatCurrency(property.insurance_premium) : '—'} />
                </div>

                {/* Under construction: show builder details instead of PM */}
                {property.property_type === 'house_and_land' && property.construction_status !== 'completed' ? (
                  <>
                    <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 12px', paddingTop: 16, borderTop: '1px solid #e4e7f0' }}>Builder</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <Field label="Builder" value={property.construction_builder ?? '—'} />
                      <Field label="Contract amount" value={property.construction_contract_amount != null ? formatCurrency(property.construction_contract_amount) : '—'} />
                      <Field label={property.construction_status === 'in_progress' ? 'Started' : 'Est. start'} value={property.construction_start_date ? fmtDate(property.construction_start_date) : '—'} />
                      <Field
                        label="Days since commencement"
                        value={
                          property.construction_status === 'in_progress' && property.construction_start_date
                            ? `${Math.max(0, Math.floor((Date.now() - new Date(property.construction_start_date).getTime()) / 86400000))} days`
                            : '—'
                        }
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 12px', paddingTop: 16, borderTop: '1px solid #e4e7f0' }}>Property Manager</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <Field label="Agency" value={property.pm_agency ?? '—'} />
                      <Field label="Contact name" value={property.pm_name ?? '—'} />
                      <Field label="Phone" value={property.pm_phone ?? '—'} />
                      <Field label="Email" value={property.pm_email ?? '—'} />
                      <Field label="Management fee" value={property.pm_fee_percent != null ? `${property.pm_fee_percent}%` : '—'} />
                      <Field label="Lease expiry" value={property.lease_expiry_date ?? '—'} />
                    </div>
                  </>
                )}
              </div>
              )}
            </div>
          </div>

          {/* Row 2: Equity vs Debt | Valuation History | Monthly Cashflow */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={card}>
              <h3 style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 16 }}>Equity vs Debt</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <LTVDonut equity={equity ?? 0} debt={totalLoanBalance} />
                <div style={{ flex: 1 }}>
                  {[
                    { label: 'Equity', value: formatCurrency(equity ?? 0), color: GOLD },
                    { label: 'Debt', value: formatCurrency(totalLoanBalance), color: BLUE },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f7fa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: r.color }} />
                        <span style={{ fontSize: 13, color: '#5c6478' }}>{r.label}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{displayValuation ? formatCurrency(displayValuation) : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={card}>
              <h3 style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 16 }}>Valuation History</h3>
              {(() => {
                let hnlPoints: ValuationPoint[] | undefined
                if (property.property_type === 'house_and_land') {
                  const landPrice = property.purchase_price ?? 0
                  const landDate = property.purchase_date
                  const pts: ValuationPoint[] = []

                  const settlementMs = landDate ? new Date(landDate).getTime() : 0
                  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })

                  // Land settlement is always the first point at land price
                  if (landDate && landPrice > 0) {
                    pts.push({ date: landDate, value: landPrice, label: fmt(landDate), stageName: 'Land settlement' })
                  }

                  // Every drawn payment is its own point — pre-settlement draws are anchored
                  // to the land settlement date so they appear right after it on the x-axis
                  // but remain visually distinct from the land settlement point itself.
                  const allDrawnSorted = progressPayments
                    .filter(p => p.drawn_date)
                    .sort((a, b) => new Date(a.drawn_date!).getTime() - new Date(b.drawn_date!).getTime())

                  let cumulative = landPrice
                  for (const p of allDrawnSorted) {
                    const amt = (p.bank_amount != null || p.self_amount != null)
                      ? (p.bank_amount ?? 0) + (p.self_amount ?? 0)
                      : (p.amount ?? 0)
                    cumulative += amt
                    // Anchor pre-settlement draws to settlement date so they don't appear
                    // before the land point on the x-axis
                    const chartDate = settlementMs && new Date(p.drawn_date!).getTime() < settlementMs
                      ? landDate!
                      : p.drawn_date!
                    pts.push({
                      date: chartDate,
                      value: cumulative,
                      label: fmt(chartDate),
                      stageName: p.stage_name,
                    })
                  }

                  hnlPoints = pts
                }
                const hnlCompletionBase = hnlPoints && hnlPoints.length > 0
                  ? hnlPoints[hnlPoints.length - 1].value
                  : undefined
                return (
                  <ValuationChart
                    valuations={valuations}
                    purchasePrice={property.purchase_price}
                    purchaseDate={property.purchase_date}
                    constructionPoints={hnlPoints}
                    completionDate={property.construction_status === 'completed' ? property.construction_completion_date : null}
                    completionBaseValue={hnlCompletionBase}
                    soldDate={property.sold_date}
                    soldPrice={property.sold_price}
                  />
                )
              })()}
            </div>
            <div style={card}>
              <h3 style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 16 }}>Monthly Cashflow — {currentFYInfo().label}</h3>
              <CashflowChart transactions={transactions} compact fyOnly />
            </div>
          </div>

          {/* Recent transactions */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Recent Transactions</h3>
              <button onClick={() => setTab(2)} style={{ fontSize: 12, color: BLUE, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                View all →
              </button>
            </div>
            {recentTx.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>No transactions yet.</p>
                {!isReadOnly && (
                  <button onClick={() => { setTab(2); setTimeout(() => { setSelectedLoanId(''); setShowUploadModal(true) }, 100) }}
                    style={{ padding: '8px 16px', background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                    Upload Documents
                  </button>
                )}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Date', 'Type', 'Description', 'Amount'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '7px 10px', background: '#f9fafb', color: '#9ca3af', fontSize: 10.5, fontWeight: 700, borderBottom: '1px solid #e4e7f0', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {recentTx.map(tx => (
                    <tr key={tx.id}>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f5f7fa', color: '#5c6478', fontSize: 12, whiteSpace: 'nowrap', width: 90 }}>{tx.transaction_date}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f5f7fa', whiteSpace: 'nowrap', width: 140 }}>{TX_SHORT_LABELS[tx.type] ?? tx.type.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f5f7fa', color: '#5c6478', fontSize: 12 }}>{tx.description ?? '—'}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f5f7fa', textAlign: 'right', fontWeight: tx.type === 'principal_payment' ? 400 : 600, fontVariantNumeric: 'tabular-nums', color: tx.type === 'principal_payment' ? '#9ca3af' : tx.amount < 0 ? '#c8332a' : '#15803d' }}>
                        {tx.amount < 0 ? `(${formatCurrency(Math.abs(tx.amount))})` : formatCurrency(tx.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}

      {/* ══ FINANCE ═══════════════════════════════════════════════ */}
      {tab === 1 && (
        <div>
          {/* Broker card + Amortisation chart */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
            {loans.length > 0 ? (
              <div style={{ ...card, marginBottom: 0 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 16px' }}>Loan Balance Forecast</h3>
                <MultiLoanChart loans={loans.filter(l => l.status !== 'closed')} loanBalances={loanBalances} />
              </div>
            ) : (
              <div style={{ ...card, marginBottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10, minHeight: 180, background: '#f8fafc', border: '1.5px dashed #d1d5db', boxShadow: 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="6" width="14" height="10" rx="2" stroke="#9ca3af" strokeWidth="1.5"/><path d="M7 6V5a3 3 0 016 0v1" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 11v2M9 12h2" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#374151', marginBottom: 4 }}>No loans linked</div>
                  <div style={{ fontSize: 12, color: '#9ca3af', maxWidth: 260, lineHeight: 1.6 }}>
                    Add a loan to see balance forecasts, IO expiry alerts, and repayment tracking.
                  </div>
                </div>
                {!isReadOnly && (
                  <button onClick={openRfWizardAdd} style={{ padding: '8px 18px', background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', marginTop: 4 }}>
                    + Add Loan
                  </button>
                )}
              </div>
            )}
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Mortgage Broker</h3>
                {!isReadOnly && <button onClick={() => { setBrokerForm({ broker_name: property.broker_name ?? '', broker_company: property.broker_company ?? '', broker_phone: property.broker_phone ?? '', broker_email: property.broker_email ?? '', broker_license: property.broker_license ?? '' }); setOverviewError(null); setEditingBroker(true) }}
                  style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Edit</button>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Name" value={property.broker_name ?? '—'} />
                <Field label="Company" value={property.broker_company ?? '—'} />
                <Field label="Phone" value={property.broker_phone ?? '—'} />
                <Field label="Email" value={property.broker_email ?? '—'} />
                <Field label="Credit licence" value={property.broker_license ?? '—'} />
              </div>
            </div>
          </div>

          {/* Three-column: loan cards · cost base · valuation history */}
          <div style={{ display: 'grid', gridTemplateColumns: '9fr 5.5fr 5.5fr', gap: 16, alignItems: 'start' }}>

            {/* Left: loan cards */}
            <div>
              {loanUploadError && (
                <div style={{ marginBottom: 10, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>⚠ {loanUploadError}</span>
                  <button onClick={() => setLoanUploadError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c8332a', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '14px 18px', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: '#5c6478' }}>Total loan balance</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {loans.filter(l => l.status !== 'closed').length >= 2 && (
                    <span style={{ fontSize: 12, color: '#5c6478' }}>
                      Blended rate: <strong style={{ color: '#1a1e2e' }}>
                        {(loans.filter(l => l.status !== 'closed').reduce((s, l) => s + l.current_balance * (l.interest_rate ?? 0), 0) /
                          (loans.filter(l => l.status !== 'closed').reduce((s, l) => s + l.current_balance, 0) || 1)).toFixed(2)}%
                      </strong>
                    </span>
                  )}
                  <strong style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalLoanBalance)}</strong>
                </div>
              </div>

              {loans.filter(l => l.status !== 'closed').length === 0 && loans.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, textAlign: 'center', padding: '32px' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No loans added</p>
                  {!isReadOnly && <button onClick={openRfWizardAdd} style={{ padding: '9px 16px', background: GOLD, color: '#1a1200', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>+ Add Loan</button>}
                </div>
              ) : (
                loans.filter(l => l.status !== 'closed').map(loan => {
                  const ioExpired = loan.io_expiry_date && new Date(loan.io_expiry_date) < new Date()
                  const ioExpiring = !ioExpired && loan.io_expiry_date && new Date(loan.io_expiry_date) < new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000)
                  const hasActual = loan.actual_balance !== null && loan.actual_balance !== undefined
                  const isManualUpdating = updatingLoanId === loan.id
                  return (
                    <div key={loan.id} style={{ background: '#fff', border: `1px solid ${ioExpired ? '#fca5a5' : ioExpiring ? '#fde68a' : '#e4e7f0'}`, borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
                      {/* Card header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: ioExpired ? '#fef2f2' : ioExpiring ? '#fffbeb' : '#f9fafb', borderBottom: '1px solid #e4e7f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{loan.lender}{loan.account_suffix ? ` · ${loan.account_suffix}` : ''}</span>
                          {(loan.repayment_type === 'interest_only' || loan.repayment_type === 'interest_in_advance') && (
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: ioExpired ? '#fee2e2' : ioExpiring ? '#fef3c7' : '#eff6ff', color: ioExpired ? '#b91c1c' : ioExpiring ? '#92400e' : BLUE }}>
                              {ioExpired ? '⚠ IO expired' : ioExpiring ? '⚠ IO expiring' : loan.repayment_type === 'interest_in_advance' ? 'Interest in Advance' : 'Interest Only'}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ textAlign: 'right' }}>
                            <strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(loan.current_balance)}</strong>
                            <div style={{ fontSize: 10, marginTop: 1 }}>
                              {hasActual
                                ? <span style={{ color: '#15803d' }}>actual · {loan.balance_date}</span>
                                : <span style={{ color: '#9ca3af' }}>est. formula</span>
                              }
                            </div>
                          </div>
                          <div style={{ position: 'relative' }}>
                            <button
                              onClick={() => !isReadOnly && setOpenKebabId(openKebabId === loan.id ? null : loan.id)}
                              disabled={isReadOnly}
                              style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isReadOnly ? '#f9fafb' : openKebabId === loan.id ? '#e0e7ff' : '#f0f2f7', border: 'none', borderRadius: 6, fontSize: 16, color: isReadOnly ? '#d1d5db' : '#5c6478', cursor: isReadOnly ? 'default' : 'pointer', lineHeight: 1 }}>
                              ⋮
                            </button>
                            {openKebabId === loan.id && (
                              <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setOpenKebabId(null)} />
                                <div style={{ position: 'absolute', top: '110%', right: 0, background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 170, zIndex: 99, overflow: 'hidden' }}>
                                  <button onClick={() => { setOpenKebabId(null); openEditLoan(loan) }}
                                    style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer', color: '#1e2942' }}>
                                    Edit loan details
                                  </button>
                                  <button onClick={() => { setOpenKebabId(null); openRfWizard(loan) }}
                                    style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer', color: '#15803d' }}>
                                    Refinance this loan
                                  </button>
                                  <button onClick={() => { setOpenKebabId(null); isManualUpdating ? setUpdatingLoanId(null) : openManualBalance(loan) }}
                                    style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer', color: '#1e2942' }}>
                                    {isManualUpdating ? 'Cancel update' : 'Update balance/rate'}
                                  </button>
                                  <button onClick={() => { setOpenKebabId(null); setPayoutLoanId(loan.id); setPayoutDate(new Date().toISOString().slice(0,10)); setPayoutError(null) }}
                                    style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer', color: '#15803d' }}>
                                    Mark as paid out
                                  </button>
                                  <button onClick={() => { setOpenKebabId(null); setDeleteLoanId(loan.id); setDeleteLoanError(null) }}
                                    style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer', color: '#c8332a' }}>
                                    Delete loan
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Manual balance/rate update form */}
                      {isManualUpdating && (
                        <div style={{ padding: '14px 16px', background: '#f8faff', borderBottom: '1px solid #e4e7f0' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 10.5, color: '#5c6478', marginBottom: 4, fontWeight: 600 }}>Balance ($)</div>
                              <input
                                type="number"
                                step="0.01"
                                value={manualBalanceForm.amount}
                                onChange={e => setManualBalanceForm(f => ({ ...f, amount: e.target.value }))}
                                style={{ padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: 7, fontSize: 13, width: 150, outline: 'none' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 10.5, color: '#5c6478', marginBottom: 4, fontWeight: 600 }}>Rate (%)</div>
                              <input
                                type="number"
                                step="0.01"
                                placeholder={String(loan.interest_rate)}
                                value={manualBalanceForm.rate}
                                onChange={e => setManualBalanceForm(f => ({ ...f, rate: e.target.value }))}
                                style={{ padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: 7, fontSize: 13, width: 90, outline: 'none' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 10.5, color: '#5c6478', marginBottom: 4, fontWeight: 600 }}>As at date</div>
                              <input
                                type="date"
                                value={manualBalanceForm.date}
                                onChange={e => setManualBalanceForm(f => ({ ...f, date: e.target.value }))}
                                style={{ padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: 7, fontSize: 13, outline: 'none' }}
                              />
                            </div>
                            <button
                              onClick={() => saveManualBalance(loan.id)}
                              disabled={manualBalanceSaving}
                              style={{ padding: '7px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                              {manualBalanceSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setUpdatingLoanId(null)}
                              style={{ padding: '7px 14px', background: '#f0f2f7', color: '#5c6478', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                              Cancel
                            </button>
                            {manualBalanceError && <span style={{ fontSize: 12, color: '#c8332a' }}>⚠ {manualBalanceError}</span>}
                          </div>
                        </div>
                      )}

                      {/* Reforecast prompt */}
                      {reforecastPending?.loanId === loan.id && (
                        <div style={{ padding: '12px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12.5, color: '#78350f', flex: 1 }}>
                            Balance saved. Recalculate the amortisation forecast from {reforecastPending.date}?
                          </span>
                          <button
                            onClick={confirmReforecast}
                            style={{ padding: '6px 14px', background: '#f59e0b', color: '#1a1200', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                            Yes, reforecast
                          </button>
                          <button
                            onClick={skipReforecast}
                            style={{ padding: '6px 12px', background: '#f0f2f7', color: '#5c6478', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                            No, keep original
                          </button>
                        </div>
                      )}

                      {/* Loan details grid */}
                      {(() => {
                        const maturity = new Date(loan.start_date)
                        maturity.setFullYear(maturity.getFullYear() + loan.loan_term_years)
                        const maturityStr = maturity.toISOString().slice(0, 10)
                        const now = new Date()
                        const totalMonths = (maturity.getFullYear() - now.getFullYear()) * 12 + (maturity.getMonth() - now.getMonth())
                        const remYears = Math.floor(Math.abs(totalMonths) / 12)
                        const remMonths = Math.abs(totalMonths) % 12
                        const remaining = totalMonths <= 0
                          ? 'matured'
                          : remYears > 0 && remMonths > 0 ? `${remYears} yr${remYears !== 1 ? 's' : ''} ${remMonths} mo`
                          : remYears > 0 ? `${remYears} yr${remYears !== 1 ? 's' : ''}`
                          : `${remMonths} mo`
                        const isIO = loan.repayment_type === 'interest_only' || loan.repayment_type === 'interest_in_advance'
                        const repaymentLabel = loan.repayment_type === 'principal_and_interest' ? 'Principal & Interest' : loan.repayment_type === 'interest_in_advance' ? 'Interest in Advance' : 'Interest Only'
                        const ioExpiryRemaining = (() => {
                          if (!loan.io_expiry_date) return ''
                          const today = new Date(); today.setHours(0,0,0,0)
                          const exp = new Date(loan.io_expiry_date); exp.setHours(0,0,0,0)
                          if (exp <= today) return 'expired'
                          let y = exp.getFullYear() - today.getFullYear()
                          let m = exp.getMonth() - today.getMonth()
                          if (m < 0) { y--; m += 12 }
                          return y > 0 ? `${y} yr${y !== 1 ? 's' : ''}${m > 0 ? ` ${m} mo` : ''}` : `${m} mo`
                        })()
                        const fields = [
                          { label: 'Original amount', value: formatCurrency(loan.original_amount) },
                          { label: 'Start date', value: fmtDate(loan.start_date) },
                          { label: 'Loan term', value: `${loan.loan_term_years} yr${loan.loan_term_years !== 1 ? 's' : ''}`, sub: remaining },
                          { label: 'Rate', value: `${loan.interest_rate}%`, sub: loan.rate_effective_date ? `as of ${fmtDate(loan.rate_effective_date)}` : undefined, subColor: '#9ca3af' },
                          { label: 'Type', value: `${repaymentLabel} · ${loan.rate_type === 'fixed' ? 'Fixed' : 'Variable'}` },
                          ...(isIO && loan.io_expiry_date ? [{ label: 'Interest Only expiry', value: fmtDate(loan.io_expiry_date), sub: ioExpiryRemaining, subColor: ioExpiryRemaining === 'expired' ? '#c8332a' : '#9ca3af' }] : []),
                          ...(loan.rate_type === 'fixed' && loan.fixed_rate_expiry ? [{ label: 'Fixed expiry', value: fmtDate(loan.fixed_rate_expiry) }] : []),
                          { label: 'Maturity date', value: fmtDate(maturityStr) },
                        ]
                        const securities = loanSecurities.filter(ls => ls.loan_id === loan.id)
                        const totalSecurityValue = (() => {
                          let total = 0
                          securities.forEach(ls => { if (latestSecurityValuations[ls.property_id]) total += latestSecurityValuations[ls.property_id] })
                          if (loan.outside_security_value) total += Number(loan.outside_security_value)
                          return total > 0 ? total : null
                        })()
                        const realLvr = totalSecurityValue ? Math.round((loan.current_balance / totalSecurityValue) * 100) : null
                        return (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, padding: '14px 16px' }}>
                              {fields.map(f => (
                                <div key={f.label}>
                                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{f.label}</div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                                    {f.value}
                                    {'sub' in f && f.sub && <span style={{ fontSize: 11, fontWeight: 400, color: 'subColor' in f ? f.subColor : totalMonths <= 0 ? '#c8332a' : '#9ca3af', marginLeft: 5 }}>({f.sub})</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* Security row */}
                            <div style={{ padding: '0 16px 14px', borderTop: securities.length > 0 || loan.outside_security_description ? '1px solid #f0f2f7' : undefined, paddingTop: securities.length > 0 || loan.outside_security_description ? 12 : 0 }}>
                              {securities.length > 0 || loan.outside_security_description || loan.outside_security_value ? (
                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                  <span style={{ fontSize: 10, color: '#9ca3af', marginRight: 2, flexShrink: 0 }}>Security</span>
                                  {securities.map(ls => {
                                    const prop = userProperties.find(p => p.id === ls.property_id)
                                    return (
                                      <span key={ls.property_id} style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: '#eff6ff', color: BLUE, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        🏠 {prop?.name ?? ls.property_id.slice(0, 8)}
                                        {latestSecurityValuations[ls.property_id] && <span style={{ fontWeight: 400, color: '#5c8ce8' }}>· {formatCurrency(latestSecurityValuations[ls.property_id])}</span>}
                                      </span>
                                    )
                                  })}
                                  {loan.outside_security_description && (
                                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: '#f0f2f7', color: '#5c6478', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      🏘 {loan.outside_security_description}
                                      {loan.outside_security_value && <span style={{ fontWeight: 400 }}>· {formatCurrency(Number(loan.outside_security_value))}</span>}
                                    </span>
                                  )}
                                  {realLvr !== null && (
                                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, marginLeft: 4, background: realLvr > 80 ? '#fef2f2' : realLvr > 60 ? '#fffbeb' : '#dcfce7', color: realLvr > 80 ? '#c8332a' : realLvr > 60 ? '#92400e' : '#15803d' }}>
                                      LVR {realLvr}%
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <button onClick={() => !isReadOnly && openEditLoan(loan)} disabled={isReadOnly} style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', padding: 0, cursor: isReadOnly ? 'default' : 'pointer', textDecoration: isReadOnly ? 'none' : 'underline dotted', opacity: isReadOnly ? 0.4 : 1 }}>
                                  + Add security property
                                </button>
                              )}
                            </div>
                          </>
                        )
                      })()}

                      {/* Payout confirmation strip */}
                      {payoutLoanId === loan.id && (
                        <div style={{ padding: '12px 16px', background: '#f0fdf4', borderTop: '1px solid #86efac' }}>
                          <div style={{ fontSize: 12.5, color: '#166534', fontWeight: 600, marginBottom: 8 }}>
                            Mark {loan.lender}{loan.account_suffix ? ` · ${loan.account_suffix}` : ''} as paid out
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <label style={{ fontSize: 12, color: '#166534', whiteSpace: 'nowrap' }}>Payout date</label>
                            <input type="date" value={payoutDate} onChange={e => setPayoutDate(e.target.value)}
                              style={{ padding: '5px 9px', border: '1px solid #86efac', borderRadius: 7, fontSize: 12, color: '#1a1e2e', outline: 'none' }} />
                          </div>
                          {payoutError && <div style={{ fontSize: 12, color: '#c8332a', marginBottom: 6 }}>⚠ {payoutError}</div>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => { setPayoutLoanId(null); setPayoutError(null) }}
                              style={{ padding: '6px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                              Cancel
                            </button>
                            <button onClick={() => handlePayoutLoan(loan.id)} disabled={payoutSaving || !payoutDate}
                              style={{ padding: '6px 14px', background: '#15803d', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff', opacity: !payoutDate ? 0.5 : 1 }}>
                              {payoutSaving ? 'Saving…' : 'Confirm payout'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delete confirmation strip */}
                      {deleteLoanId === loan.id && (
                        <div style={{ padding: '12px 16px', background: '#fef2f2', borderTop: '1px solid #fca5a5' }}>
                          <div style={{ fontSize: 12.5, color: '#991b1b', fontWeight: 600, marginBottom: 8 }}>
                            Delete {loan.lender}{loan.account_suffix ? ` · ${loan.account_suffix}` : ''}? This will permanently remove the loan and all its transactions.
                          </div>
                          {deleteLoanError && <div style={{ fontSize: 12, color: '#c8332a', marginBottom: 6 }}>⚠ {deleteLoanError}</div>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => { setDeleteLoanId(null); setDeleteLoanError(null) }}
                              style={{ padding: '6px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                              Cancel
                            </button>
                            <button onClick={() => deleteLoan(loan.id)} disabled={deleteLoanSaving}
                              style={{ padding: '6px 14px', background: '#c8332a', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                              {deleteLoanSaving ? 'Deleting…' : 'Delete permanently'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {/* Closed loans */}
              {loans.filter(l => l.status === 'closed').length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => setShowClosedLoans(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: '4px 0', fontWeight: 600 }}>
                    <span>{showClosedLoans ? '▾' : '▸'}</span>
                    <span>Paid out loans ({loans.filter(l => l.status === 'closed').length})</span>
                  </button>
                  {showClosedLoans && loans.filter(l => l.status === 'closed').map(loan => {
                    const refinancedTo = loans.find(l => l.refinanced_from_loan_id === loan.id)
                    return (
                      <div key={loan.id} style={{ background: '#f9fafb', border: '1px solid #e4e7f0', borderRadius: 10, marginTop: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#5c6478' }}>{loan.lender}{loan.account_suffix ? ` · ${loan.account_suffix}` : ''}</span>
                            {refinancedTo
                              ? <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>
                                  Refinanced to {refinancedTo.lender}{refinancedTo.account_suffix ? ` · ${refinancedTo.account_suffix}` : ''}
                                </span>
                              : <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#e5e7eb', color: '#6b7280', fontWeight: 600 }}>PAID OUT</span>
                            }
                            {loan.closed_date && <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(loan.closed_date)}</span>}
                          </div>
                          <button onClick={() => openEditLoan(loan)}
                            style={{ background: 'none', border: 'none', fontSize: 11.5, color: '#9ca3af', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>
                            Details
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <button onClick={openRfWizardAdd} disabled={isReadOnly} style={{ padding: 9, background: '#fff', border: '1.5px dashed #e4e7f0', borderRadius: 12, fontSize: 12.5, color: isReadOnly ? '#d1d5db' : '#5c6478', cursor: isReadOnly ? 'default' : 'pointer' }}>
                  + Add Loan
                </button>
                <button
                  onClick={() => !isReadOnly && setShowUploadModal(true)}
                  disabled={isReadOnly}
                  style={{ padding: 9, background: '#fff', border: '1.5px dashed #e4e7f0', borderRadius: 12, fontSize: 12.5, color: isReadOnly ? '#d1d5db' : '#5c6478', cursor: isReadOnly ? 'default' : 'pointer' }}>
                  Upload Documents
                </button>
              </div>
            </div>

            {/* Valuation history */}
            <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Valuation History</h3>
                {!isReadOnly && <button onClick={openAddValuation} style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>+ Add Valuation</button>}
              </div>
              {valuations.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 12 }}>No valuations recorded yet.</div>
              ) : (
                valuations.map((v, i) => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #f5f7fa' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(v.valuation_date)}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{v.source || v.type.replace(/_/g, ' ')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(v.amount)}</div>
                        {i < valuations.length - 1 && (() => {
                          const pct = (v.amount - valuations[i + 1].amount) / valuations[i + 1].amount * 100
                          return (
                            <div style={{ fontSize: 11, color: pct >= 0 ? '#15803d' : '#dc2626', marginTop: 2 }}>
                              {pct >= 0 ? '+' : ''}{pct.toFixed(1)}% vs prior
                            </div>
                          )
                        })()}
                      </div>
                      {!isReadOnly && (
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <button onClick={() => setValKebabId(valKebabId === v.id ? null : v.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: '#9ca3af', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
                            ···
                          </button>
                          {valKebabId === v.id && (
                            <div style={{ position: 'absolute', right: 0, top: '100%', background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 50, minWidth: 110, overflow: 'hidden' }}>
                              <button onClick={() => { openEditValuation(v); setValKebabId(null) }}
                                style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 12.5, color: '#1a1e2e', cursor: 'pointer' }}>
                                Edit
                              </button>
                              <button onClick={() => { setDeleteValuationId(v.id); setValKebabId(null) }}
                                style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: 12.5, color: '#c8332a', cursor: 'pointer' }}>
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {!isReadOnly && (
                <button onClick={openAddValuation} style={{ width: '100%', padding: 9, background: '#fff', border: '1.5px dashed #e4e7f0', borderRadius: 12, fontSize: 12.5, color: '#5c6478', cursor: 'pointer', marginTop: 12 }}>
                  + Add Valuation
                </button>
              )}
            </div>

            {/* Cost Base card */}
            {!acqLoading && (() => {
              const isHnL = property.property_type === 'house_and_land'
              const contractAmt = isHnL ? (property.construction_contract_amount ?? 0) : 0
              const totalAcq = acquisitionCosts.reduce((s, c) => s + c.amount, 0)
              const totalCapEx = transactions.filter(tx => tx.type === 'capital_expense').reduce((s, tx) => s + Math.abs(tx.amount), 0)
              const totalDepr = depreciation.filter(d => d.financial_year <= currentFYInfo().label).reduce((s, d) => s + d.division_43_amount + d.plant_equipment_amount, 0)
              const avgRate = loans.length > 0 ? loans.reduce((s, l) => s + l.interest_rate, 0) / loans.length : 0
              const capResolved = (isHnL && property.capitalise_construction_interest)
                ? resolveCapitalisedInterest({
                    transactions: transactions.map(tx => ({ ...tx, capitalised: txCapitalised(tx) })),
                    progressPayments,
                    annualRatePct: avgRate,
                    landPrice: property.purchase_price ?? 0,
                    constructionStartDate: property.construction_start_date ?? null,
                    completionDate: property.construction_completion_date ?? null,
                  })
                : { actual: 0, estimated: 0, hasActual: false }
              // Only confirmed actual interest is included in the cost base
              const capInterest = capResolved.actual
              const propertySubtotal = (property.purchase_price ?? 0) + contractAmt
              const costBase = propertySubtotal + totalAcq + capInterest + totalCapEx - totalDepr

              const row = (label: string, value: string, sub?: boolean) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: sub ? 11.5 : 12.5, color: sub ? '#5c6478' : '#1a1e2e' }}>
                  <span style={{ color: '#5c6478' }}>{label}</span><span>{value}</span>
                </div>
              )
              const subtotalRow = (label: string, value: number) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, paddingTop: 5, borderTop: '1px solid #f0f2f7', marginTop: 1, color: '#374151' }}>
                  <span>{label}</span><span>{formatCurrency(value)}</span>
                </div>
              )
              const sectionLabel = (text: string) => (
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 10, marginBottom: 4 }}>{text}</div>
              )

              return (
                <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0 }}>Cost Base</h3>
                    {!isReadOnly && <button onClick={() => { setAcqForm(acquisitionCosts.map(c => ({ type: c.type, amount: String(c.amount), description: c.description ?? '' }))); setAcqError(null); setEditingAcqCosts(true) }}
                      style={{ padding: '5px 12px', background: BLUE, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Edit</button>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>

                    {/* Property */}
                    {sectionLabel(isHnL ? 'Property' : 'Property')}
                    {property.purchase_price != null
                      ? row(isHnL ? 'Land price' : 'Purchase price', formatCurrency(property.purchase_price))
                      : <div style={{ fontSize: 12, color: '#9ca3af' }}>No purchase price recorded.</div>}
                    {isHnL && contractAmt > 0 && row('Build contract', formatCurrency(contractAmt))}
                    {(isHnL && contractAmt > 0) && subtotalRow('Property total', propertySubtotal)}

                    {/* Acquisition */}
                    {sectionLabel('Acquisition')}
                    {acquisitionCosts.length > 0 ? (() => {
                      const named = acquisitionCosts.filter(c => c.type !== 'other')
                      const others = acquisitionCosts.filter(c => c.type === 'other')
                      const othersTotal = others.reduce((s, c) => s + c.amount, 0)
                      return (
                        <>
                          {named.map((c, i) => <div key={i}>{row(ACQ_LABELS[c.type], formatCurrency(c.amount))}</div>)}
                          {others.length > 0 && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, alignItems: 'center' }}>
                                <button onClick={() => setAcqOthersExpanded(v => !v)}
                                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#5c6478', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10, display: 'inline-block', transform: acqOthersExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
                                  Other{others.length > 1 ? ` (${others.length})` : ''}
                                </button>
                                <span style={{ fontSize: 12.5, color: '#1a1e2e' }}>{formatCurrency(othersTotal)}</span>
                              </div>
                              {acqOthersExpanded && others.map((c, i) => (
                                <div key={i} style={{ paddingLeft: 16 }}>
                                  {row(c.description || 'Other', formatCurrency(c.amount))}
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      )
                    })()
                      : <div style={{ fontSize: 11.5, color: '#9ca3af' }}>No acquisition costs recorded.</div>}
                    {acquisitionCosts.length > 0 && subtotalRow('Acquisition total', totalAcq)}

                    {/* Holding */}
                    {isHnL && (
                      <>
                        {sectionLabel('Holding')}
                        {property.capitalise_construction_interest ? (
                          capResolved.hasActual ? (() => {
                            const capTxs = transactions.filter(tx => txEffectiveCapitalised(tx))
                            const byType: Record<string, number> = {}
                            capTxs.forEach(tx => { byType[tx.type] = (byType[tx.type] ?? 0) + Math.abs(tx.amount) })
                            const TYPE_LABELS: Record<string, string> = {
                              interest_expense: 'Construction interest', council_rates: 'Council rates',
                              water_rates: 'Water rates', insurance: 'Insurance',
                              strata_body_corp: 'Strata / body corp', bank_fees: 'Bank fees',
                            }
                            return (
                              <>
                                {Object.entries(byType).map(([type, amt]) =>
                                  row(TYPE_LABELS[type] ?? type.replace(/_/g, ' '), formatCurrency(amt))
                                )}
                                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: -2 }}>
                                  From recorded transactions · click CAPITALISED badge on a transaction to exclude
                                </div>
                                {capResolved.estimated > 0 && capResolved.estimated !== capInterest && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                    <span>Interest estimate for comparison</span>
                                    <span>~{formatCurrency(capResolved.estimated)}</span>
                                  </div>
                                )}
                                {subtotalRow('Holding total', capInterest)}
                              </>
                            )
                          })() : (
                            <>
                              <div style={{ fontSize: 11.5, color: '#9ca3af' }}>
                                No holding cost transactions recorded — upload statements or add transactions manually.
                              </div>
                              {capResolved.estimated > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#9ca3af', marginTop: 6, padding: '7px 10px', background: '#f9fafb', borderRadius: 7, border: '1px dashed #e4e7f0' }}>
                                  <span>Interest estimate (not included in cost base)</span>
                                  <span>~{formatCurrency(capResolved.estimated)}</span>
                                </div>
                              )}
                              {avgRate === 0 && (
                                <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>No loans linked — add a loan to generate an estimate.</div>
                              )}
                            </>
                          )
                        ) : (
                          <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Holding costs not capitalised for this property.</div>
                        )}
                      </>
                    )}

                    {/* Capital works & depreciation */}
                    {(totalCapEx > 0 || totalDepr > 0) && (
                      <>
                        {sectionLabel('Adjustments')}
                        {totalCapEx > 0 && row('Capital improvements', `+ ${formatCurrency(totalCapEx)}`)}
                        {totalDepr > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                            <span style={{ color: '#5c6478' }}>Less: depreciation claimed</span>
                            <span style={{ color: '#c8332a' }}>− {formatCurrency(totalDepr)}</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Total */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, paddingTop: 10, marginTop: 6, borderTop: '2px solid #e4e7f0' }}>
                      <span>Adjusted cost base</span>
                      <span>{formatCurrency(costBase)}</span>
                    </div>

                    {displayValuation != null && (property.purchase_price != null || contractAmt > 0) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, paddingTop: 6, borderTop: '1px dashed #f0f2f7', marginTop: 2 }}>
                        <span style={{ color: '#5c6478' }}>
                          Unrealised capital gain
                          {isValuationFallback && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>(est.)</span>}
                        </span>
                        <span style={{ fontWeight: 700, color: displayValuation > costBase ? '#15803d' : '#c8332a' }}>
                          {displayValuation > costBase ? '+' : ''}{formatCurrency(displayValuation - costBase)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}


          </div>
        </div>
      )}

      {/* ══ TRANSACTIONS ══════════════════════════════════════════ */}
      {tab === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* Left 2/3: table + controls */}
          <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '20px 22px' }}>
            {/* Filter + action bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'nowrap' }}>
              <input
                placeholder="Search…"
                value={filterSearch}
                onChange={e => { setFilterSearch(e.target.value); setPage(1) }}
                style={{ padding: '7px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 12.5, width: 140, minWidth: 80, color: '#1a1e2e', outline: 'none', flexShrink: 1 }}
              />
              <select
                value={filterType}
                onChange={e => { setFilterType(e.target.value); setPage(1) }}
                style={{ padding: '7px 10px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 12.5, color: filterType ? '#1a1e2e' : '#9ca3af', background: '#fff', outline: 'none' }}>
                <option value="">All types</option>
                {typeOptions.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
              <select
                value={filterFY}
                onChange={e => { setFilterFY(e.target.value); setPage(1) }}
                style={{ padding: '7px 10px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 12.5, color: filterFY ? '#1a1e2e' : '#9ca3af', background: '#fff', outline: 'none' }}>
                <option value="">All years</option>
                {fyOptions.map(fy => <option key={fy} value={fy ?? ''}>{fy}</option>)}
              </select>
              {(filterSearch || filterType || filterFY) && (
                <button onClick={() => { setFilterSearch(''); setFilterType(''); setFilterFY('') }}
                  style={{ padding: '7px 10px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 12, color: '#5c6478', background: '#fff', cursor: 'pointer' }}>
                  Clear
                </button>
              )}
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                {duplicateGroups.length > 0 && (
                  <button onClick={openDupModal}
                    style={{ padding: '7px 13px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
                    ⚠ {duplicateGroups.length} duplicate{duplicateGroups.length !== 1 ? 's' : ''}
                  </button>
                )}
                <button onClick={() => { setSelectedLoanId(''); setShowUploadModal(true) }} disabled={uploading || isReadOnly}
                  style={{ padding: '7px 13px', background: (uploading || isReadOnly) ? '#f0f2f7' : '#fff', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 12, color: (uploading || isReadOnly) ? '#9ca3af' : '#5c6478', cursor: (uploading || isReadOnly) ? 'not-allowed' : 'pointer' }}>
                  {uploading ? 'Processing…' : 'Upload Documents'}
                </button>
                <button onClick={openAdd} disabled={isReadOnly} style={{ padding: '7px 13px', background: isReadOnly ? '#f0f2f7' : BLUE, color: isReadOnly ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: isReadOnly ? 'default' : 'pointer' }}>
                  + Add Transaction
                </button>
              </div>
            </div>
            {(filterSearch || filterType || filterFY) && (
              <div style={{ fontSize: 11.5, color: '#5c6478', marginBottom: 10 }}>
                Showing {visibleTransactions.length} of {transactions.length} transactions
              </div>
            )}

            {uploadResult && (
              <div style={{ padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13, background: 'error' in uploadResult ? '#fef2f2' : '#dcfce7', border: `1px solid ${'error' in uploadResult ? '#fca5a5' : '#86efac'}`, color: 'error' in uploadResult ? '#c8332a' : '#15803d' }}>
                {'error' in uploadResult
                ? `⚠ ${uploadResult.error}`
                : uploadResult.count === 0
                  ? `✓ No new transactions — ${uploadResult.skipped} duplicate${uploadResult.skipped !== 1 ? 's' : ''} skipped`
                  : `✓ ${uploadResult.count} transaction${uploadResult.count !== 1 ? 's' : ''} saved${uploadResult.skipped ? ` · ${uploadResult.skipped} duplicate${uploadResult.skipped !== 1 ? 's' : ''} skipped` : ''}`
              }
              </div>
            )}

            {transactions.length === 0 && !uploading && (
              <div onClick={() => { if (!isReadOnly) { setSelectedLoanId(''); setShowUploadModal(true) } }} style={{ border: '2px dashed #e4e7f0', borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: isReadOnly ? 'default' : 'pointer', marginBottom: 14, opacity: isReadOnly ? 0.4 : 1 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload a rental statement</p>
                <p style={{ fontSize: 12.5, color: '#9ca3af' }}>PDF or image · select multiple files · Claude extracts all transactions automatically</p>
              </div>
            )}

            {uploading && (
              <div style={{ border: '2px dashed #f7c925', borderRadius: 12, padding: '32px 24px', textAlign: 'center', marginBottom: 14, background: '#fffbeb' }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Reading your rental statement…</p>
                <p style={{ fontSize: 12.5, color: '#92400e' }}>Claude is extracting transactions — about 10–15 seconds</p>
              </div>
            )}

            {transactions.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {([
                      { label: 'Date', col: 'transaction_date', shrink: true },
                      { label: 'Type', col: 'type', shrink: true },
                      { label: 'Description', col: null, shrink: false },
                      { label: 'Amount', col: 'amount', shrink: true },
                    ] as { label: string; col: typeof sortCol | null; shrink: boolean }[]).map(({ label, col, shrink }) => (
                      <th key={label}
                        onClick={col ? () => toggleSort(col) : undefined}
                        style={{
                          textAlign: label === 'Amount' ? 'right' : 'left',
                          padding: '9px 12px', background: '#f9fafb', fontSize: 11, fontWeight: 700,
                          borderBottom: '1px solid #e4e7f0', textTransform: 'uppercase', letterSpacing: '.06em',
                          cursor: col ? 'pointer' : 'default',
                          color: col && sortCol === col ? BLUE : '#9ca3af',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                          width: shrink ? '1px' : 'auto',
                        }}>
                        {label}{col && sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                    <th style={{ padding: '7px 8px', background: '#f9fafb', borderBottom: '1px solid #e4e7f0', width: '1px', textAlign: 'center' }}>
                      <button
                        onClick={() => { if (!isReadOnly) { setDeleteMode(m => !m); if (deleteMode) setDeleteSelected(new Set()) } }}
                        title={deleteMode ? 'Exit delete mode' : 'Select rows to delete'}
                        disabled={isReadOnly}
                        style={{
                          background: isReadOnly ? '#f9fafb' : deleteMode ? '#c8332a' : '#f0f2f7',
                          border: 'none', cursor: isReadOnly ? 'default' : 'pointer', padding: '4px 6px',
                          borderRadius: 6, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 4,
                          color: isReadOnly ? '#d1d5db' : deleteMode ? '#fff' : '#5c6478', transition: '.15s',
                        }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="9" rx="1"/>
                        </svg>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em' }}>{deleteMode ? 'Done' : 'Delete'}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTransactions.map(tx => (
                    <tr key={tx.id} style={{ background: deleteSelected.has(tx.id) ? '#fff5f5' : undefined }}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f5f7fa', whiteSpace: 'nowrap' }}>
                        {tx.transaction_date} <span style={{ fontSize: 10.5, color: '#9ca3af' }}>({tx.financial_year})</span>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f5f7fa', whiteSpace: 'nowrap' }}>{TX_SHORT_LABELS[tx.type] ?? tx.type.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f5f7fa', color: '#5c6478', maxWidth: 180 }}>
                        <DelayedTooltip text={tx.description ?? tx.ownership_note ?? ''}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {tx.description ?? tx.ownership_note ?? '—'}
                            </span>
                            {tx.manually_edited && (
                              <span style={{
                                flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                                background: '#fffbeb', color: '#b45309',
                              }}>EDITED</span>
                            )}
                            {property.capitalise_construction_interest && txEffectiveCapitalised(tx) && (
                              <button onClick={() => toggleCapitalised(tx)} title="Click to exclude from cost base" style={{
                                flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                                background: '#fdf4ff', color: '#7e22ce', border: '1px solid #e9d5ff', cursor: 'pointer',
                              }}>CAPITALISED ×</button>
                            )}
                            {property.capitalise_construction_interest && !txEffectiveCapitalised(tx) && isAutoCapitalised(tx, property.construction_start_date ?? null, property.construction_completion_date ?? null) && (
                              <button onClick={() => toggleCapitalised(tx)} title="Click to re-include in cost base" style={{
                                flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                                background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', cursor: 'pointer',
                              }}>EXCLUDED</button>
                            )}
                            <span style={{
                              flexShrink: 0, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                              background: tx.source === 'manual' ? '#f0fdf4' : '#eff6ff',
                              color: tx.source === 'manual' ? '#15803d' : '#2563a8',
                            }}>
                              {tx.source === 'manual' ? 'MANUAL' : 'IMPORTED'}
                            </span>
                          </div>
                        </DelayedTooltip>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f5f7fa', textAlign: 'right', fontWeight: tx.type === 'principal_payment' ? 400 : 600, fontVariantNumeric: 'tabular-nums', color: tx.type === 'principal_payment' ? '#9ca3af' : tx.amount < 0 ? '#c8332a' : '#15803d' }}>
                        {tx.amount < 0 ? `(${formatCurrency(Math.abs(tx.amount))})` : formatCurrency(tx.amount)}
                      </td>
                      <td style={{ padding: '10px 8px', borderBottom: '1px solid #f5f7fa', width: '1px', textAlign: 'center' }}>
                        {deleteMode ? (
                          <button
                            onClick={() => toggleDeleteSelect(tx.id)}
                            title={deleteSelected.has(tx.id) ? 'Deselect' : 'Select for deletion'}
                            className="icon-btn"
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1, transition: '.1s',
                              color: deleteSelected.has(tx.id) ? '#c8332a' : '#9ca3af',
                            }}>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="9" rx="1"/>
                            </svg>
                          </button>
                        ) : (
                          <button onClick={() => !isReadOnly && openEdit(tx)} title="Edit transaction" className="icon-btn" disabled={isReadOnly}
                            style={{ background: 'none', border: 'none', cursor: isReadOnly ? 'default' : 'pointer', color: '#9ca3af', padding: '2px 4px', borderRadius: 4, lineHeight: 1, opacity: isReadOnly ? 0.35 : 1 }}>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 2l3 3-9 9H2v-3L11 2z"/>
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Delete selection bar */}
            {deleteMode && deleteSelected.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', margin: '8px 0 0', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
                <span style={{ fontSize: 12.5, color: '#991b1b', fontWeight: 600 }}>
                  {deleteSelected.size} transaction{deleteSelected.size !== 1 ? 's' : ''} selected
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setDeleteSelected(new Set())}
                    style={{ padding: '5px 12px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
                    Clear
                  </button>
                  <button onClick={initiateDelete}
                    style={{ padding: '5px 14px', background: '#c8332a', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                    Delete {deleteSelected.size}
                  </button>
                </div>
              </div>
            )}

            {/* Pagination */}
            {visibleTransactions.length > PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginTop: 4, borderTop: '1px solid #f5f7fa' }}>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleTransactions.length)} of {visibleTransactions.length}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    style={{ padding: '5px 12px', border: '1px solid #e4e7f0', borderRadius: 7, fontSize: 12, background: '#fff', color: page === 1 ? '#d1d5db' : '#1a1e2e', cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
                    ← Prev
                  </button>
                  <span style={{ padding: '5px 10px', fontSize: 12, color: '#5c6478' }}>Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    style={{ padding: '5px 12px', border: '1px solid #e4e7f0', borderRadius: 7, fontSize: 12, background: '#fff', color: page === totalPages ? '#d1d5db' : '#1a1e2e', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right 1/3: category pie chart */}
          <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '20px 22px' }}>
            <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: '0 0 10px' }}>Breakdown</h3>

            {/* Period selector */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
              {([
                { label: 'All', value: '' },
                { label: 'This month', value: 'month' },
                { label: '3 months', value: '3m' },
                { label: '6 months', value: '6m' },
                { label: 'This FY', value: 'fy' },
              ] as { label: string; value: typeof chartPeriod }[]).map(({ label, value }) => (
                <button key={label} onClick={() => setChartPeriod(value)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: chartPeriod === value ? BLUE : '#f0f2f7',
                    color: chartPeriod === value ? '#fff' : '#5c6478',
                    transition: '.12s',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Period label */}
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
              {filterFY ? filterFY
                : chartPeriod === 'month' ? new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
                : chartPeriod === '3m' ? 'Last 3 months'
                : chartPeriod === '6m' ? 'Last 6 months'
                : chartPeriod === 'fy' ? `FY${new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear()}`.replace(/20(\d\d)/, '$1')
                : chartTransactions.length === 0 ? 'No transactions'
                : (() => {
                    const dates = chartTransactions.map(tx => tx.transaction_date).sort()
                    const from = new Date(dates[0]).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
                    const to = new Date(dates[dates.length - 1]).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
                    return from === to ? from : `${from} – ${to}`
                  })()
              }
            </div>

            <TxPieChart transactions={chartTransactions} />
            <CashflowChart transactions={chartTransactions} />
          </div>
        </div>
      )}

      {/* ══ DEPRECIATION ══════════════════════════════════════════ */}
      {tab === 3 && (
        <div>
          <input ref={deprFileInputRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={handleDeprFileChange} />
          <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 4px' }}>Depreciation Schedule</h3>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>From your Quantity Surveyor report — Div 40 (plant &amp; equipment) and Div 43 (building works)</div>
              </div>
              {!isReadOnly && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => { setDeprParseError(null); deprFileInputRef.current?.click() }}
                    disabled={deprParsing}
                    style={{ padding: '8px 14px', background: deprParsing ? '#f0f2f7' : '#f0f2f7', color: deprParsing ? '#9ca3af' : '#374151', border: '1.5px solid #e4e7f0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: deprParsing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const }}>
                    {deprParsing ? (
                      <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Parsing…</>
                    ) : (
                      <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload QS Report</>
                    )}
                  </button>
                  <button
                    onClick={() => { setDeprGenForm({ div43_annual: '', div40_year1: '', div40_life: '10', schedule_start: property.settlement_date ?? property.purchase_date ?? '', source: '' }); setDeprGenOpen(true) }}
                    style={{ padding: '8px 14px', background: '#f0f2f7', color: '#374151', border: '1.5px solid #e4e7f0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/></svg>
                    Generate Schedule
                  </button>
                  <button
                    onClick={() => { setDeprEditing(null); setDeprForm({ financial_year: 'FY25', division_43: '', plant_equipment: '', source: '', notes: '' }); setDeprError(null); setDeprModalOpen(true) }}
                    style={{ padding: '8px 16px', background: NAVY, color: GOLD, border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                    + Add Year
                  </button>
                </div>
              )}
            </div>
            {deprParseError && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a', marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{deprParseError}</span>
                <button onClick={() => setDeprParseError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c8332a', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              {localDepreciation.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: '#9ca3af', fontSize: 13, background: '#f8fafc', borderRadius: 10, border: '1.5px dashed #e4e7f0' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <div style={{ fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>No depreciation schedule recorded</div>
                  <div style={{ fontSize: 12 }}>Add FY entries from your QS report to track Div 40 and Div 43 deductions.</div>
                </div>
              ) : (() => {
                const currentFY = currentFYInfo().label
                const sorted = [...localDepreciation].sort((a, b) => a.financial_year.localeCompare(b.financial_year))
                const pastRows = sorted.filter(d => d.financial_year < currentFY)
                const currentRows = sorted.filter(d => d.financial_year >= currentFY)
                const visibleRows = deprPastCollapsed ? currentRows : sorted
                const thStyle: React.CSSProperties = { fontWeight: 700, fontSize: 11, color: '#9ca3af', paddingBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }
                return (
                <>
                  {pastRows.length > 0 && (
                    <button
                      onClick={() => setDeprPastCollapsed(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, fontWeight: 600, padding: '0 0 12px', marginBottom: 2 }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: deprPastCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
                        <polyline points="4,6 8,10 12,6"/>
                      </svg>
                      {deprPastCollapsed ? `Show ${pastRows.length} past year${pastRows.length !== 1 ? 's' : ''}` : `Hide past years`}
                    </button>
                  )}
                  <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e4e7f0' }}>
                        <th style={{ ...thStyle, textAlign: 'left' }}>Year</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Plant &amp; Equip (Div 40)</th>
                        <th style={{ ...thStyle, textAlign: 'right', paddingLeft: 32 }}>Building (Div 43)</th>
                        <th style={{ ...thStyle, textAlign: 'right', paddingLeft: 32 }}>Total</th>
                        <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 20 }}>Source</th>
                        {!isReadOnly && (
                          <th style={{ width: '1px', textAlign: 'center', paddingBottom: 10 }}>
                            <button
                              onClick={() => { setDeprDeleteMode(m => !m); if (deprDeleteMode) setDeprSelected(new Set()) }}
                              title={deprDeleteMode ? 'Exit delete mode' : 'Select rows to delete'}
                              style={{ background: deprDeleteMode ? '#c8332a' : '#f0f2f7', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 4, color: deprDeleteMode ? '#fff' : '#5c6478', transition: '.15s' }}>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="9" rx="1"/></svg>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em' }}>{deprDeleteMode ? 'Done' : 'Delete'}</span>
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((d, i) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid #f0f2f7', background: deprSelected.has(d.id) ? '#fff5f5' : i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                          <td style={{ padding: '11px 0', fontWeight: 700, color: '#1a1e2e' }}>{d.financial_year}</td>
                          <td style={{ padding: '11px 0', textAlign: 'right', color: d.plant_equipment_amount > 0 ? '#c8332a' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                            {d.plant_equipment_amount > 0 ? `(${formatCurrency(d.plant_equipment_amount)})` : '—'}
                          </td>
                          <td style={{ padding: '11px 0', textAlign: 'right', paddingLeft: 32, color: d.division_43_amount > 0 ? '#c8332a' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                            {d.division_43_amount > 0 ? `(${formatCurrency(d.division_43_amount)})` : '—'}
                          </td>
                          <td style={{ padding: '11px 0', textAlign: 'right', paddingLeft: 32, fontWeight: 700, color: '#c8332a', fontVariantNumeric: 'tabular-nums' }}>
                            ({formatCurrency(d.plant_equipment_amount + d.division_43_amount)})
                          </td>
                          <td style={{ padding: '11px 0 11px 20px', color: '#5c6478', fontSize: 12 }}>{d.source ?? '—'}</td>
                          {!isReadOnly && (
                            <td style={{ padding: '10px 8px', textAlign: 'center' as const, width: '1px' }}>
                              {deprDeleteMode ? (
                                <button
                                  onClick={() => setDeprSelected(prev => { const next = new Set(prev); deprSelected.has(d.id) ? next.delete(d.id) : next.add(d.id); return next })}
                                  title={deprSelected.has(d.id) ? 'Deselect' : 'Select for deletion'}
                                  className="icon-btn"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1, transition: '.1s', color: deprSelected.has(d.id) ? '#c8332a' : '#9ca3af' }}>
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="9" rx="1"/></svg>
                                </button>
                              ) : (
                                <button
                                  onClick={() => { setDeprEditing(d); setDeprForm({ financial_year: d.financial_year, division_43: String(d.division_43_amount), plant_equipment: String(d.plant_equipment_amount), source: d.source ?? '', notes: d.notes ?? '' }); setDeprError(null); setDeprModalOpen(true) }}
                                  title="Edit" className="icon-btn"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}>
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {localDepreciation.length > 1 && (
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #e4e7f0' }}>
                          <td style={{ padding: '11px 0', fontWeight: 800, color: '#1a1e2e' }}>Cumulative total</td>
                          <td style={{ padding: '11px 0', textAlign: 'right', fontWeight: 700, color: '#c8332a', fontVariantNumeric: 'tabular-nums' }}>
                            ({formatCurrency(localDepreciation.reduce((s, d) => s + d.plant_equipment_amount, 0))})
                          </td>
                          <td style={{ padding: '11px 0', textAlign: 'right', paddingLeft: 32, fontWeight: 700, color: '#c8332a', fontVariantNumeric: 'tabular-nums' }}>
                            ({formatCurrency(localDepreciation.reduce((s, d) => s + d.division_43_amount, 0))})
                          </td>
                          <td style={{ padding: '11px 0', textAlign: 'right', paddingLeft: 32, fontWeight: 800, fontSize: 13.5, color: '#c8332a', fontVariantNumeric: 'tabular-nums' }}>
                            ({formatCurrency(localDepreciation.reduce((s, d) => s + d.plant_equipment_amount + d.division_43_amount, 0))})
                          </td>
                          <td colSpan={isReadOnly ? 1 : 2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>

                  <div style={{ marginTop: 16, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                    <strong>Cost base note:</strong> Cumulative depreciation claimed reduces your adjusted cost base, which increases capital gains tax exposure at sale. This is reflected automatically in the Finance tab cost base calculation.
                  </div>
                </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Depreciation Delete Bar (fixed bottom) ──────────────── */}
      {deprDeleteMode && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200, background: '#fef2f2', borderTop: '1.5px solid #fca5a5', boxShadow: '0 -4px 16px rgba(200,51,42,.12)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#991b1b', fontWeight: 700 }}>
            {deprSelected.size > 0 ? `${deprSelected.size} of ${localDepreciation.length} year${localDepreciation.length !== 1 ? 's' : ''} selected` : `Select years to delete`}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {deprSelected.size < localDepreciation.length ? (
              <button
                onClick={() => setDeprSelected(new Set(localDepreciation.map(d => d.id)))}
                style={{ padding: '6px 14px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
                Select all {localDepreciation.length}
              </button>
            ) : (
              <button
                onClick={() => setDeprSelected(new Set())}
                style={{ padding: '6px 14px', background: '#fff', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
                Clear
              </button>
            )}
            <button
              onClick={() => { setDeprDeleteMode(false); setDeprSelected(new Set()) }}
              style={{ padding: '6px 14px', background: '#fff', border: '1px solid #e4e7f0', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
              Cancel
            </button>
            {deprSelected.size > 0 && (
              <button onClick={handleDeprBulkDelete} disabled={deprBulkDeleting}
                style={{ padding: '6px 16px', background: '#c8332a', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#fff', cursor: deprBulkDeleting ? 'not-allowed' : 'pointer' }}>
                {deprBulkDeleting ? 'Deleting…' : `Delete ${deprSelected.size}`}
              </button>
            )}
            <button
              onClick={async () => {
                if (!confirm(`Delete all ${localDepreciation.length} depreciation year${localDepreciation.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
                setDeprBulkDeleting(true)
                try {
                  await Promise.all(localDepreciation.map(d => fetch(`/api/depreciation?id=${d.id}`, { method: 'DELETE' })))
                  setLocalDepreciation([])
                  setDeprSelected(new Set())
                  setDeprDeleteMode(false)
                } catch { alert('Delete failed') }
                finally { setDeprBulkDeleting(false) }
              }}
              disabled={deprBulkDeleting || localDepreciation.length === 0}
              style={{ padding: '6px 16px', background: localDepreciation.length === 0 ? '#f0f2f7' : '#7f1d1d', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, color: localDepreciation.length === 0 ? '#9ca3af' : '#fff', cursor: deprBulkDeleting || localDepreciation.length === 0 ? 'not-allowed' : 'pointer' }}>
              Delete all {localDepreciation.length}
            </button>
          </div>
        </div>
      )}

      {/* ── Add / Edit Transaction Modal ────────────────────────── */}
      {(editingTx || addingTx) && (() => {
        const isAdd = addingTx && !editingTx
        const close = () => { setEditingTx(null); setAddingTx(false); setEditError(null) }
        const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' }
        const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        const activeLoans = loans.filter(l => l.status === 'active')
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) close() }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{isAdd ? 'Add Transaction' : 'Edit Transaction'}</h2>
                <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>

              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Date + Type row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Date</label>
                    <input type="date" value={editForm.transaction_date} onChange={e => setEditForm(f => ({ ...f, transaction_date: e.target.value }))} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                      style={{ ...inputStyle, background: '#fff' }}>
                      {Object.entries(TX_SHORT_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Amount */}
                <div>
                  <label style={labelStyle}>Amount <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 11, color: '#9ca3af' }}>(negative = expense)</span></label>
                  <input type="number" step="0.01" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="e.g. 1200 or -79.20" />
                </div>
                {/* Description */}
                <div>
                  <label style={labelStyle}>Description <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 11, color: '#9ca3af' }}>(optional)</span></label>
                  <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Rent – June 2025"
                    style={inputStyle} />
                </div>
                {/* Loan (optional — only for loan-related types) */}
                {activeLoans.length > 0 && ['interest_expense', 'principal_payment', 'bank_fees'].includes(editForm.type) && (
                  <div>
                    <label style={labelStyle}>Loan <span style={{ color: '#c8332a' }}>*</span></label>
                    <select value={editForm.loan_id} onChange={e => setEditForm(f => ({ ...f, loan_id: e.target.value }))}
                      style={{ ...inputStyle, background: '#fff' }}>
                      <option value="">— None —</option>
                      {activeLoans.map(l => (
                        <option key={l.id} value={l.id}>{l.lender}{l.account_suffix ? ` · ${l.account_suffix}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}

                {editError && (
                  <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {editError}</div>
                )}
              </div>

              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                {!isAdd
                  ? <button onClick={deleteFromEdit} disabled={editSaving}
                      style={{ padding: '9px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#c8332a', cursor: 'pointer' }}>
                      Delete
                    </button>
                  : <div />
                }
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={close} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                    Cancel
                  </button>
                  <button onClick={isAdd ? saveAdd : saveEdit} disabled={editSaving}
                    style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {editSaving ? 'Saving…' : isAdd ? 'Add' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Delete Confirmation Modal ──────────────────────────── */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.25)', padding: '28px 28px 24px' }}>
            <div style={{ width: 44, height: 44, background: '#fef2f2', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#c8332a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3,4 13,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M6 7v5M10 7v5"/><rect x="4" y="4" width="8" height="9" rx="1"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 8px' }}>Delete {deleteSelected.size} transaction{deleteSelected.size !== 1 ? 's' : ''}?</h2>
            <p style={{ fontSize: 13, color: '#5c6478', margin: '0 0 20px', lineHeight: 1.5 }}>
              You'll have 10 seconds to undo after confirming.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)}
                style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                Cancel
              </button>
              <button onClick={confirmDelete}
                style={{ padding: '9px 18px', background: '#c8332a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Countdown Undo Toast ────────────────────────────────── */}
      {pendingDelete && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, background: '#1a1e2e', color: '#fff', borderRadius: 12, padding: '14px 20px', boxShadow: '0 8px 32px rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: 20, minWidth: 340 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Deleting {pendingDelete.ids.length} transaction{pendingDelete.ids.length !== 1 ? 's' : ''} in {pendingDelete.countdown}s…
            </div>
            {/* Progress bar */}
            <div style={{ height: 3, background: 'rgba(255,255,255,.15)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#f7c925', borderRadius: 2, width: `${(pendingDelete.countdown / 10) * 100}%`, transition: 'width 1s linear' }} />
            </div>
          </div>
          <button
            onClick={() => setPendingDelete(null)}
            style={{ padding: '7px 16px', background: '#f7c925', color: '#1a1200', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
            Undo
          </button>
        </div>
      )}

      {/* ── Upload Modal ───────────────────────────────────────── */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowUploadModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 960, boxShadow: '0 20px 60px rgba(0,0,0,.28)' }}>

            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 2px' }}>Upload Document</h2>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>Rental &amp; expense documents go to Transactions · Loan statements also update the Finance tab</p>
              </div>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>

            {/* Three-column drop zones */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>

              {/* Rental Statement */}
              <div style={{ padding: '20px 24px 24px', borderRight: '1px solid #e4e7f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Rental Statement</div>
                <div
                  onDragOver={e => { e.preventDefault(); setRentalDragActive(true) }}
                  onDragEnter={e => { e.preventDefault(); setRentalDragActive(true) }}
                  onDragLeave={() => setRentalDragActive(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setRentalDragActive(false)
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) processRentalFiles(files)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${rentalDragActive ? BLUE : '#e4e7f0'}`,
                    borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                    background: rentalDragActive ? '#eff6ff' : '#fafafa',
                    transition: '.15s',
                  }}>
                  {uploading ? (
                    <>
                      <div style={{ width: 32, height: 32, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 12px' }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>Reading statement…</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>This may take a few seconds</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>
                        {rentalDragActive ? 'Drop to upload' : 'Drop files here'}
                      </div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>PDF or image · multiple files OK</div>
                      <span style={{ fontSize: 11.5, color: BLUE, fontWeight: 600 }}>or click to browse</span>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: '#9ca3af' }}>
                  Extracts rent income, management fees, repairs, and other property expenses.
                </div>
              </div>

              {/* Loan Statement */}
              <div style={{ padding: '20px 24px 24px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Loan Statement</div>
                <div
                  onDragOver={e => { e.preventDefault(); setLoanDragActive(true) }}
                  onDragEnter={e => { e.preventDefault(); setLoanDragActive(true) }}
                  onDragLeave={() => setLoanDragActive(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setLoanDragActive(false)
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length === 0) return
                    if (files.length > 1) {
                      setLoanStatementQueue(files.slice(1).map(f => ({ file: f, loanId: '' })))
                    }
                    processLoanFile(files[0])
                  }}
                  onClick={() => loanFileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${loanDragActive ? BLUE : '#e4e7f0'}`,
                    borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                    background: loanDragActive ? '#eff6ff' : '#fafafa',
                    transition: '.15s',
                  }}>
                  {loanProcessing ? (
                    <>
                      <div style={{ width: 32, height: 32, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 12px' }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>Reading statement…</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>This may take a few seconds</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>🏦</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>
                        {loanDragActive ? 'Drop to upload' : 'Drop files here'}
                      </div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>PDF or image · multiple files OK</div>
                      <span style={{ fontSize: 11.5, color: BLUE, fontWeight: 600 }}>or click to browse</span>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: '#9ca3af' }}>
                  Loan matched automatically from statement. Updates balance and imports transactions.
                </div>
              </div>

              {/* Expense Document */}
              <div style={{ padding: '20px 24px 24px', borderLeft: '1px solid #e4e7f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Expense Document</div>
                <div
                  onDragOver={e => { e.preventDefault(); setExpenseDragActive(true) }}
                  onDragEnter={e => { e.preventDefault(); setExpenseDragActive(true) }}
                  onDragLeave={() => setExpenseDragActive(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setExpenseDragActive(false)
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) processExpenseFiles(files)
                  }}
                  onClick={() => expenseFileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${expenseDragActive ? BLUE : '#e4e7f0'}`,
                    borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
                    background: expenseDragActive ? '#eff6ff' : '#fafafa',
                    transition: '.15s',
                  }}>
                  {expenseProcessing ? (
                    <>
                      <div style={{ width: 32, height: 32, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 12px' }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>Reading document…</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>This may take a few seconds</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>🧾</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}>
                        {expenseDragActive ? 'Drop to upload' : 'Drop files here'}
                      </div>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>PDF or image · multiple files OK</div>
                      <span style={{ fontSize: 11.5, color: BLUE, fontWeight: 600 }}>or click to browse</span>
                    </>
                  )}
                </div>
                {expenseUploadError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#c8332a' }}>⚠ {expenseUploadError}</div>
                )}
                <div style={{ marginTop: 10, fontSize: 11.5, color: '#9ca3af' }}>
                  Extracts expense transactions. Insurance documents also update policy details.
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Import Review Modal ────────────────────────────────── */}
      {pendingImport && (() => {
        const activeRows = pendingImport.rows.filter(r => !r.removed)
        const dupCount = activeRows.filter(r => r.duplicate).length
        const removedCount = pendingImport.rows.filter(r => r.removed).length
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setPendingImport(null) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.28)', position: 'relative', overflow: 'hidden' }}>
              {importSaving && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <div style={{ width: 36, height: 36, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1e2e' }}>Saving transactions…</span>
                </div>
              )}

              {/* Header */}
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Review Transactions</h2>
                    <p style={{ fontSize: 12, color: '#5c6478', margin: 0 }}>
                      {pendingImport.rows.length} extracted · {activeRows.length} selected for import
                      {dupCount > 0 && <span style={{ color: '#92400e' }}> · {dupCount} possible duplicate{dupCount !== 1 ? 's' : ''}</span>}
                      {removedCount > 0 && <span style={{ color: '#9ca3af' }}> · {removedCount} removed</span>}
                    </p>
                  </div>
                  <button onClick={() => setPendingImport(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
                </div>
                {dupCount > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                    ⚠ Possible duplicates are highlighted — they may already exist in your transactions. Review before importing.
                  </div>
                )}
                {pendingImport.insuranceMeta && !pendingImport.applyInsurance && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12.5, color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span>Insurance details detected — update policy fields on the Overview tab?</span>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setPendingImport(p => p ? { ...p, insuranceMeta: null } : null)}
                        style={{ padding: '4px 10px', background: 'none', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#92400e' }}>
                        Ignore
                      </button>
                      <button onClick={() => setPendingImport(p => p ? { ...p, applyInsurance: true } : null)}
                        style={{ padding: '4px 10px', background: '#f59e0b', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                        Yes, update
                      </button>
                    </div>
                  </div>
                )}
                {pendingImport.applyInsurance && pendingImport.insuranceMeta && (
                  <div style={{ marginTop: 10, padding: '8px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 12.5, color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Insurance fields will update on confirm.</span>
                    <button onClick={() => setPendingImport(p => p ? { ...p, applyInsurance: false } : null)}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: '#15803d', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Undo
                    </button>
                  </div>
                )}
                {pendingImport.pmMeta && !pendingImport.applyPM && (() => {
                  const m = pendingImport.pmMeta!
                  const changed = (
                    (m.agency != null && m.agency !== property.pm_agency) ||
                    (m.name != null && m.name !== property.pm_name) ||
                    (m.phone != null && m.phone !== property.pm_phone) ||
                    (m.email != null && m.email !== property.pm_email) ||
                    (m.fee_percent != null && m.fee_percent !== property.pm_fee_percent)
                  )
                  return changed
                })() && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12.5, color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span>Property manager detected{pendingImport.pmMeta.agency ? `: ${pendingImport.pmMeta.agency}` : ''} — update PM details on the Overview tab?</span>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setPendingImport(p => p ? { ...p, pmMeta: null } : null)}
                        style={{ padding: '4px 10px', background: 'none', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#92400e' }}>
                        Ignore
                      </button>
                      <button onClick={() => setPendingImport(p => p ? { ...p, applyPM: true } : null)}
                        style={{ padding: '4px 10px', background: '#f59e0b', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                        Yes, update
                      </button>
                    </div>
                  </div>
                )}
                {pendingImport.applyPM && pendingImport.pmMeta && (
                  <div style={{ marginTop: 10, padding: '8px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 12.5, color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Property manager fields will update on confirm.</span>
                    <button onClick={() => setPendingImport(p => p ? { ...p, applyPM: false } : null)}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: '#15803d', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Undo
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable table */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
                    <tr>
                      {['Date', 'Type', 'Description', 'Amount', ''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #e4e7f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendingImport.rows.map((row, i) => (
                      <tr key={i} style={{ background: row.removed ? '#f9fafb' : row.duplicate ? '#fffbeb' : '#fff', opacity: row.removed ? 0.5 : 1 }}>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f5f7fa', whiteSpace: 'nowrap', color: '#5c6478' }}>
                          {row.transaction_date}
                          {row.duplicate && !row.removed && (
                            <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: '#fef3c7', color: '#92400e' }}>DUP</span>
                          )}
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f5f7fa' }}>
                          {row.removed ? (
                            <span style={{ color: '#9ca3af', fontSize: 12 }}>{TX_SHORT_LABELS[row.type] ?? row.type.replace(/_/g, ' ')}</span>
                          ) : (
                            <select
                              value={row.type}
                              onChange={e => updateImportRowType(i, e.target.value)}
                              style={{ padding: '3px 6px', border: '1px solid #e4e7f0', borderRadius: 6, fontSize: 12, color: '#1a1e2e', background: '#fff', outline: 'none' }}>
                              {Object.entries(TX_SHORT_LABELS).map(([v, label]) => (
                                <option key={v} value={v}>{label}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f5f7fa', color: '#5c6478', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.description ?? '—'}
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f5f7fa', textAlign: 'right', fontWeight: row.type === 'principal_payment' ? 400 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: row.type === 'principal_payment' ? '#9ca3af' : row.amount < 0 ? '#c8332a' : '#15803d' }}>
                          {row.amount < 0 ? `(${formatCurrency(Math.abs(row.amount))})` : formatCurrency(row.amount)}
                        </td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #f5f7fa', width: '1px' }}>
                          {row.removed ? (
                            <button onClick={() => restoreImportRow(i)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2563a8', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                              Restore
                            </button>
                          ) : (
                            <button onClick={() => removeImportRow(i)} title="Remove from import"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 6px', borderRadius: 4, fontSize: 14, lineHeight: 1 }}>
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid #e4e7f0', flexShrink: 0 }}>
                {importError && (
                  <div style={{ marginBottom: 12, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>
                    ⚠ {importError}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button onClick={() => setPendingImport(null)}
                    style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                    Cancel
                  </button>
                  <button
                    onClick={confirmImport}
                    disabled={activeRows.length === 0 || importSaving}
                    style={{ padding: '9px 20px', background: activeRows.length === 0 ? '#f0f2f7' : BLUE, color: activeRows.length === 0 ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: activeRows.length === 0 ? 'not-allowed' : 'pointer' }}>
                    {importSaving ? 'Importing…' : `Import ${activeRows.length} transaction${activeRows.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Duplicate Review Modal ──────────────────────────────── */}
      {showDupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDupModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Duplicate Transactions</h2>
                <p style={{ fontSize: 12, color: '#5c6478', margin: '4px 0 0' }}>
                  {duplicateGroups.length} group{duplicateGroups.length !== 1 ? 's' : ''} found · {selectedForDelete.size} selected for deletion
                </p>
              </div>
              <button onClick={() => setShowDupModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 24px' }}>
              {duplicateGroups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
                  No duplicates found — your transactions look clean.
                </div>
              ) : duplicateGroups.map((group, gi) => (
                <div key={gi} style={{ marginBottom: 14, border: '1px solid #e4e7f0', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', background: '#fef3c7', fontSize: 11, fontWeight: 700, color: '#92400e' }}>
                    {group[0].transaction_date} · {group[0].type.replace(/_/g, ' ')} · {formatCurrency(Math.abs(group[0].amount))} — {group.length} occurrences
                  </div>
                  {group.map((tx, ti) => (
                    <label key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: ti > 0 ? '1px solid #f5f7fa' : undefined, cursor: 'pointer', background: selectedForDelete.has(tx.id) ? '#fef2f2' : '#fff' }}>
                      <input
                        type="checkbox"
                        checked={selectedForDelete.has(tx.id)}
                        onChange={e => {
                          const next = new Set(selectedForDelete)
                          if (e.target.checked) next.add(tx.id)
                          else next.delete(tx.id)
                          setSelectedForDelete(next)
                        }}
                        style={{ width: 15, height: 15, accentColor: '#c8332a', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: '#1a1e2e', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description ?? '—'}</span>
                          {ti === 0 && !selectedForDelete.has(tx.id) && (
                            <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '1px 7px', borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>KEEP</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>ID …{tx.id.slice(-8)} · {tx.financial_year}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: tx.type === 'principal_payment' ? 400 : 700, fontVariantNumeric: 'tabular-nums', color: tx.type === 'principal_payment' ? '#9ca3af' : tx.amount < 0 ? '#c8332a' : '#15803d', flexShrink: 0 }}>
                        {tx.amount < 0 ? `(${formatCurrency(Math.abs(tx.amount))})` : formatCurrency(tx.amount)}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #e4e7f0', flexShrink: 0 }}>
              {deleteError && (
                <div style={{ marginBottom: 12, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>
                  ⚠ {deleteError}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => setShowDupModal(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                Cancel
              </button>
              <button
                onClick={confirmDeleteDuplicates}
                disabled={selectedForDelete.size === 0 || deleting}
                style={{ padding: '9px 18px', background: selectedForDelete.size === 0 ? '#f0f2f7' : '#c8332a', color: selectedForDelete.size === 0 ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: selectedForDelete.size === 0 ? 'not-allowed' : 'pointer', transition: '.15s' }}>
                {deleting ? 'Deleting…' : `Delete ${selectedForDelete.size} transaction${selectedForDelete.size !== 1 ? 's' : ''}`}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Queue processing interim overlay ───────────────────── */}
      {loanProcessing && !showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '36px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ width: 36, height: 36, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1e2e' }}>Reading next statement…</span>
            {loanStatementQueue.length > 0 && (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>{loanStatementQueue.length} remaining after this</span>
            )}
          </div>
        </div>
      )}

      {/* ── Loan Statement Review Modal ─────────────────────────── */}
      {loanStatementPreview && (() => {
        const activeRows = loanStatementPreview.rows.filter(r => !r.removed)
        const dupCount = activeRows.filter(r => r.duplicate).length
        const p = loanStatementPreview
        const statementLoan = loans.find(l => l.id === p.loanId)
        const rateChanged = p.detectedRate != null && !p.applyRate && statementLoan?.interest_rate != null && Math.abs(p.detectedRate - statementLoan.interest_rate) >= 0.005
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setLoanStatementPreview(null) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.28)', position: 'relative', overflow: 'hidden' }}>
              {loanStatementSaving && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <div style={{ width: 36, height: 36, border: `3px solid #e4e7f0`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1e2e' }}>Updating balance…</span>
                </div>
              )}

              {/* Header */}
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Review Loan Statement</h2>
                      {loanStatementQueue.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#e0e7ff', color: '#3730a3' }}>
                          {loanStatementQueue.length} more after this
                        </span>
                      )}
                    </div>
                    {p.loanId
                      ? <p style={{ fontSize: 12, color: '#5c6478', margin: '2px 0 0' }}>{p.loanLabel}</p>
                      : <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                              No match — {p.newLoanForm?.lender || 'unknown lender'}{p.newLoanForm?.account_suffix ? ` · ${p.newLoanForm.account_suffix}` : ''}
                            </span>
                            <button onClick={() => setLoanStatementPreview(prev => prev ? { ...prev, createMode: true } : null)}
                              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none', background: p.createMode ? BLUE : '#e0e7ff', color: p.createMode ? '#fff' : BLUE }}>
                              Create new loan
                            </button>
                            <button onClick={() => setLoanStatementPreview(prev => prev ? { ...prev, createMode: false } : null)}
                              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none', background: !p.createMode ? '#374151' : '#e4e7f0', color: !p.createMode ? '#fff' : '#5c6478' }}>
                              Assign to existing
                            </button>
                          </div>
                          {!p.createMode && (
                            <select
                              value={p.loanId}
                              onChange={e => {
                                const l = loans.find(l => l.id === e.target.value)
                                setLoanStatementPreview(prev => prev ? { ...prev, loanId: e.target.value, loanLabel: l ? `${l.lender}${l.account_suffix ? ` · ${l.account_suffix}` : ''}` : '' } : null)
                              }}
                              style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, color: '#1a1e2e', background: '#fff', outline: 'none' }}>
                              <option value="">— Select loan —</option>
                              {loans.filter(l => l.status !== 'closed').map(l => <option key={l.id} value={l.id}>{l.lender}{l.account_suffix ? ` · ${l.account_suffix}` : ''}</option>)}
                            </select>
                          )}
                          {p.createMode && p.newLoanForm && (
                            <div style={{ background: '#f8faff', border: '1px solid #dbeafe', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Lender *</label>
                                  <input value={p.newLoanForm.lender} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, lender: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Account suffix</label>
                                  <input value={p.newLoanForm.account_suffix} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, account_suffix: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Loan limit ($)</label>
                                  <input type="number" step="1000" value={p.newLoanForm.loan_limit} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, loan_limit: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Rate (%)</label>
                                  <input type="number" step="0.01" value={p.newLoanForm.interest_rate} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, interest_rate: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Term (yrs)</label>
                                  <input type="number" step="1" value={p.newLoanForm.loan_term_years} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, loan_term_years: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Repayment</label>
                                  <select value={p.newLoanForm.repayment_type} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, repayment_type: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, outline: 'none', background: '#fff' }}>
                                    <option value="principal_and_interest">P&amp;I</option>
                                    <option value="interest_only">IO</option>
                                    <option value="interest_in_advance">IO Advance</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Rate type</label>
                                  <select value={p.newLoanForm.rate_type} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, rate_type: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, outline: 'none', background: '#fff' }}>
                                    <option value="variable">Variable</option>
                                    <option value="fixed">Fixed</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Start date</label>
                                  <input type="date" value={p.newLoanForm.start_date} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, start_date: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', outline: 'none' }} />
                                </div>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Purpose</label>
                                  <select value={p.newLoanForm.purpose} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, purpose: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, outline: 'none', background: '#fff' }}>
                                    <option value="investment">Investment</option>
                                    <option value="owner_occupied">Owner-occupied</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#5c6478', marginBottom: 3 }}>Refinances</label>
                                  <select value={p.newLoanForm.refinanced_from_loan_id} onChange={e => setLoanStatementPreview(prev => prev && prev.newLoanForm ? { ...prev, newLoanForm: { ...prev.newLoanForm, refinanced_from_loan_id: e.target.value } } : prev)}
                                    style={{ width: '100%', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, outline: 'none', background: '#fff' }}>
                                    <option value="">— None —</option>
                                    {loans.map(l => <option key={l.id} value={l.id}>{l.lender}{l.account_suffix ? ` · ${l.account_suffix}` : ''}</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                    }
                  </div>
                  <button onClick={() => setLoanStatementPreview(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
                </div>
                {/* Extracted balance — editable */}
                <div style={{ marginTop: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Closing balance ($)</div>
                    <input
                      type="number"
                      step="0.01"
                      value={p.balance}
                      onChange={e => setLoanStatementPreview(prev => prev ? { ...prev, balance: Number(e.target.value) } : null)}
                      style={{ padding: '7px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 14, fontWeight: 700, width: 180, outline: 'none' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>As at date</div>
                    <input
                      type="date"
                      value={p.balanceDate}
                      onChange={e => setLoanStatementPreview(prev => prev ? { ...prev, balanceDate: e.target.value } : null)}
                      style={{ padding: '7px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, outline: 'none' }}
                    />
                  </div>
                  <div style={{ fontSize: 11.5, color: '#9ca3af', paddingBottom: 8 }}>Balance updates the loan card on the Finance tab.</div>
                </div>
                {rateChanged && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12.5, color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span>Rate on statement: <strong>{p.detectedRate}%</strong> — current loan rate is <strong>{statementLoan?.interest_rate}%</strong>. Update the loan rate?</span>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setLoanStatementPreview(prev => prev ? { ...prev, detectedRate: null } : null)}
                        style={{ padding: '4px 10px', background: 'none', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#92400e' }}>
                        Ignore
                      </button>
                      <button onClick={() => setLoanStatementPreview(prev => prev ? { ...prev, applyRate: true } : null)}
                        style={{ padding: '4px 10px', background: '#f59e0b', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                        Yes, update to {p.detectedRate}%
                      </button>
                    </div>
                  </div>
                )}
                {p.applyRate && p.detectedRate != null && (
                  <div style={{ marginTop: 12, padding: '8px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 12.5, color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Rate will update to <strong>{p.detectedRate}%</strong> on confirm.</span>
                    <button onClick={() => setLoanStatementPreview(prev => prev ? { ...prev, applyRate: false } : null)}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: '#15803d', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Undo
                    </button>
                  </div>
                )}
                {p.loanId && p.balance <= 500 && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12.5, color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span>Final balance is <strong>{formatCurrency(p.balance)}</strong> — looks like a payout statement.</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
                      <input type="checkbox" checked={p.markClosed} onChange={e => setLoanStatementPreview(prev => prev ? { ...prev, markClosed: e.target.checked } : null)} />
                      Mark as paid out
                    </label>
                  </div>
                )}
              </div>

              {/* Transactions table */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {p.rows.length === 0 ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No transactions found in this statement.</div>
                ) : (
                  <>
                    <div style={{ padding: '12px 16px 4px', fontSize: 11.5, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      Transactions — {p.rows.length} extracted · {activeRows.length} selected
                      {dupCount > 0 && <span style={{ color: '#92400e', marginLeft: 8 }}>{dupCount} possible duplicate{dupCount !== 1 ? 's' : ''}</span>}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
                        <tr>
                          {['Date', 'Type', 'Description', 'Amount', ''].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #e4e7f0', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.rows.map((row, i) => (
                          <tr key={i} style={{ background: row.removed ? '#f9fafb' : row.duplicate ? '#fffbeb' : '#fff', opacity: row.removed ? 0.5 : 1 }}>
                            <td style={{ padding: '8px 14px', borderBottom: '1px solid #f5f7fa', whiteSpace: 'nowrap', color: '#5c6478' }}>
                              {row.transaction_date}
                              {row.duplicate && !row.removed && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: '#fef3c7', color: '#92400e' }}>DUP</span>}
                            </td>
                            <td style={{ padding: '8px 14px', borderBottom: '1px solid #f5f7fa' }}>
                              {row.removed ? (
                                <span style={{ color: '#9ca3af', fontSize: 12 }}>{TX_SHORT_LABELS[row.type] ?? row.type.replace(/_/g, ' ')}</span>
                              ) : (
                                <select value={row.type} onChange={e => updateLoanStatementRowType(i, e.target.value)}
                                  style={{ padding: '3px 6px', border: '1px solid #e4e7f0', borderRadius: 6, fontSize: 12, color: '#1a1e2e', background: '#fff', outline: 'none' }}>
                                  {Object.entries(TX_SHORT_LABELS).map(([v, label]) => (
                                    <option key={v} value={v}>{label}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td style={{ padding: '8px 14px', borderBottom: '1px solid #f5f7fa', color: '#5c6478', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.description ?? '—'}
                            </td>
                            <td style={{ padding: '8px 14px', borderBottom: '1px solid #f5f7fa', textAlign: 'right', fontWeight: row.type === 'principal_payment' ? 400 : 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: row.type === 'principal_payment' ? '#9ca3af' : row.amount < 0 ? '#c8332a' : '#15803d' }}>
                              {row.amount < 0 ? `(${formatCurrency(Math.abs(row.amount))})` : formatCurrency(row.amount)}
                            </td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid #f5f7fa', width: '1px' }}>
                              {row.removed ? (
                                <button onClick={() => restoreLoanStatementRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: BLUE, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>Restore</button>
                              ) : (
                                <button onClick={() => removeLoanStatementRow(i)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 6px', borderRadius: 4, fontSize: 14, lineHeight: 1 }}>×</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid #e4e7f0', flexShrink: 0 }}>
                {loanStatementError && (
                  <div style={{ marginBottom: 12, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {loanStatementError}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setLoanStatementPreview(null)}
                      style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                      Cancel
                    </button>
                    {dupCount > 0 && (
                      <button onClick={removeLoanStatementDuplicates}
                        style={{ padding: '9px 16px', background: '#fef3c7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#92400e' }}>
                        Remove {dupCount} duplicate{dupCount !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                  {(() => {
                    const newLoanReady = !p.createMode || (
                      !!p.newLoanForm?.lender.trim() &&
                      !!p.newLoanForm?.interest_rate &&
                      !!p.newLoanForm?.loan_term_years
                    )
                    const canConfirm = (p.loanId || p.createMode) && newLoanReady
                    return (
                      <button onClick={confirmLoanStatement} disabled={loanStatementSaving || !canConfirm}
                        style={{ padding: '9px 20px', background: canConfirm ? BLUE : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'not-allowed' }}>
                        {loanStatementSaving
                          ? 'Saving…'
                          : p.createMode
                            ? `Create loan + import ${activeRows.length} transaction${activeRows.length !== 1 ? 's' : ''}`
                            : activeRows.length > 0
                              ? `Update balance + import ${activeRows.length} transaction${activeRows.length !== 1 ? 's' : ''}`
                              : 'Update balance only'}
                      </button>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Add Loan Modal removed — handled by unified wizard ── */}
      {false && (
        <div>
          <div>
            <div style={{ padding: '20px 20px 8px' }}>
              {/* Row 1: Lender + Account suffix */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Lender *</label>
                  <input value={addLoanForm.lender} onChange={e => setAddLoanForm(f => ({ ...f, lender: e.target.value }))}
                    placeholder="e.g. ANZ, CBA, Westpac"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Account suffix</label>
                  <input value={addLoanForm.account_suffix} onChange={e => setAddLoanForm(f => ({ ...f, account_suffix: e.target.value }))}
                    placeholder="e.g. 001, P&I"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>
              {/* Row 2: Loan limit + Rate + Term */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Loan limit ($)</label>
                  <input type="number" step="1000" value={addLoanForm.loan_limit} onChange={e => setAddLoanForm(f => ({ ...f, loan_limit: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Rate (%)</label>
                  <input type="number" step="0.01" value={addLoanForm.interest_rate} onChange={e => setAddLoanForm(f => ({ ...f, interest_rate: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Term (years)</label>
                  <input type="number" step="1" value={addLoanForm.loan_term_years} onChange={e => setAddLoanForm(f => ({ ...f, loan_term_years: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>
              {/* Row 3: Repayment type + Rate type + Start date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Repayment type</label>
                  <select value={addLoanForm.repayment_type} onChange={e => setAddLoanForm(f => ({ ...f, repayment_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value="principal_and_interest">P&amp;I</option>
                    <option value="interest_only">IO</option>
                    <option value="interest_in_advance">IO Advance</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Rate type</label>
                  <select value={addLoanForm.rate_type} onChange={e => setAddLoanForm(f => ({ ...f, rate_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value="variable">Variable</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Start date</label>
                  <input type="date" value={addLoanForm.start_date} onChange={e => setAddLoanForm(f => ({ ...f, start_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>
              {/* Row 4: Purpose + IO expiry */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Purpose</label>
                  <select value={addLoanForm.purpose} onChange={e => setAddLoanForm(f => ({ ...f, purpose: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value="investment">Investment</option>
                    <option value="owner_occupied">Owner-occupied</option>
                  </select>
                </div>
                {addLoanForm.repayment_type === 'interest_only' || addLoanForm.repayment_type === 'interest_in_advance' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>IO expiry date</label>
                    <input type="date" value={addLoanForm.io_expiry_date} onChange={e => setAddLoanForm(f => ({ ...f, io_expiry_date: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Fixed rate expiry</label>
                    <input type="date" value={addLoanForm.fixed_rate_expiry} onChange={e => setAddLoanForm(f => ({ ...f, fixed_rate_expiry: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                )}
              </div>
              {/* Row 5: Refinances */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Refinances existing loan (optional)</label>
                <select value={addLoanForm.refinanced_from_loan_id} onChange={e => setAddLoanForm(f => ({ ...f, refinanced_from_loan_id: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                  <option value="">— None —</option>
                  {loans.map(l => <option key={l.id} value={l.id}>{l.lender}{l.account_suffix ? ` · ${l.account_suffix}` : ''}{l.status === 'closed' ? ' (paid out)' : ''}</option>)}
                </select>
              </div>
              {/* Security properties */}
              <div style={{ marginBottom: 8, paddingTop: 14, borderTop: '1px solid #f0f2f7' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Security Properties</div>
                {userProperties.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: 8 }}>
                    <input type="checkbox"
                      checked={addLoanSecurityForm.propertyIds.includes(p.id)}
                      onChange={e => setAddLoanSecurityForm(f => ({
                        ...f,
                        propertyIds: e.target.checked ? [...f.propertyIds, p.id] : f.propertyIds.filter(id => id !== p.id),
                      }))} />
                    {p.name}
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: addLoanSecurityForm.outsideEnabled ? 10 : 0 }}>
                  <input type="checkbox"
                    checked={addLoanSecurityForm.outsideEnabled}
                    onChange={e => setAddLoanSecurityForm(f => ({ ...f, outsideEnabled: e.target.checked, outsideDescription: e.target.checked ? f.outsideDescription : '', outsideValue: e.target.checked ? f.outsideValue : '' }))} />
                  Outside portfolio security
                </label>
                {addLoanSecurityForm.outsideEnabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 10.5, color: '#5c6478', marginBottom: 3, fontWeight: 600 }}>Description</label>
                      <input value={addLoanSecurityForm.outsideDescription}
                        onChange={e => setAddLoanSecurityForm(f => ({ ...f, outsideDescription: e.target.value }))}
                        placeholder="e.g. 123 Smith St, Suburbs"
                        style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10.5, color: addLoanSecurityForm.outsideEnabled && !addLoanSecurityForm.outsideValue ? '#c8332a' : '#5c6478', marginBottom: 3, fontWeight: 600 }}>Estimated value ($) <span style={{ color: '#c8332a' }}>*</span></label>
                      <input type="number" value={addLoanSecurityForm.outsideValue}
                        onChange={e => setAddLoanSecurityForm(f => ({ ...f, outsideValue: e.target.value }))}
                        style={{ width: '100%', padding: '7px 9px', border: `1px solid ${addLoanSecurityForm.outsideEnabled && !addLoanSecurityForm.outsideValue ? '#fca5a5' : '#d1d5db'}`, borderRadius: 6, fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {(() => {
              const isValid = addLoanForm.lender.trim() !== '' &&
                addLoanForm.interest_rate !== '' &&
                addLoanForm.start_date !== '' &&
                addLoanForm.loan_term_years !== '' &&
                !(addLoanSecurityForm.outsideEnabled && !addLoanSecurityForm.outsideValue)
              return (
                <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #e4e7f0' }}>
                  {addLoanError && <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 12.5, color: '#c8332a' }}>⚠ {addLoanError}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setShowAddLoanModal(false); setAddLoanForm(EMPTY_NEW_LOAN_FORM); setAddLoanSecurityForm({ propertyIds: [], outsideEnabled: false, outsideDescription: '', outsideValue: '' }) }}
                      style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                      Cancel
                    </button>
                    <button onClick={saveAddLoan} disabled={addLoanSaving || !isValid}
                      style={{ padding: '9px 20px', background: isValid ? BLUE : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isValid ? 'pointer' : 'not-allowed' }}>
                      {addLoanSaving ? 'Adding…' : 'Add Loan'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Loan Edit Modal ──────────────────────────────────── */}
      {editingLoan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) closeEditModal() }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #e4e7f0' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{editingLoan.status === 'closed' ? 'Loan Details' : 'Edit Loan Details'}</div>
                <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
                  {editingLoan.lender}{editingLoan.account_suffix ? ` · ${editingLoan.account_suffix}` : ''}
                  {editingLoan.status === 'closed' && (() => {
                    const refinancedTo = loans.find(l => l.refinanced_from_loan_id === editingLoan.id)
                    if (refinancedTo) {
                      return <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8', fontWeight: 600, fontSize: 10.5 }}>
                        Refinanced to {refinancedTo.lender}{refinancedTo.account_suffix ? ` · ${refinancedTo.account_suffix}` : ''}
                      </span>
                    }
                    return <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 10, background: '#e5e7eb', color: '#6b7280', fontWeight: 600, fontSize: 10.5 }}>PAID OUT</span>
                  })()}
                  {editingLoan.status === 'closed' && editingLoan.closed_date && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>{fmtDate(editingLoan.closed_date)}</span>
                  )}
                </div>
              </div>
              <button onClick={closeEditModal} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>

            {/* Form body */}
            <div style={{ padding: '20px 20px 8px' }}>
              <fieldset disabled={editingLoan.status === 'closed'} style={{ border: 'none', padding: 0, margin: 0, opacity: editingLoan.status === 'closed' ? 0.55 : 1 }}>
              {/* Row 1: Lender + Account suffix */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Lender</label>
                  <input value={loanForm.lender} onChange={e => setLoanForm(f => ({ ...f, lender: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Account suffix / split</label>
                  <input value={loanForm.account_suffix} onChange={e => setLoanForm(f => ({ ...f, account_suffix: e.target.value }))}
                    placeholder="e.g. 001, P&I split"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
              </div>

              {/* Row 2: Repayment type + Rate type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Repayment type</label>
                  <select value={loanForm.repayment_type} onChange={e => setLoanForm(f => ({ ...f, repayment_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, background: '#fff', boxSizing: 'border-box', outline: 'none' }}>
                    <option value="principal_and_interest">Principal &amp; Interest</option>
                    <option value="interest_only">Interest Only</option>
                    <option value="interest_in_advance">Interest in Advance</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Rate type</label>
                  <select value={loanForm.rate_type} onChange={e => setLoanForm(f => ({ ...f, rate_type: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, background: '#fff', boxSizing: 'border-box', outline: 'none' }}>
                    <option value="variable">Variable</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Original amount + Interest rate */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Original amount ($)</label>
                  <input type="number" step="1000" value={loanForm.original_amount} onChange={e => setLoanForm(f => ({ ...f, original_amount: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Rate (%)</label>
                    <input type="number" step="0.01" value={loanForm.interest_rate} onChange={e => setLoanForm(f => ({ ...f, interest_rate: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Rate effective date</label>
                    <input type="date" value={loanForm.rate_effective_date} onChange={e => setLoanForm(f => ({ ...f, rate_effective_date: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                </div>
              </div>

              {/* Row 4: Loan term + IO expiry (when IO or IIA) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Maturity date</label>
                  <input type="date" value={loanForm.maturity_date} onChange={e => setLoanForm(f => ({ ...f, maturity_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                {(loanForm.repayment_type === 'interest_only' || loanForm.repayment_type === 'interest_in_advance') && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>
                      Interest Only expiry date <span style={{ color: '#c8332a' }}>*</span>
                      {loanForm.io_expiry_date && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: getIoRemaining(loanForm.io_expiry_date) === 'Expired' ? '#c8332a' : '#9ca3af' }}>{getIoRemaining(loanForm.io_expiry_date)}</span>}
                    </label>
                    <input type="date" value={loanForm.io_expiry_date} onChange={e => setLoanForm(f => ({ ...f, io_expiry_date: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                )}
              </div>

              {/* Row 5: Start date + Maturity date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Start date</label>
                  <input type="date" value={loanForm.start_date} onChange={e => setLoanForm(f => ({ ...f, start_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Maturity date</label>
                  <input type="date" value={loanForm.maturity_date} readOnly
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none', background: '#f9fafb', color: '#6b7280' }} />
                </div>
              </div>

              {/* Row 6: Fixed rate expiry (when fixed) */}
              {loanForm.rate_type === 'fixed' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Fixed rate expiry <span style={{ color: '#c8332a' }}>*</span></label>
                  <input type="date" value={loanForm.fixed_rate_expiry} onChange={e => setLoanForm(f => ({ ...f, fixed_rate_expiry: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                </div>
              )}

              </fieldset>

              {/* Purpose */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Purpose</label>
                <select value={loanForm.purpose} onChange={e => setLoanForm(f => ({ ...f, purpose: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
                  <option value="">Not set</option>
                  <option value="investment">Investment</option>
                  <option value="owner_occupied">Owner-occupied</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>

              {/* Notes — always editable */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }}>Notes</label>
                <textarea value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="Any additional notes about this loan…"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
              </div>

              {/* Security — hidden for closed loans */}
              {editingLoan.status !== 'closed' && <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10, paddingTop: 4, borderTop: '1px solid #f0f2f7' }}>Security Properties</div>
                <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 8 }}>Which property/properties does this loan sit over? Used to calculate real LVR.</div>
                {/* In-portfolio checkboxes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {userProperties.map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={loanSecurityForm.propertyIds.includes(p.id)}
                        onChange={e => setLoanSecurityForm(f => ({
                          ...f,
                          propertyIds: e.target.checked ? [...f.propertyIds, p.id] : f.propertyIds.filter(id => id !== p.id)
                        }))}
                        style={{ width: 15, height: 15, accentColor: BLUE, flexShrink: 0 }}
                      />
                      <span>🏠 {p.name}</span>
                      {latestSecurityValuations[p.id] && <span style={{ color: '#9ca3af', fontSize: 11.5 }}>{formatCurrency(latestSecurityValuations[p.id])}</span>}
                    </label>
                  ))}
                </div>
                {/* Outside portfolio */}
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', border: '1px solid #e4e7f0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: loanSecurityForm.outsideEnabled ? 10 : 0 }}>
                    <input
                      type="checkbox"
                      checked={loanSecurityForm.outsideEnabled}
                      onChange={e => setLoanSecurityForm(f => ({ ...f, outsideEnabled: e.target.checked, outsideDescription: e.target.checked ? f.outsideDescription : '', outsideValue: e.target.checked ? f.outsideValue : '' }))}
                      style={{ width: 15, height: 15, accentColor: BLUE, flexShrink: 0 }}
                    />
                    <span style={{ fontWeight: 600 }}>🏘 Outside portfolio</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>e.g. PPOR or untracked property</span>
                  </label>
                  {loanSecurityForm.outsideEnabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 10.5, color: '#5c6478', marginBottom: 3, fontWeight: 600 }}>Description</label>
                        <input value={loanSecurityForm.outsideDescription}
                          onChange={e => setLoanSecurityForm(f => ({ ...f, outsideDescription: e.target.value }))}
                          placeholder="e.g. PPOR — 12 Smith St, Kenmore"
                          style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 10.5, color: loanSecurityForm.outsideEnabled && !loanSecurityForm.outsideValue ? '#c8332a' : '#5c6478', marginBottom: 3, fontWeight: 600 }}>Estimated value ($) <span style={{ color: '#c8332a' }}>*</span></label>
                        <input type="number" value={loanSecurityForm.outsideValue}
                          onChange={e => setLoanSecurityForm(f => ({ ...f, outsideValue: e.target.value }))}
                          placeholder="e.g. 950000"
                          style={{ width: '100%', padding: '7px 9px', border: `1px solid ${loanSecurityForm.outsideEnabled && !loanSecurityForm.outsideValue ? '#c8332a' : '#d1d5db'}`, borderRadius: 7, fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px 18px', borderTop: '1px solid #e4e7f0' }}>
              {editingLoan.status === 'closed' ? (
                <>
                  {/* Reinstate confirmation */}
                  {loanModalAction === 'reinstate' && (
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '1px solid #86efac' }}>
                      <div style={{ fontSize: 12.5, color: '#14532d', fontWeight: 600, marginBottom: 8 }}>
                        Reinstate this loan? It will be marked as active and all fields will become editable again.
                      </div>
                      {reinstateLoanError && <div style={{ fontSize: 12, color: '#c8332a', marginBottom: 6 }}>⚠ {reinstateLoanError}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setLoanModalAction('none')}
                          style={{ padding: '5px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                          Cancel
                        </button>
                        <button onClick={() => reinstateLoan(editingLoan.id)} disabled={reinstateLoanSaving}
                          style={{ padding: '5px 12px', background: '#16a34a', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                          {reinstateLoanSaving ? 'Saving…' : 'Confirm reinstate'}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Delete confirmation */}
                  {loanModalAction === 'delete' && (
                    <div style={{ background: '#fef2f2', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '1px solid #fca5a5' }}>
                      <div style={{ fontSize: 12.5, color: '#991b1b', fontWeight: 600, marginBottom: 8 }}>
                        Delete this loan permanently? This will remove the loan and all its transactions and cannot be undone.
                      </div>
                      {deleteLoanError && <div style={{ fontSize: 12, color: '#c8332a', marginBottom: 6 }}>⚠ {deleteLoanError}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setLoanModalAction('none')}
                          style={{ padding: '5px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
                          Cancel
                        </button>
                        <button onClick={() => deleteLoan(editingLoan.id)} disabled={deleteLoanSaving}
                          style={{ padding: '5px 12px', background: '#c8332a', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' }}>
                          {deleteLoanSaving ? 'Deleting…' : 'Delete permanently'}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Closed loan footer actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setLoanModalAction('reinstate') }}
                        disabled={loanModalAction !== 'none'}
                        style={{ padding: '8px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: '#15803d', opacity: loanModalAction !== 'none' ? 0.5 : 1 }}>
                        Reinstate
                      </button>
                      <button onClick={() => { setLoanModalAction('delete') }}
                        disabled={loanModalAction !== 'none'}
                        style={{ padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: '#c8332a', opacity: loanModalAction !== 'none' ? 0.5 : 1 }}>
                        Delete permanently
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {loanSaveError && <span style={{ fontSize: 12, color: '#c8332a' }}>⚠ {loanSaveError}</span>}
                      <button onClick={closeEditModal}
                        style={{ padding: '8px 18px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                        Close
                      </button>
                      <button onClick={saveLoan} disabled={loanSaving}
                        style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: loanSaving ? 'default' : 'pointer', opacity: loanSaving ? 0.7 : 1 }}>
                        {loanSaving ? 'Saving…' : 'Save notes'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                  {loanSaveError && <span style={{ fontSize: 12, color: '#c8332a', marginRight: 'auto' }}>⚠ {loanSaveError}</span>}
                  <button onClick={closeEditModal}
                    style={{ padding: '8px 18px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={saveLoan} disabled={loanSaving}
                    style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: loanSaving ? 'default' : 'pointer', opacity: loanSaving ? 0.7 : 1 }}>
                    {loanSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Refinance Wizard ─────────────────────────────────── */}
      {(rfLoan !== null || rfMode === 'add') && (() => {
        const gate2Fields = getRfGate2Fields(rfDocs)
        const allGate2Checked = gate2Fields.length === 0 || gate2Fields.every(f => rfGate2Checks[f.key])
        const anyDocParsed = !!(rfParsedClosing || rfParsedContract || rfParsedStatement)
        const autoFill = getRfAutoFillPreview(rfDocs)
        const isIO = rfForm.repayment_type === 'interest_only' || rfForm.repayment_type === 'interest_in_advance'
        const settlementRequired = rfMode === 'refinance' || rfIsNewLoan
        const rfFormValid = !!(!settlementRequired || rfForm.settlement_date) && !!(rfForm.lender.trim() && rfForm.interest_rate)
        const STEP_LABELS: Record<string, string> = { gate1: 'Step 1 of 4 — Documents', gate2: 'Step 2 of 4 — Readiness check', upload: 'Step 3 of 4 — Upload documents', details: 'Step 4 of 4 — Review details', confirm: rfMode === 'add' ? 'Confirm loan' : 'Confirm refinance' }

        const rfInputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', outline: 'none' }
        const rfSelectStyle: React.CSSProperties = { ...rfInputStyle, background: '#fff' }
        const rfLabelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#5c6478', marginBottom: 4 }
        const autoTag = (filled: boolean) => filled
          ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#dcfce7', color: '#15803d', marginLeft: 6, fontWeight: 600 }}>Auto-filled</span>
          : null

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) closeRfWizard() }}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', colorScheme: 'light' }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e4e7f0' }}>
                <div>
                  {rfStep !== 'prequel' && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{STEP_LABELS[rfStep]}</div>}
                  <div style={{ fontSize: 14, fontWeight: 800 }}>
                    {rfMode === 'add' ? 'Add Loan' : `Refinance — ${rfLoan!.lender}${rfLoan!.account_suffix ? ` · ${rfLoan!.account_suffix}` : ''}`}
                  </div>
                </div>
                <button onClick={closeRfWizard} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>

              {/* ── PREQUEL ── */}
              {rfStep === 'prequel' && rfMode === 'add' && (
                <div style={{ padding: '32px 28px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 16 }}>🏦</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Are you recording an existing loan or one that just settled?</div>
                  <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 28, lineHeight: 1.6 }}>
                    We&apos;ll guide you through adding the details and importing your first statement.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300, margin: '0 auto' }}>
                    <button onClick={() => { setRfIsNewLoan(false); setRfStep('gate1') }}
                      style={{ padding: '12px 20px', background: BLUE, border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                      Recording an existing loan
                    </button>
                    <button onClick={() => { setRfIsNewLoan(true); setRfStep('gate1') }}
                      style={{ padding: '12px 20px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 9, fontSize: 13.5, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}>
                      New loan that just settled
                    </button>
                    <button onClick={closeRfWizard}
                      style={{ padding: '10px 20px', background: 'none', border: 'none', fontSize: 12.5, color: '#9ca3af', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {rfStep === 'prequel' && rfMode === 'refinance' && (
                <div style={{ padding: '32px 28px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 16 }}>🔄</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Have you recently refinanced this loan?</div>
                  <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 28, lineHeight: 1.6 }}>
                    This wizard will close your existing loan and set up the new one — including importing your first statement.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300, margin: '0 auto' }}>
                    <button onClick={() => setRfStep('gate1')}
                      style={{ padding: '12px 20px', background: BLUE, border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                      Yes — I&apos;ve already refinanced
                    </button>
                    <button style={{ padding: '12px 20px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 9, fontSize: 13.5, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}
                      onClick={() => { alert('Let your broker know you\'re looking to refinance — we\'ll be in touch.'); closeRfWizard() }}>
                      No — I&apos;m looking to refinance
                    </button>
                    <button onClick={closeRfWizard}
                      style={{ padding: '10px 20px', background: 'none', border: 'none', fontSize: 12.5, color: '#9ca3af', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ── GATE 1 — DOCUMENTS ── */}
              {rfStep === 'gate1' && (
                <div style={{ padding: '20px 22px 0' }}>
                  <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 18, lineHeight: 1.6 }}>
                    Tick the documents you have on hand. We&apos;ll use them to auto-fill the new loan details.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    {([
                      { key: 'closing' as const, title: 'Closing statement', desc: `Final statement from ${rfLoan?.lender ?? 'old lender'} confirming discharge` },
                      { key: 'contract' as const, title: 'Loan contract / letter of offer', desc: 'From your new lender — covers amount, rate, term, repayment type' },
                      { key: 'statement' as const, title: rfMode === 'add' && !rfIsNewLoan ? 'Most recent statement' : 'First statement from new lender', desc: 'Confirms settlement date, opening balance, account number' },
                    ] as Array<{ key: 'closing' | 'contract' | 'statement'; title: string; desc: string }>)
                      .filter(doc => rfMode === 'refinance' || doc.key !== 'closing')
                      .map(doc => (
                      <label key={doc.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', border: `1.5px solid ${rfDocs[doc.key] ? BLUE : '#e4e7f0'}`, borderRadius: 9, cursor: 'pointer', background: rfDocs[doc.key] ? '#f0f6ff' : '#fafafa' }}>
                        <input type="checkbox" checked={rfDocs[doc.key]}
                          onChange={e => setRfDocs(d => ({ ...d, [doc.key]: e.target.checked }))}
                          style={{ marginTop: 2, width: 15, height: 15, accentColor: BLUE, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2942' }}>{doc.title}</div>
                          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{doc.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Auto-fill preview */}
                  {(rfDocs.closing || rfDocs.contract || rfDocs.statement) && (
                    <div style={{ background: '#f9fafb', borderRadius: 9, padding: '12px 14px', marginBottom: 20, border: '1px solid #e4e7f0' }}>
                      {autoFill.filled.length > 0 && (
                        <div style={{ marginBottom: autoFill.needed.length > 0 ? 8 : 0 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.05em' }}>Auto-filled ({autoFill.filled.length})</span>
                          <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>{autoFill.filled.join(' · ')}</div>
                        </div>
                      )}
                      {autoFill.needed.length > 0 && (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '.05em' }}>Still needed ({autoFill.needed.length})</span>
                          <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>{autoFill.needed.join(' · ')}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual entry option */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 18px' }}>
                    <div style={{ flex: 1, height: 1, background: '#e4e7f0' }} />
                    <span style={{ fontSize: 11.5, color: '#9ca3af', whiteSpace: 'nowrap' }}>or</span>
                    <div style={{ flex: 1, height: 1, background: '#e4e7f0' }} />
                  </div>
                  <button
                    onClick={() => setRfStep('details')}
                    style={{ width: '100%', padding: '11px 14px', background: '#f8fafc', border: '1.5px solid #e4e7f0', borderRadius: 9, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2942' }}>Enter details manually</div>
                      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>Skip document upload and fill in all fields yourself</div>
                    </div>
                    <span style={{ fontSize: 16, color: '#9ca3af' }}>→</span>
                  </button>

                  <div style={{ padding: '12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e4e7f0' }}>
                    <button onClick={() => setRfStep('prequel')}
                      style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                      ← Back
                    </button>
                    {!(rfDocs.closing || rfDocs.contract || rfDocs.statement) ? (
                      <button onClick={() => { copyRfChecklist(); closeRfWizard() }}
                        style={{ padding: '8px 16px', background: '#f0f2f7', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                        Copy checklist &amp; exit
                      </button>
                    ) : (
                      <button onClick={() => setRfStep('gate2')}
                        style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                        Next →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── GATE 2 — READINESS CHECK ── */}
              {rfStep === 'gate2' && (
                <div style={{ padding: '20px 22px 0' }}>
                  {gate2Fields.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0 20px' }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>You have everything needed</div>
                      <div style={{ fontSize: 13, color: '#5c6478' }}>Your documents cover all required information. Ready to upload.</div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 16, lineHeight: 1.6 }}>
                        Based on your documents, we&apos;ll still need the following. Tick each item you have ready — you need all of them to proceed.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                        {gate2Fields.map(f => (
                          <label key={f.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: `1.5px solid ${rfGate2Checks[f.key] ? '#86efac' : '#e4e7f0'}`, borderRadius: 9, cursor: 'pointer', background: rfGate2Checks[f.key] ? '#f0fdf4' : '#fafafa' }}>
                            <input type="checkbox" checked={!!rfGate2Checks[f.key]}
                              onChange={e => setRfGate2Checks(c => ({ ...c, [f.key]: e.target.checked }))}
                              style={{ marginTop: 2, width: 15, height: 15, accentColor: '#16a34a', flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2942' }}>{f.label}</div>
                              <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{f.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {!allGate2Checked && (
                        <div style={{ background: '#fffbeb', borderRadius: 8, padding: '10px 14px', marginBottom: 16, border: '1px solid #fde68a', fontSize: 12.5, color: '#92400e' }}>
                          Gather the unchecked items first, then come back to complete this. Use &ldquo;Copy checklist&rdquo; to save the full list.
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ padding: '12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e4e7f0' }}>
                    <button onClick={() => setRfStep('gate1')}
                      style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                      ← Back
                    </button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!allGate2Checked && (
                        <button onClick={() => { copyRfChecklist(); closeRfWizard() }}
                          style={{ padding: '8px 16px', background: '#f0f2f7', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                          Copy checklist &amp; exit
                        </button>
                      )}
                      <button onClick={() => setRfStep('upload')} disabled={!allGate2Checked}
                        style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: allGate2Checked ? 'pointer' : 'default', opacity: allGate2Checked ? 1 : 0.45 }}>
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── UPLOAD ── */}
              {rfStep === 'upload' && (
                <div style={{ padding: '20px 22px 0' }}>
                  <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 18, lineHeight: 1.6 }}>
                    Upload each document you declared. We&apos;ll extract the details automatically.
                  </div>
                  {rfUploadError && <div style={{ fontSize: 12.5, color: '#c8332a', background: '#fef2f2', borderRadius: 7, padding: '8px 12px', marginBottom: 14 }}>⚠ {rfUploadError}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                    {rfDocs.closing && (
                      <div style={{ border: '1px solid #e4e7f0', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Closing statement</div>
                          {rfParsedClosing ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>✓ Parsed</span>
                            : rfUploading.closing ? <span style={{ fontSize: 11, color: '#6b7280' }}>Parsing…</span>
                            : <button onClick={() => rfClosingInputRef.current?.click()}
                                style={{ fontSize: 12, padding: '5px 12px', background: BLUE, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                                Choose file
                              </button>}
                        </div>
                        {rfParsedClosing && <div style={{ fontSize: 11.5, color: '#6b7280' }}>Balance: {formatCurrency(rfParsedClosing.balance)} · {rfParsedClosing.balanceDate}</div>}
                        <input ref={rfClosingInputRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadRfDoc('closing', f) }} />
                      </div>
                    )}
                    {rfDocs.contract && (
                      <div style={{ border: '1px solid #e4e7f0', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Loan contract / letter of offer</div>
                          {rfParsedContract ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>✓ Parsed</span>
                            : rfUploading.contract ? <span style={{ fontSize: 11, color: '#6b7280' }}>Parsing…</span>
                            : <button onClick={() => rfContractInputRef.current?.click()}
                                style={{ fontSize: 12, padding: '5px 12px', background: BLUE, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                                Choose file
                              </button>}
                        </div>
                        {rfParsedContract && <div style={{ fontSize: 11.5, color: '#6b7280' }}>{rfParsedContract.lender ?? '—'} · {rfParsedContract.loanLimit ? formatCurrency(rfParsedContract.loanLimit) : '—'} · {rfParsedContract.rate ?? '—'}%</div>}
                        <input ref={rfContractInputRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadRfDoc('contract', f) }} />
                      </div>
                    )}
                    {rfDocs.statement && (
                      <div style={{ border: '1px solid #e4e7f0', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>First statement (new loan)</div>
                          {rfParsedStatement ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontWeight: 700 }}>✓ Parsed</span>
                            : rfUploading.statement ? <span style={{ fontSize: 11, color: '#6b7280' }}>Parsing…</span>
                            : <button onClick={() => rfStatementInputRef.current?.click()}
                                style={{ fontSize: 12, padding: '5px 12px', background: BLUE, border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                                Choose file
                              </button>}
                        </div>
                        {rfParsedStatement && <div style={{ fontSize: 11.5, color: '#6b7280' }}>{rfParsedStatement.lender ?? '—'} · Balance: {formatCurrency(rfParsedStatement.balance)} · {rfParsedStatement.rows.length} transaction{rfParsedStatement.rows.length !== 1 ? 's' : ''} found</div>}
                        <input ref={rfStatementInputRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadRfDoc('statement', f) }} />
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e4e7f0' }}>
                    <button onClick={() => setRfStep('gate2')}
                      style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                      ← Back
                    </button>
                    <button onClick={() => { buildRfFormFromParsed(); setRfStep('details') }} disabled={!anyDocParsed}
                      style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: anyDocParsed ? 'pointer' : 'default', opacity: anyDocParsed ? 1 : 0.45 }}>
                      Next →
                    </button>
                  </div>
                </div>
              )}

              {/* ── DETAILS ── */}
              {rfStep === 'details' && (
                <div style={{ padding: '20px 22px 0' }}>
                  <div style={{ fontSize: 12.5, color: '#5c6478', marginBottom: 16, lineHeight: 1.5 }}>
                    Review the extracted details and fill in anything missing. Fields marked <span style={{ fontWeight: 700, color: '#c8332a' }}>*</span> are required.
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={rfLabelStyle}>
                      {rfMode === 'add' && !rfIsNewLoan ? 'Start date' : 'Settlement date'}
                      {settlementRequired && <span style={{ color: '#c8332a' }}> *</span>}
                      {autoTag(!!rfParsedStatement?.startDate || !!rfParsedClosing?.balanceDate)}
                    </label>
                    <input type="date" value={rfForm.settlement_date} onChange={e => setRfForm(f => ({ ...f, settlement_date: e.target.value }))}
                      style={{ ...rfInputStyle, border: `1px solid ${settlementRequired && !rfForm.settlement_date ? '#c8332a' : '#d1d5db'}` }} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={rfLabelStyle}>New lender <span style={{ color: '#c8332a' }}>*</span>{autoTag(!!(rfParsedContract?.lender || rfParsedStatement?.lender))}</label>
                      <input value={rfForm.lender} onChange={e => setRfForm(f => ({ ...f, lender: e.target.value }))}
                        style={{ ...rfInputStyle, border: `1px solid ${!rfForm.lender.trim() ? '#c8332a' : '#d1d5db'}` }} />
                    </div>
                    <div>
                      <label style={rfLabelStyle}>Account suffix{autoTag(!!(rfParsedStatement?.account || rfParsedContract?.account))}</label>
                      <input value={rfForm.account_suffix} onChange={e => setRfForm(f => ({ ...f, account_suffix: e.target.value }))}
                        style={rfInputStyle} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={rfLabelStyle}>Original loan amount ($){autoTag(!!(rfParsedContract?.loanLimit || rfParsedStatement?.loanLimit))}</label>
                      <input type="number" step="1000" value={rfForm.loan_limit} onChange={e => setRfForm(f => ({ ...f, loan_limit: e.target.value }))}
                        style={rfInputStyle} />
                    </div>
                    <div>
                      <label style={rfLabelStyle}>Rate (%) <span style={{ color: '#c8332a' }}>*</span>{autoTag(rfParsedContract?.rate != null || rfParsedStatement?.rate != null)}</label>
                      <input type="number" step="0.01" value={rfForm.interest_rate} onChange={e => setRfForm(f => ({ ...f, interest_rate: e.target.value }))}
                        style={{ ...rfInputStyle, border: `1px solid ${!rfForm.interest_rate ? '#c8332a' : '#d1d5db'}` }} />
                    </div>
                    <div>
                      <label style={rfLabelStyle}>Rate type{autoTag(!!rfParsedContract?.rateType)}</label>
                      <select value={rfForm.rate_type} onChange={e => setRfForm(f => ({ ...f, rate_type: e.target.value }))} style={rfSelectStyle}>
                        <option value="variable">Variable</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={rfLabelStyle}>Repayment type{autoTag(!!(rfParsedContract?.repaymentType || rfParsedStatement?.loanType))}</label>
                      <select value={rfForm.repayment_type} onChange={e => setRfForm(f => ({ ...f, repayment_type: e.target.value }))} style={rfSelectStyle}>
                        <option value="principal_and_interest">Principal &amp; Interest</option>
                        <option value="interest_only">Interest Only</option>
                        <option value="interest_in_advance">Interest in Advance</option>
                      </select>
                    </div>
                    <div>
                      <label style={rfLabelStyle}>Loan term (years){autoTag(!!rfParsedContract?.loanTermYears)}</label>
                      <input type="number" step="1" value={rfForm.loan_term_years} onChange={e => setRfForm(f => ({ ...f, loan_term_years: e.target.value }))}
                        style={rfInputStyle} />
                    </div>
                  </div>

                  {(isIO || rfForm.rate_type === 'fixed') && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                      {isIO && (
                        <div>
                          <label style={rfLabelStyle}>
                            Interest Only expiry{autoTag(!!rfParsedContract?.ioExpiryDate)}
                            {rfForm.io_expiry_date && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: getIoRemaining(rfForm.io_expiry_date) === 'Expired' ? '#c8332a' : '#9ca3af' }}>{getIoRemaining(rfForm.io_expiry_date)}</span>}
                          </label>
                          <input type="date" value={rfForm.io_expiry_date} onChange={e => setRfForm(f => ({ ...f, io_expiry_date: e.target.value }))} style={rfInputStyle} />
                        </div>
                      )}
                      {rfForm.rate_type === 'fixed' && (
                        <div>
                          <label style={rfLabelStyle}>Fixed rate expiry{autoTag(!!rfParsedContract?.fixedRateExpiry)}</label>
                          <input type="date" value={rfForm.fixed_rate_expiry} onChange={e => setRfForm(f => ({ ...f, fixed_rate_expiry: e.target.value }))} style={rfInputStyle} />
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginBottom: 14 }}>
                    <label style={rfLabelStyle}>Purpose</label>
                    <select value={rfForm.purpose} onChange={e => setRfForm(f => ({ ...f, purpose: e.target.value }))} style={rfSelectStyle}>
                      <option value="investment">Investment</option>
                      <option value="owner_occupied">Owner-occupied</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: 14, paddingTop: 4, borderTop: '1px solid #f0f2f7' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Security Properties</div>
                    <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 8 }}>Which property/properties secure this loan?</div>
                    {/* In-portfolio */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {userProperties.map(p => (
                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                          <input type="checkbox" checked={rfSecurityIds.includes(p.id)}
                            onChange={e => setRfSecurityIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))}
                            style={{ width: 15, height: 15, accentColor: BLUE, flexShrink: 0 }} />
                          <span>🏠 {p.name}</span>
                          {latestSecurityValuations[p.id] && <span style={{ color: '#9ca3af', fontSize: 11.5 }}>{formatCurrency(latestSecurityValuations[p.id])}</span>}
                        </label>
                      ))}
                    </div>
                    {/* Outside portfolio */}
                    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', border: '1px solid #e4e7f0' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: rfOutsideEnabled ? 10 : 0 }}>
                        <input type="checkbox" checked={rfOutsideEnabled}
                          onChange={e => { setRfOutsideEnabled(e.target.checked); if (!e.target.checked) { setRfOutsideDescription(''); setRfOutsideValue('') } }}
                          style={{ width: 15, height: 15, accentColor: BLUE, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>🏘 Outside my portfolio</span>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>e.g. PPOR or untracked property</span>
                      </label>
                      {rfOutsideEnabled && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8, marginBottom: 10 }}>
                            <div>
                              <label style={{ display: 'block', fontSize: 10.5, color: '#5c6478', marginBottom: 3, fontWeight: 600 }}>Description</label>
                              <input value={rfOutsideDescription} onChange={e => setRfOutsideDescription(e.target.value)}
                                placeholder="e.g. PPOR — 12 Smith St, Kenmore"
                                style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: 10.5, color: !rfOutsideValue ? '#c8332a' : '#5c6478', marginBottom: 3, fontWeight: 600 }}>Est. value ($) <span style={{ color: '#c8332a' }}>*</span></label>
                              <input type="number" value={rfOutsideValue} onChange={e => setRfOutsideValue(e.target.value)}
                                placeholder="950000"
                                style={{ width: '100%', padding: '7px 9px', border: `1px solid ${!rfOutsideValue ? '#c8332a' : '#d1d5db'}`, borderRadius: 7, fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          <div style={{ background: '#eff6ff', borderRadius: 7, padding: '8px 10px', border: '1px solid #bfdbfe', fontSize: 12, color: '#1d4ed8', lineHeight: 1.5 }}>
                            💡 Want to track this property? You can add it to your portfolio after completing this loan setup.
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={rfLabelStyle}>Notes</label>
                    <textarea value={rfForm.notes} onChange={e => setRfForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2} placeholder="Any notes about this refinance…"
                      style={{ ...rfInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>

                  <div style={{ padding: '12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e4e7f0' }}>
                    <button onClick={() => setRfStep('upload')}
                      style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                      ← Back
                    </button>
                    <button onClick={() => setRfStep('confirm')} disabled={!rfFormValid}
                      style={{ padding: '8px 18px', background: BLUE, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: rfFormValid ? 'pointer' : 'default', opacity: rfFormValid ? 1 : 0.45 }}>
                      Review →
                    </button>
                  </div>
                </div>
              )}

              {/* ── CONFIRM ── */}
              {rfStep === 'confirm' && (
                <div style={{ padding: '20px 22px 0' }}>
                  <div style={{ fontSize: 13, color: '#5c6478', marginBottom: 18, lineHeight: 1.6 }}>
                    {rfMode === 'refinance' ? 'Review the changes below before confirming. This will close your old loan and activate the new one.' : 'Review the details below before confirming.'}
                  </div>

                  {rfMode === 'refinance' && rfLoan && (
                    <div style={{ border: '1px solid #fca5a5', borderRadius: 9, padding: '12px 16px', marginBottom: 12, background: '#fef2f2' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Closing</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e2942' }}>{rfLoan.lender}{rfLoan.account_suffix ? ` · ${rfLoan.account_suffix}` : ''}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>Marked as paid out on {rfForm.settlement_date || '—'}</div>
                    </div>
                  )}

                  <div style={{ border: '1px solid #86efac', borderRadius: 9, padding: '12px 16px', marginBottom: 12, background: '#f0fdf4' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>New loan</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e2942' }}>{rfForm.lender}{rfForm.account_suffix ? ` · ${rfForm.account_suffix}` : ''}</div>
                    <div style={{ fontSize: 12, color: '#374151', marginTop: 4, lineHeight: 1.7 }}>
                      {rfForm.loan_limit ? formatCurrency(parseFloat(rfForm.loan_limit)) : '—'} · {rfForm.interest_rate || '—'}% {rfForm.rate_type} · {rfForm.repayment_type === 'principal_and_interest' ? 'P&I' : rfForm.repayment_type === 'interest_only' ? 'IO' : 'IIA'} · {rfForm.loan_term_years || '—'} yr{parseInt(rfForm.loan_term_years) !== 1 ? 's' : ''}<br />
                      Starts: {rfForm.settlement_date || '—'}
                    </div>
                    {rfParsedStatement && rfParsedStatement.rows.length > 0 && (
                      <div style={{ fontSize: 11.5, color: '#16a34a', marginTop: 6, fontWeight: 600 }}>
                        + {rfParsedStatement.rows.length} transaction{rfParsedStatement.rows.length !== 1 ? 's' : ''} from first statement will be imported
                      </div>
                    )}
                  </div>

                  {(rfSecurityIds.length > 0 || rfOutsideEnabled) && (
                    <div style={{ fontSize: 12, color: '#5c6478', marginBottom: 16 }}>
                      Security: {[
                        ...rfSecurityIds.map(id => userProperties.find(p => p.id === id)?.name).filter(Boolean),
                        ...(rfOutsideEnabled ? [rfOutsideDescription.trim() || 'Outside portfolio'] : []),
                      ].join(', ')}
                    </div>
                  )}

                  {rfSaveError && <div style={{ fontSize: 12.5, color: '#c8332a', background: '#fef2f2', borderRadius: 7, padding: '8px 12px', marginBottom: 12 }}>⚠ {rfSaveError}</div>}

                  <div style={{ padding: '12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e4e7f0' }}>
                    <button onClick={() => setRfStep('details')} disabled={rfSaving}
                      style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#5c6478', cursor: 'pointer' }}>
                      ← Back
                    </button>
                    <button onClick={submitWizard} disabled={rfSaving}
                      style={{ padding: '10px 22px', background: '#16a34a', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: rfSaving ? 'default' : 'pointer', opacity: rfSaving ? 0.7 : 1 }}>
                      {rfSaving ? 'Processing…' : rfMode === 'add' ? 'Confirm & add loan' : 'Confirm & complete refinance'}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )
      })()}

      {/* ── Property Details Modal ──────────────────────────────── */}
      {editingDetails && (() => {
        const f = detailsForm
        const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setEditingDetails(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{isArchived ? 'Property Details (Archived)' : property.status === 'sold' ? 'Property Details (Sold)' : 'Edit Property Details'}</h2>
                <button onClick={() => setEditingDetails(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={lbl}>Property name</label>
                  <input value={f.name} onChange={e => setDetailsForm(x => ({ ...x, name: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly} placeholder="e.g. 12 Smith St Kelvin Grove" />
                </div>
                <div>
                  <label style={lbl}>Street address</label>
                  <input value={f.street_address} onChange={e => setDetailsForm(x => ({ ...x, street_address: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Suburb</label>
                    <input value={f.suburb} onChange={e => setDetailsForm(x => ({ ...x, suburb: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly} />
                  </div>
                  <div>
                    <label style={lbl}>State</label>
                    <select value={f.state} onChange={e => setDetailsForm(x => ({ ...x, state: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly}>
                      {['NSW','VIC','QLD','SA','WA','TAS','NT','ACT'].map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Postcode</label>
                    <input value={f.postcode} onChange={e => setDetailsForm(x => ({ ...x, postcode: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} maxLength={4} disabled={isReadOnly} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: f.usage === 'mixed' ? '1fr 1fr' : '1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Usage</label>
                    <select value={f.usage} onChange={e => setDetailsForm(x => ({ ...x, usage: e.target.value, mixed_use_investment_percent: e.target.value !== 'mixed' ? '' : x.mixed_use_investment_percent }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly}>
                      <option value="investment">Investment</option>
                      <option value="ppor">PPOR</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                  {f.usage === 'mixed' && (
                    <div>
                      <label style={lbl}>Investment use % <span style={{ color: '#c8332a' }}>*</span></label>
                      <input type="number" min="1" max="100" step="1" value={f.mixed_use_investment_percent}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '' || (Number(v) >= 1 && Number(v) <= 100)) setDetailsForm(x => ({ ...x, mixed_use_investment_percent: v }))
                        }}
                        style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} placeholder="e.g. 60" disabled={isReadOnly} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Contract date</label>
                    <input type="date" value={f.purchase_date} onChange={e => setDetailsForm(x => ({ ...x, purchase_date: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly} />
                  </div>
                  <div>
                    <label style={lbl}>Settlement date</label>
                    <input type="date" value={f.settlement_date} onChange={e => setDetailsForm(x => ({ ...x, settlement_date: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} disabled={isReadOnly} />
                  </div>
                  <div>
                    <label style={lbl}>Purchase price</label>
                    <input type="number" step="1000" value={f.purchase_price} onChange={e => setDetailsForm(x => ({ ...x, purchase_price: e.target.value }))} style={{ ...s, ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} placeholder="e.g. 750000" disabled={isReadOnly} />
                  </div>
                </div>
                {/* Acquisition costs section */}
                <div style={{ borderTop: '1px solid #f0f2f7', paddingTop: 16, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Acquisition Costs</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(['stamp_duty', 'legal_conveyancing', 'building_inspection', 'buyers_agent', 'loan_establishment'] as AcquisitionCostType[]).map(type => {
                      const existing = acqForm.find(r => r.type === type)
                      return (
                        <div key={type} style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'center' }}>
                          <label style={{ fontSize: 12.5, color: '#5c6478' }}>{ACQ_LABELS[type]}</label>
                          <input type="number" step="100" placeholder="—"
                            value={existing?.amount ?? ''}
                            onChange={e => {
                              const val = e.target.value
                              setAcqForm(prev => {
                                const filtered = prev.filter(r => r.type !== type)
                                return val ? [...filtered, { type, amount: val, description: '' }] : filtered
                              })
                            }}
                            disabled={isReadOnly}
                            style={{ ...s, textAlign: 'right', ...(isReadOnly ? { background: '#f9fafb', color: '#9ca3af' } : {}) }} />
                        </div>
                      )
                    })}
                    {/* Other items */}
                    {acqForm.filter(r => r.type === 'other').map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 8, alignItems: 'center' }}>
                        <input value={row.description} placeholder="Description"
                          onChange={e => setAcqForm(prev => prev.map((r, idx) => r.type === 'other' && acqForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, description: e.target.value } : r))}
                          style={{ ...s, fontSize: 12.5 }} />
                        <input type="number" step="100" value={row.amount}
                          onChange={e => setAcqForm(prev => prev.map((r, idx) => r.type === 'other' && acqForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, amount: e.target.value } : r))}
                          style={{ ...s, textAlign: 'right' }} />
                        <button onClick={() => { const others = acqForm.filter(r => r.type === 'other'); setAcqForm(prev => prev.filter(r => !(r.type === 'other' && prev.filter(x => x.type === 'other').indexOf(r) === i))) }}
                          style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#c8332a', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '4px 6px' }}>×</button>
                      </div>
                    ))}
                    {!isReadOnly && (
                      <button onClick={() => setAcqForm(prev => [...prev, { type: 'other', amount: '', description: '' }])}
                        style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#5c6478', cursor: 'pointer' }}>
                        + Add other cost
                      </button>
                    )}
                  </div>
                </div>

                {overviewError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {overviewError}</div>}

              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Left: property action icons */}
                {/* archived → none | sold → archive only | active → archive + sold + delete */}
                {!isReadOnly && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {/* Archive */}
                    <button title="Archive property"
                      onClick={() => { setEditingDetails(false); archiveProperty() }}
                      style={{ padding: '7px 9px', background: '#f0f2f7', border: 'none', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#5c6478' }}>
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="3" width="14" height="3" rx="1"/><path d="M2 6v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6"/><path d="M6 10h4"/>
                      </svg>
                    </button>
                    {/* Mark as Sold — active only */}
                    <button title="Mark as sold"
                      onClick={() => { setEditingDetails(false); setSoldForm({ sold_date: property.sold_date ?? '', sold_price: property.sold_price != null ? String(property.sold_price) : '', agent_commission: saleCosts.find(c => c.type === 'agent_commission')?.amount != null ? String(saleCosts.find(c => c.type === 'agent_commission')!.amount) : '', legal_conveyancing: saleCosts.find(c => c.type === 'legal_conveyancing')?.amount != null ? String(saleCosts.find(c => c.type === 'legal_conveyancing')!.amount) : '', advertising: saleCosts.find(c => c.type === 'advertising')?.amount != null ? String(saleCosts.find(c => c.type === 'advertising')!.amount) : '', auction_fees: saleCosts.find(c => c.type === 'auction_fees')?.amount != null ? String(saleCosts.find(c => c.type === 'auction_fees')!.amount) : '' }); setSoldError(null); setShowSoldModal(true) }}
                      style={{ padding: '7px 9px', background: '#f0f2f7', border: 'none', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#5c6478' }}>
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h9l4 5-4 5H2z"/>
                        <circle cx="5.5" cy="8" r="1.2"/>
                      </svg>
                    </button>
                    {/* Delete — active only */}
                    <button title="Delete property"
                      onClick={() => { setEditingDetails(false); setDeleteConfirm(''); setPropDeleteError(null); setShowDeleteModal(true) }}
                      style={{ padding: '7px 9px', background: '#fef2f2', border: 'none', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#c8332a' }}>
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9"/>
                      </svg>
                    </button>
                  </div>
                )}
                {property.status === 'sold' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {/* Un-sale — revert to active */}
                    <button title="Revert to active"
                      onClick={() => { setEditingDetails(false); unsaleProperty() }}
                      style={{ padding: '7px 10px', background: '#f0f2f7', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#5c6478', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 4v5h5"/><path d="M1.5 9A7 7 0 1 0 4 4.5"/>
                      </svg>
                      Un-sale
                    </button>
                  </div>
                )}
                <div style={{ flex: 1 }} />
                <button onClick={() => setEditingDetails(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                {isArchived ? (
                  <button onClick={async () => { setEditingDetails(false); await restoreProperty() }}
                    style={{ padding: '9px 18px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    Restore
                  </button>
                ) : property.status !== 'sold' ? (
                  <button onClick={async () => {
                      if (f.usage === 'mixed' && !f.mixed_use_investment_percent) { setOverviewError('Investment use % is required for mixed-use properties'); return }
                      const validCosts = acqForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).map(r => ({ type: r.type, amount: parseFloat(r.amount), description: r.description || null }))
                      await fetch('/api/properties/acquisition-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, costs: validCosts }) })
                      const newCosts = validCosts.map(c => ({ ...c, id: '', property_id: property.id, date: null, created_at: '' }) as PropertyAcquisitionCost)
                      setAcquisitionCosts(newCosts)
                      saveOverview({ name: f.name.trim() || undefined, street_address: f.street_address, suburb: f.suburb, state: f.state, postcode: f.postcode, usage: f.usage, mixed_use_investment_percent: f.usage === 'mixed' && f.mixed_use_investment_percent ? parseFloat(f.mixed_use_investment_percent) : null, purchase_date: f.purchase_date || null, settlement_date: f.settlement_date || null, purchase_price: f.purchase_price ? parseFloat(f.purchase_price) : null })
                    }}
                    disabled={overviewSaving} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {overviewSaving ? 'Saving…' : 'Save'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Insurance & PM Modal ─────────────────────────────────── */}
      {editingInsurance && (() => {
        const f = insuranceForm
        const isUnderConstruction = property.property_type === 'house_and_land' && property.construction_status !== 'completed'
        const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        const sectionHead = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', paddingBottom: 6, borderBottom: '1px solid #f0f2f7' }
        const saveUpdates: Record<string, unknown> = {
          insurance_provider: f.insurance_provider || null,
          insurance_policy_number: f.insurance_policy_number || null,
          insurance_expiry: f.insurance_expiry || null,
          insurance_premium: f.insurance_premium ? parseFloat(f.insurance_premium) : null,
        }
        if (isUnderConstruction) {
          saveUpdates.construction_builder = f.construction_builder || null
          saveUpdates.construction_contract_amount = f.construction_contract_amount ? parseFloat(f.construction_contract_amount) : null
          saveUpdates.construction_start_date = f.construction_start_date || null
          saveUpdates.capitalise_construction_interest = f.capitalise_construction_interest
          saveUpdates.construction_status = f.construction_status
        } else {
          saveUpdates.pm_agency = f.pm_agency || null
          saveUpdates.pm_name = f.pm_name || null
          saveUpdates.pm_phone = f.pm_phone || null
          saveUpdates.pm_email = f.pm_email || null
          saveUpdates.pm_fee_percent = f.pm_fee_percent ? parseFloat(f.pm_fee_percent) : null
          saveUpdates.lease_expiry_date = f.lease_expiry_date || null
        }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setEditingInsurance(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>
                  {isUnderConstruction ? 'Edit Insurance & Builder' : 'Edit Insurance & Property Manager'}
                </h2>
                <button onClick={() => setEditingInsurance(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={sectionHead}>Insurance</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Provider</label>
                    <input value={f.insurance_provider} onChange={e => setInsuranceForm(x => ({ ...x, insurance_provider: e.target.value }))} style={s} placeholder="e.g. Allianz" />
                  </div>
                  <div>
                    <label style={lbl}>Policy number</label>
                    <input value={f.insurance_policy_number} onChange={e => setInsuranceForm(x => ({ ...x, insurance_policy_number: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Expiry date</label>
                    <input type="date" value={f.insurance_expiry} onChange={e => setInsuranceForm(x => ({ ...x, insurance_expiry: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Annual premium</label>
                    <input type="number" step="10" value={f.insurance_premium} onChange={e => setInsuranceForm(x => ({ ...x, insurance_premium: e.target.value }))} style={s} placeholder="e.g. 1200" />
                  </div>
                </div>

                {isUnderConstruction ? (
                  <>
                    <div style={{ ...sectionHead, marginTop: 4 }}>Builder</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={lbl}>Builder name</label>
                        <input value={f.construction_builder} onChange={e => setInsuranceForm(x => ({ ...x, construction_builder: e.target.value }))} style={s} placeholder="e.g. Metricon" />
                      </div>
                      <div>
                        <label style={lbl}>Contract amount</label>
                        <input type="number" step="1000" value={f.construction_contract_amount} onChange={e => setInsuranceForm(x => ({ ...x, construction_contract_amount: e.target.value }))} style={s} placeholder="e.g. 550000" />
                      </div>
                      <div>
                        <label style={lbl}>Status</label>
                        <select value={f.construction_status} onChange={e => setInsuranceForm(x => ({ ...x, construction_status: e.target.value }))} style={s}>
                          <option value="pre_construction">Pre-Construction</option>
                          <option value="in_progress">In Progress</option>
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>{f.construction_status === 'in_progress' ? 'Start date' : 'Est. start date'}</label>
                        <input type="date" value={f.construction_start_date} onChange={e => setInsuranceForm(x => ({ ...x, construction_start_date: e.target.value }))} style={s} />
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={f.capitalise_construction_interest} onChange={e => setInsuranceForm(x => ({ ...x, capitalise_construction_interest: e.target.checked }))} style={{ marginTop: 2, accentColor: NAVY, width: 15, height: 15, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Capitalise construction interest</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Interest added to cost base instead of claimed as a deduction</div>
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <div style={{ ...sectionHead, marginTop: 4 }}>Property Manager</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={lbl}>Agency</label>
                        <input value={f.pm_agency} onChange={e => setInsuranceForm(x => ({ ...x, pm_agency: e.target.value }))} style={s} />
                      </div>
                      <div>
                        <label style={lbl}>Contact name</label>
                        <input value={f.pm_name} onChange={e => setInsuranceForm(x => ({ ...x, pm_name: e.target.value }))} style={s} />
                      </div>
                      <div>
                        <label style={lbl}>Phone</label>
                        <input value={f.pm_phone} onChange={e => setInsuranceForm(x => ({ ...x, pm_phone: e.target.value }))} style={s} />
                      </div>
                      <div>
                        <label style={lbl}>Email</label>
                        <input type="email" value={f.pm_email} onChange={e => setInsuranceForm(x => ({ ...x, pm_email: e.target.value }))} style={s} />
                      </div>
                      <div>
                        <label style={lbl}>Management fee (%)</label>
                        <input type="number" step="0.1" value={f.pm_fee_percent} onChange={e => setInsuranceForm(x => ({ ...x, pm_fee_percent: e.target.value }))} style={s} placeholder="e.g. 8.5" />
                      </div>
                      <div>
                        <label style={lbl}>Lease expiry <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                        <input type="date" value={f.lease_expiry_date} onChange={e => setInsuranceForm(x => ({ ...x, lease_expiry_date: e.target.value }))} style={s} />
                      </div>
                    </div>
                  </>
                )}
                {overviewError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {overviewError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setEditingInsurance(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button onClick={() => saveOverview(saveUpdates)} disabled={overviewSaving} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {overviewSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Acquisition Costs Modal ─────────────────────────────── */}
      {/* ── Depreciation Parse Review Modal ─────────────────────── */}
      {deprPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setDeprPreview(null) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 3px' }}>Review Parsed Schedule</h2>
                <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Check the extracted figures before saving. Conflicts will overwrite existing entries.</div>
              </div>
              <button onClick={() => setDeprPreview(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Source</label>
                <input value={deprPreviewSource} onChange={e => setDeprPreviewSource(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e4e7f0' }}>
                    <th style={{ textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#9ca3af', paddingBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Year</th>
                    <th style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: '#9ca3af', paddingBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Plant &amp; Equip (Div 40)</th>
                    <th style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: '#9ca3af', paddingBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Building (Div 43)</th>
                    <th style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: '#9ca3af', paddingBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {deprPreview.map((e, i) => (
                    <tr key={e.financial_year} style={{ borderBottom: '1px solid #f0f2f7', background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                      <td style={{ padding: '10px 0' }}>
                        <span style={{ fontWeight: 700, color: '#1a1e2e' }}>{e.financial_year}</span>
                        {e.conflict && (
                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '2px 6px' }}>will overwrite</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right' }}>
                        <input type="number" step="0.01" min="0" value={e.plant_equipment_amount}
                          onChange={ev => setDeprPreview(prev => prev!.map((r, ri) => ri === i ? { ...r, plant_equipment_amount: Number(ev.target.value) || 0 } : r))}
                          style={{ width: 100, padding: '4px 8px', border: '1px solid #e4e7f0', borderRadius: 6, fontSize: 12.5, textAlign: 'right', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right' }}>
                        <input type="number" step="0.01" min="0" value={e.division_43_amount}
                          onChange={ev => setDeprPreview(prev => prev!.map((r, ri) => ri === i ? { ...r, division_43_amount: Number(ev.target.value) || 0 } : r))}
                          style={{ width: 100, padding: '4px 8px', border: '1px solid #e4e7f0', borderRadius: 6, fontSize: 12.5, textAlign: 'right', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 700, color: '#c8332a', fontSize: 12.5 }}>
                        ({formatCurrency(e.plant_equipment_amount + e.division_43_amount)})
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right' as const }}>
                        <button onClick={() => setDeprPreview(prev => prev!.filter((_, ri) => ri !== i))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {deprParseError && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>{deprParseError}</div>
              )}
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #f0f2f7', paddingTop: 16 }}>
              <button onClick={() => setDeprPreview(null)}
                style={{ padding: '9px 20px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#374151' }}>
                Cancel
              </button>
              <button onClick={handleDeprConfirm} disabled={deprConfirming || deprPreview.length === 0}
                style={{ padding: '9px 20px', background: deprConfirming ? '#9ca3af' : NAVY, color: deprConfirming ? '#fff' : GOLD, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: deprConfirming ? 'not-allowed' : 'pointer' }}>
                {deprConfirming ? 'Saving…' : `Save ${deprPreview.length} Year${deprPreview.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate Depreciation Schedule Modal ────────────────── */}
      {deprGenOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setDeprGenOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 2px' }}>Generate Div 43 Schedule</h2>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>ATO formula: construction cost × 2.5% per year (40 years)</div>
              </div>
              <button onClick={() => setDeprGenOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Schedule Start Date</label>
                <input type="date" value={deprGenForm.schedule_start}
                  onChange={e => setDeprGenForm(f => ({ ...f, schedule_start: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Usually your settlement date. Year 1 is pro-rated from this date to 30 June.</div>
              </div>

              <div style={{ paddingTop: 4, borderTop: '1px solid #f0f2f7' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 10 }}>Division 43 — Building Works</div>
                <div>
                  <label style={{ fontSize: 11, color: '#5c6478', display: 'block', marginBottom: 5 }}>Annual deduction (flat, straight-line)</label>
                  <input type="text" inputMode="numeric" placeholder="e.g. 15928"
                    value={deprGenForm.div43_annual}
                    onChange={e => setDeprGenForm(f => ({ ...f, div43_annual: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Same amount every year for 40 years. Year 1 is pro-rated by days.</div>
                </div>
              </div>

              <div style={{ paddingTop: 4, borderTop: '1px solid #f0f2f7' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 10 }}>Division 40 — Plant &amp; Equipment <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#9ca3af' }}>(optional)</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#5c6478', display: 'block', marginBottom: 5 }}>Year 1 deduction</label>
                    <input type="text" inputMode="numeric" placeholder="e.g. 6261"
                      value={deprGenForm.div40_year1}
                      onChange={e => setDeprGenForm(f => ({ ...f, div40_year1: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#5c6478', display: 'block', marginBottom: 5 }}>Effective life</label>
                    <select value={deprGenForm.div40_life}
                      onChange={e => setDeprGenForm(f => ({ ...f, div40_life: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', background: '#fff' }}>
                      <option value="5">5 yrs (40% DV)</option>
                      <option value="7">7 yrs (29% DV)</option>
                      <option value="10">10 yrs (20% DV)</option>
                      <option value="13">13 yrs (15% DV)</option>
                      <option value="20">20 yrs (10% DV)</option>
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Diminishing value — amounts decrease each year. Use the Year 1 figure from your QS report.</div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Source <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#9ca3af' }}>(optional)</span></label>
                <input type="text" placeholder="e.g. BMT QS Report 2024"
                  value={deprGenForm.source}
                  onChange={e => setDeprGenForm(f => ({ ...f, source: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setDeprGenOpen(false)}
                style={{ padding: '9px 20px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#374151' }}>
                Cancel
              </button>
              <button onClick={handleDeprGenerate}
                disabled={(!deprGenForm.div43_annual && !deprGenForm.div40_year1) || !deprGenForm.schedule_start}
                style={{ padding: '9px 20px', background: ((!deprGenForm.div43_annual && !deprGenForm.div40_year1) || !deprGenForm.schedule_start) ? '#9ca3af' : NAVY, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: ((!deprGenForm.div43_annual && !deprGenForm.div40_year1) || !deprGenForm.schedule_start) ? 'not-allowed' : 'pointer' }}>
                Preview Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Depreciation Modal ──────────────────────────────────── */}
      {deprModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setDeprModalOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{deprEditing ? 'Edit Depreciation Year' : 'Add Depreciation Year'}</h2>
              <button onClick={() => setDeprModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {deprError && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a', marginBottom: 16 }}>{deprError}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Financial Year</label>
                  <select value={deprForm.financial_year} onChange={e => setDeprForm(f => ({ ...f, financial_year: e.target.value }))}
                    disabled={!!deprEditing}
                    style={{ width: '100%', padding: '9px 12px', border: `1px solid ${!deprEditing && localDepreciation.some(d => d.financial_year === deprForm.financial_year) ? '#f97316' : '#e4e7f0'}`, borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', background: deprEditing ? '#f8fafc' : '#fff' }}>
                    {['FY14','FY15','FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25','FY26','FY27','FY28','FY29','FY30'].map(fy => (
                      <option key={fy} value={fy}>{fy}</option>
                    ))}
                  </select>
                  {!deprEditing && localDepreciation.some(d => d.financial_year === deprForm.financial_year) && (
                    <div style={{ fontSize: 11, color: '#92400e', marginTop: 4, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '5px 9px' }}>
                      ⚠ {deprForm.financial_year} already has an entry — saving will overwrite it.
                    </div>
                  )}
                  {deprEditing && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>To change the year, delete this entry and re-add.</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Plant &amp; Equip (Div 40)</label>
                    <input type="number" step="0.01" min="0" value={deprForm.plant_equipment}
                      onChange={e => setDeprForm(f => ({ ...f, plant_equipment: e.target.value }))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Building (Div 43)</label>
                    <input type="number" step="0.01" min="0" value={deprForm.division_43}
                      onChange={e => setDeprForm(f => ({ ...f, division_43: e.target.value }))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                    Source <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#9ca3af' }}>(optional)</span>
                  </label>
                  <input value={deprForm.source} onChange={e => setDeprForm(f => ({ ...f, source: e.target.value }))}
                    placeholder="e.g. BMT QS Report 2024"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                    Notes <span style={{ fontWeight: 400, textTransform: 'none' as const, color: '#9ca3af' }}>(optional)</span>
                  </label>
                  <textarea value={deprForm.notes} onChange={e => setDeprForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', resize: 'vertical' as const, fontFamily: 'inherit', boxSizing: 'border-box' as const }} />
                </div>
              </div>
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeprModalOpen(false)}
                style={{ padding: '9px 20px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#374151' }}>
                Cancel
              </button>
              <button onClick={handleSaveDepr} disabled={deprSaving}
                style={{ padding: '9px 20px', background: deprSaving ? '#9ca3af' : NAVY, color: deprSaving ? '#fff' : GOLD, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: deprSaving ? 'not-allowed' : 'pointer' }}>
                {deprSaving ? 'Saving…' : deprEditing ? 'Save Changes' : 'Add Year'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAcqCosts && (() => {
        const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setEditingAcqCosts(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Edit Acquisition Costs</h2>
                <button onClick={() => setEditingAcqCosts(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['stamp_duty', 'legal_conveyancing', 'building_inspection', 'buyers_agent', 'loan_establishment'] as AcquisitionCostType[]).map(type => {
                  const existing = acqForm.find(r => r.type === type)
                  return (
                    <div key={type} style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'center' }}>
                      <label style={{ fontSize: 12.5, color: '#5c6478' }}>{ACQ_LABELS[type]}</label>
                      <input type="number" step="100" placeholder="—"
                        value={existing?.amount ?? ''}
                        onChange={e => {
                          const val = e.target.value
                          setAcqForm(prev => {
                            const filtered = prev.filter(r => r.type !== type)
                            return val ? [...filtered, { type, amount: val, description: '' }] : filtered
                          })
                        }}
                        style={{ ...s, textAlign: 'right' }} />
                    </div>
                  )
                })}
                {acqForm.filter(r => r.type === 'other').map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 8, alignItems: 'center' }}>
                    <input value={row.description} placeholder="Description"
                      onChange={e => setAcqForm(prev => prev.map((r) => r.type === 'other' && acqForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, description: e.target.value } : r))}
                      style={{ ...s, fontSize: 12.5 }} />
                    <input type="number" step="100" value={row.amount}
                      onChange={e => setAcqForm(prev => prev.map((r) => r.type === 'other' && acqForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, amount: e.target.value } : r))}
                      style={{ ...s, textAlign: 'right' }} />
                    <button onClick={() => { const idx = acqForm.filter(x => x.type === 'other').indexOf(row); setAcqForm(prev => prev.filter(r => !(r.type === 'other' && prev.filter(x => x.type === 'other').indexOf(r) === idx))) }}
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#c8332a', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '4px 6px' }}>×</button>
                  </div>
                ))}
                <button onClick={() => setAcqForm(prev => [...prev, { type: 'other', amount: '', description: '' }])}
                  style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#5c6478', cursor: 'pointer' }}>
                  + Add other cost
                </button>
                {acqError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {acqError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setEditingAcqCosts(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button disabled={acqSaving} onClick={async () => {
                  setAcqSaving(true); setAcqError(null)
                  try {
                    const validCosts = acqForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).map(r => ({ type: r.type, amount: parseFloat(r.amount), description: r.description || null }))
                    const res = await fetch('/api/properties/acquisition-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, costs: validCosts }) })
                    const data = await res.json()
                    if (data.error) { setAcqError(data.error); return }
                    setAcquisitionCosts(validCosts.map(c => ({ ...c, id: '', property_id: property.id, date: null, created_at: '' }) as PropertyAcquisitionCost))
                    setEditingAcqCosts(false)
                  } catch { setAcqError('Network error') }
                  finally { setAcqSaving(false) }
                }} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {acqSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Sale Costs Modal ────────────────────────────────────── */}
      {editingSaleCosts && (() => {
        const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setEditingSaleCosts(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Edit Sale Details</h2>
                <button onClick={() => setEditingSaleCosts(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Sale date + price */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Sale date</label>
                    <input type="date" value={soldForm.sold_date} onChange={e => setSoldForm(x => ({ ...x, sold_date: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Sale price</label>
                    <input type="number" step="1000" value={soldForm.sold_price} onChange={e => setSoldForm(x => ({ ...x, sold_price: e.target.value }))} style={{ ...s, textAlign: 'right' as const }} placeholder="—" />
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #e4e7f0', paddingTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 10 }}>Sale costs</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['agent_commission', 'legal_conveyancing', 'advertising', 'auction_fees'] as SaleCostType[]).map(type => {
                  const existing = saleForm.find(r => r.type === type)
                  return (
                    <div key={type} style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'center' }}>
                      <label style={{ fontSize: 12.5, color: '#5c6478' }}>{SALE_LABELS[type]}</label>
                      <input type="number" step="100" placeholder="—"
                        value={existing?.amount ?? ''}
                        onChange={e => {
                          const val = e.target.value
                          setSaleForm(prev => {
                            const filtered = prev.filter(r => r.type !== type)
                            return val ? [...filtered, { type, amount: val, description: '' }] : filtered
                          })
                        }}
                        style={{ ...s, textAlign: 'right' }} />
                    </div>
                  )
                })}
                {saleForm.filter(r => r.type === 'other').map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 8, alignItems: 'center' }}>
                    <input value={row.description} placeholder="Description"
                      onChange={e => setSaleForm(prev => prev.map((r) => r.type === 'other' && saleForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, description: e.target.value } : r))}
                      style={{ ...s, fontSize: 12.5 }} />
                    <input type="number" step="100" value={row.amount}
                      onChange={e => setSaleForm(prev => prev.map((r) => r.type === 'other' && saleForm.filter(x => x.type === 'other').indexOf(r) === i ? { ...r, amount: e.target.value } : r))}
                      style={{ ...s, textAlign: 'right' }} />
                    <button onClick={() => { const idx = saleForm.filter(x => x.type === 'other').indexOf(row); setSaleForm(prev => prev.filter(r => !(r.type === 'other' && prev.filter(x => x.type === 'other').indexOf(r) === idx))) }}
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#c8332a', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '4px 6px' }}>×</button>
                  </div>
                ))}
                <button onClick={() => setSaleForm(prev => [...prev, { type: 'other', amount: '', description: '' }])}
                  style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#5c6478', cursor: 'pointer' }}>
                  + Add other cost
                </button>
                  </div>
                </div>
                {saleError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {saleError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setEditingSaleCosts(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button disabled={saleSaving} onClick={async () => {
                  setSaleSaving(true); setSaleError(null)
                  try {
                    // Save sale date/price
                    const propRes = await fetch('/api/properties/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, updates: { sold_date: soldForm.sold_date || null, sold_price: soldForm.sold_price ? parseFloat(soldForm.sold_price) : null } }) })
                    const propData = await propRes.json()
                    if (propData.error) { setSaleError(propData.error); return }
                    // Save sale costs
                    const validCosts = saleForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).map(r => ({ type: r.type, amount: parseFloat(r.amount), description: r.description || null }))
                    const res = await fetch('/api/properties/sale-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, costs: validCosts }) })
                    const data = await res.json()
                    if (data.error) { setSaleError(data.error); return }
                    setSaleCosts(validCosts.map(c => ({ ...c, id: '', property_id: property.id, date: null, created_at: '' }) as PropertySaleCost))
                    setEditingSaleCosts(false)
                    router.refresh()
                  } catch { setSaleError('Network error') }
                  finally { setSaleSaving(false) }
                }} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {saleSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Mortgage Broker Modal ────────────────────────────────── */}
      {editingBroker && (() => {
        const f = brokerForm
        const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setEditingBroker(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Edit Mortgage Broker</h2>
                <button onClick={() => setEditingBroker(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Name</label>
                    <input value={f.broker_name} onChange={e => setBrokerForm(x => ({ ...x, broker_name: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Company</label>
                    <input value={f.broker_company} onChange={e => setBrokerForm(x => ({ ...x, broker_company: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Phone</label>
                    <input value={f.broker_phone} onChange={e => setBrokerForm(x => ({ ...x, broker_phone: e.target.value }))} style={s} />
                  </div>
                  <div>
                    <label style={lbl}>Email</label>
                    <input type="email" value={f.broker_email} onChange={e => setBrokerForm(x => ({ ...x, broker_email: e.target.value }))} style={s} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Credit licence</label>
                  <input value={f.broker_license} onChange={e => setBrokerForm(x => ({ ...x, broker_license: e.target.value }))} style={s} placeholder="ACL number" />
                </div>
                {overviewError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {overviewError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setEditingBroker(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button onClick={() => saveOverview({ broker_name: f.broker_name || null, broker_company: f.broker_company || null, broker_phone: f.broker_phone || null, broker_email: f.broker_email || null, broker_license: f.broker_license || null })}
                  disabled={overviewSaving} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {overviewSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Mark as Sold Modal ───────────────────────────────────── */}
      {showSoldModal && (() => {
        const inp: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setShowSoldModal(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Mark as Sold</h2>
                <button onClick={() => setShowSoldModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#5c6478', lineHeight: 1.5 }}>
                  All transactions, valuations and loan records are kept — you&apos;ll need them for CGT calculations. This is reversible.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Sale date *</label>
                    <input type="date" value={soldForm.sold_date} onChange={e => setSoldForm(x => ({ ...x, sold_date: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Sale price</label>
                    <input type="number" step="1000" value={soldForm.sold_price} onChange={e => setSoldForm(x => ({ ...x, sold_price: e.target.value }))} style={inp} placeholder="Optional" />
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #e4e7f0', paddingTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 10 }}>Sale costs (optional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {([
                      ['agent_commission', 'Agent commission'] as const,
                      ['legal_conveyancing', 'Legal / conveyancing'] as const,
                      ['advertising', 'Advertising'] as const,
                      ['auction_fees', 'Auction fees'] as const,
                    ]).map(([field, label]) => (
                      <div key={field}>
                        <label style={lbl}>{label}</label>
                        <input type="number" step="100" placeholder="—" value={(soldForm as Record<string, string>)[field]}
                          onChange={e => setSoldForm(x => ({ ...x, [field]: e.target.value }))}
                          style={{ ...inp, textAlign: 'right' as const }} />
                      </div>
                    ))}
                  </div>
                </div>
                {soldError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {soldError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowSoldModal(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button onClick={markAsSold} disabled={soldSaving}
                  style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {soldSaving ? 'Saving…' : 'Confirm Sale'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Delete Property Modal ─────────────────────────────────── */}
      {showDeleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteModal(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #fca5a5', background: '#fef2f2', borderRadius: '16px 16px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#c8332a' }}>Delete Property — Permanent</h2>
              <button onClick={() => setShowDeleteModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#92400e', lineHeight: 1.55 }}>
                This will <strong>permanently delete</strong> this property and all of its data — transactions, valuations, depreciation schedules, and acquisition costs. <strong>This cannot be undone.</strong><br /><br />
                If you&apos;ve sold this property, use <strong>Mark as Sold</strong> instead to keep your records for CGT purposes.
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                  Type <strong style={{ color: '#c8332a' }}>DELETE</strong> to confirm
                </label>
                <input value={deleteConfirm} onChange={e => { setDeleteConfirm(e.target.value.toUpperCase()); setPropDeleteError(null) }}
                  style={{ width: '100%', padding: '8px 11px', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} placeholder="DELETE" />
              </div>
              {propDeleteError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a', lineHeight: 1.5 }}>⚠ {propDeleteError}</div>}
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteModal(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
              <button onClick={deleteProperty} disabled={deleting2 || deleteConfirm !== 'DELETE'}
                style={{ padding: '9px 18px', background: deleteConfirm === 'DELETE' ? '#c8332a' : '#f0f2f7', color: deleteConfirm === 'DELETE' ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: deleteConfirm === 'DELETE' ? 'pointer' : 'default', transition: '.15s' }}>
                {deleting2 ? 'Deleting…' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Progress Payment Modal ─────────────────────── */}
      {ppModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setPpModalOpen(false); setPpEditId(null) } }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{ppEditId ? 'Edit Stage' : 'Add Stage'}</h2>
              <button onClick={() => { setPpModalOpen(false); setPpEditId(null) }} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(() => {
                const inp: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' }
                const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
                return (
                  <>
                    <div>
                      <label style={lbl}>Stage name <span style={{ color: '#c8332a' }}>*</span></label>
                      <input value={ppForm.stage_name} onChange={e => setPpForm(x => ({ ...x, stage_name: e.target.value }))}
                        style={{ ...inp, borderColor: ppError?.includes('Stage') ? '#fca5a5' : '#e4e7f0' }}
                        placeholder="e.g. Slab" />
                    </div>
                    {(() => {
                      const contract = property.construction_contract_amount
                      const hasC = contract != null && contract > 0
                      const otherTotal = progressPayments.filter(p => p.id !== ppEditId).reduce((s, p) => s + (p.amount ?? 0), 0)
                      const thisAmt = ppForm.amount ? parseFloat(ppForm.amount) : 0
                      const projected = otherTotal + thisAmt
                      const warn = hasC && ppForm.amount !== '' && Math.abs(projected - contract!) > 100
                      return (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: hasC ? '1fr 1fr' : '1fr', gap: 12 }}>
                            <div>
                              <label style={lbl}>Amount ($)</label>
                              <input type="number" step="100" value={ppForm.amount} onChange={e => ppAmountChange(e.target.value)} style={inp} placeholder="e.g. 48000" />
                            </div>
                            {hasC && (
                              <div>
                                <label style={lbl}>% of contract</label>
                                <input type="number" step="0.1" min="0" max="100" value={ppForm.percentage} onChange={e => ppPctChange(e.target.value)} style={inp} placeholder="e.g. 20" />
                              </div>
                            )}
                          </div>
                          {warn && (
                            <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', display: 'flex', gap: 8 }}>
                              <span>⚠</span>
                              <span>Stages will total {formatCurrency(projected)}{hasC ? ` (${((projected / contract!) * 100).toFixed(1)}%)` : ''} — contract is {formatCurrency(contract!)}. Check the amounts are correct before saving.</span>
                            </div>
                          )}
                        </>
                      )
                    })()}
                    <div>
                      <label style={lbl}>Scheduled date</label>
                      <input type="date" value={ppForm.scheduled_date} onChange={e => setPpForm(x => ({ ...x, scheduled_date: e.target.value }))} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Notes</label>
                      <input value={ppForm.notes} onChange={e => setPpForm(x => ({ ...x, notes: e.target.value }))} style={inp} placeholder="Optional" />
                    </div>
                  </>
                )
              })()}
              {ppError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {ppError}</div>}
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setPpModalOpen(false); setPpEditId(null) }} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
              <button onClick={saveProgressPayment} disabled={ppSaving}
                style={{ padding: '9px 18px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {ppSaving ? 'Saving…' : ppEditId ? 'Save Changes' : 'Add Stage'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Drawn Modal ─────────────────────────────────────── */}
      {ppDrawnId && (() => {
        const pp = progressPayments.find(p => p.id === ppDrawnId)
        const scheduledAmt = pp?.amount ?? null
        const bankVal = ppDrawnBank !== '' ? parseFloat(ppDrawnBank) : null
        const selfVal = ppDrawnSelf !== '' ? parseFloat(ppDrawnSelf) : null
        const enteredTotal = (bankVal ?? 0) + (selfVal ?? 0)
        const hasEnteredAny = bankVal != null || selfVal != null
        const diff = scheduledAmt != null && hasEnteredAny ? enteredTotal - scheduledAmt : null
        const hasMismatch = diff != null && Math.abs(diff) > 0.5
        const inp: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' }
        const isEditDraw = !!pp?.drawn_date
        const closeDrawn = () => { setPpDrawnId(null); setPpDrawnDate(''); setPpDrawnBank(''); setPpDrawnSelf(''); setPpDrawnError(null) }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) closeDrawn() }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 48px)' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{isEditDraw ? 'Edit Draw' : 'Mark as Drawn'} — {pp?.stage_name}</h2>
                <button onClick={closeDrawn} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
                {scheduledAmt != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e4e7f0' }}>
                    <span style={{ fontSize: 12.5, color: '#5c6478', fontWeight: 600 }}>Scheduled amount</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1e2e' }}>{formatCurrency(scheduledAmt)}</span>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Draw date</label>
                  <input type="date" value={ppDrawnDate} onChange={e => setPpDrawnDate(e.target.value)} style={inp} />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Leave blank to use today&apos;s date</div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>🏦 Lender ($)</label>
                    <input type="number" min="0" value={ppDrawnBank} onChange={e => setPpDrawnBank(e.target.value)} style={inp} placeholder="0.00" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>👤 Owner ($)</label>
                    <input type="number" min="0" value={ppDrawnSelf} onChange={e => setPpDrawnSelf(e.target.value)} style={inp} placeholder="0.00" />
                  </div>
                </div>
                {hasEnteredAny && (() => {
                  const isOver = hasMismatch && diff != null && diff > 0
                  const isUnder = hasMismatch && diff != null && diff < 0
                  const bg = isOver ? '#fef2f2' : isUnder ? '#f0fdf4' : '#f0fdf4'
                  const border = isOver ? '#fca5a5' : isUnder ? '#bbf7d0' : '#bbf7d0'
                  const color = isOver ? '#b91c1c' : '#15803d'
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: bg, borderRadius: 8, border: `1px solid ${border}` }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color }}>Total entered</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color }}>{formatCurrency(enteredTotal)}</span>
                      </div>
                      {hasMismatch && diff != null && (
                        <div style={{ padding: '9px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 8, fontSize: 12.5, color, display: 'flex', gap: 8 }}>
                          <span>{diff > 0 ? '⚠' : '✓'}</span>
                          <span>
                            Total entered is {formatCurrency(Math.abs(diff))} {diff > 0 ? 'overspent' : 'under (savings)'} vs the scheduled amount. Your figures will be saved as entered.
                          </span>
                        </div>
                      )}
                    </>
                  )
                })()}
                {!hasEnteredAny && <div style={{ fontSize: 11.5, color: '#9ca3af' }}>Both fields optional — leave blank if split is unknown.</div>}
                {ppDrawnError && (
                  <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {ppDrawnError}</div>
                )}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                {isEditDraw
                  ? <button onClick={() => undrawnPayment(ppDrawnId!)}
                      style={{ padding: '9px 14px', background: 'none', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: '#b91c1c' }}>
                      Undrawn
                    </button>
                  : <div />
                }
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={closeDrawn} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                  <button onClick={markDrawn} disabled={ppDrawnSaving}
                    style={{ padding: '9px 18px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    {ppDrawnSaving ? 'Saving…' : isEditDraw ? 'Save changes' : 'Mark drawn'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Begin Construction Modal (vacant land → H&L) ──────────── */}
      {showBeginConstruction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowBeginConstruction(false); setIsConstructionEdit(false) } }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{isConstructionEdit ? 'Edit Construction Details' : 'Begin Construction'}</h2>
              <button onClick={() => { setShowBeginConstruction(false); setIsConstructionEdit(false) }} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!isConstructionEdit && (
                <p style={{ margin: 0, fontSize: 13, color: '#5c6478', lineHeight: 1.5 }}>
                  This converts the property to House &amp; Land and begins tracking construction. All existing details are preserved.
                </p>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Construction status</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['pre_construction', 'in_progress'] as const).map(s => (
                    <button key={s} onClick={() => setBeginConstructionForm(x => ({ ...x, status: s }))}
                      style={{ flex: 1, padding: '8px 10px', border: `2px solid ${beginConstructionForm.status === s ? '#0369a1' : '#e4e7f0'}`, borderRadius: 8, background: beginConstructionForm.status === s ? '#eff6ff' : '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: beginConstructionForm.status === s ? '#0369a1' : '#5c6478' }}>
                      {s === 'pre_construction' ? 'Pre-construction' : 'In progress'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Builder name <span style={{ color: '#c8332a' }}>*</span></label>
                <input value={beginConstructionForm.builder} onChange={e => setBeginConstructionForm(x => ({ ...x, builder: e.target.value }))}
                  style={{ width: '100%', padding: '8px 11px', border: `1px solid ${beginConstructionError?.includes('Builder') ? '#fca5a5' : '#e4e7f0'}`, borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }}
                  placeholder="e.g. Metricon" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Build contract ($)</label>
                  <input type="number" step="1000" value={beginConstructionForm.contract_amount} onChange={e => setBeginConstructionForm(x => ({ ...x, contract_amount: e.target.value }))}
                    style={{ width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }}
                    placeholder="e.g. 320000" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                    {beginConstructionForm.status === 'in_progress' ? 'Date commenced' : 'Est. start date'}
                    {beginConstructionForm.status === 'in_progress' && <span style={{ color: '#c8332a' }}> *</span>}
                  </label>
                  <input type="date" value={beginConstructionForm.start_date} onChange={e => setBeginConstructionForm(x => ({ ...x, start_date: e.target.value }))}
                    style={{ width: '100%', padding: '8px 11px', border: `1px solid ${beginConstructionError?.includes('commenced') ? '#fca5a5' : '#e4e7f0'}`, borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#1a1e2e', userSelect: 'none' }}>
                <input type="checkbox" checked={beginConstructionForm.capitalise} onChange={e => setBeginConstructionForm(x => ({ ...x, capitalise: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#0369a1' }} />
                Capitalise construction interest
              </label>
              {beginConstructionError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {beginConstructionError}</div>}
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowBeginConstruction(false); setIsConstructionEdit(false) }} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
              <button onClick={beginConstruction} disabled={beginConstructionSaving}
                style={{ padding: '9px 18px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {beginConstructionSaving ? 'Saving…' : isConstructionEdit ? 'Save Changes' : 'Begin Construction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Construction Complete Modal ─────────────────────── */}
      {showCompleteConstruction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowCompleteConstruction(false) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Mark Construction Complete</h2>
              <button onClick={() => setShowCompleteConstruction(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#5c6478', lineHeight: 1.5 }}>
                This will mark the property as construction complete and record the final completion date. You can upload Form 21 or a builder handover document in the Documents tab.
              </p>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                  Completion date *
                </label>
                <input type="date" value={completionDate} onChange={e => setCompletionDate(e.target.value)}
                  style={{ width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              {completionError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {completionError}</div>}
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCompleteConstruction(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
              <button onClick={markConstructionComplete} disabled={completionSaving}
                style={{ padding: '9px 18px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {completionSaving ? 'Saving…' : 'Confirm Complete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Valuation Modal ─────────────────────────────── */}
      {showValuationModal && (() => {
        const inp: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box' }
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) setShowValuationModal(false) }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{editingValuationId ? 'Edit Valuation' : 'Add Valuation'}</h2>
                <button onClick={() => setShowValuationModal(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl}>Date <span style={{ color: '#c8332a' }}>*</span></label>
                    <input type="date" value={valForm.valuation_date} onChange={e => setValForm(f => ({ ...f, valuation_date: e.target.value }))}
                      style={{ ...inp, borderColor: valError && !valForm.valuation_date ? '#fca5a5' : '#e4e7f0' }} />
                  </div>
                  <div>
                    <label style={lbl}>Amount <span style={{ color: '#c8332a' }}>*</span></label>
                    <input type="number" min="0" step="1000" placeholder="e.g. 750000" value={valForm.amount}
                      onChange={e => setValForm(f => ({ ...f, amount: e.target.value }))}
                      style={{ ...inp, borderColor: valError && (!valForm.amount || parseFloat(valForm.amount) <= 0) ? '#fca5a5' : '#e4e7f0' }} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Type</label>
                  <select value={valForm.type} onChange={e => setValForm(f => ({ ...f, type: e.target.value }))}
                    style={{ ...inp }}>
                    <option value="bank_valuation">Bank valuation</option>
                    <option value="manual">Manual estimate</option>
                    <option value="corelogic_avm">CoreLogic AVM</option>
                    <option value="purchase_price">Purchase price</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Source / Valuer</label>
                  <input placeholder="e.g. ANZ Bank, CoreLogic" value={valForm.source}
                    onChange={e => setValForm(f => ({ ...f, source: e.target.value }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Notes</label>
                  <input placeholder="Optional notes" value={valForm.notes}
                    onChange={e => setValForm(f => ({ ...f, notes: e.target.value }))} style={inp} />
                </div>
                {valError && <div style={{ padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {valError}</div>}
              </div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowValuationModal(false)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
                <button onClick={saveValuation} disabled={valSaving}
                  style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {valSaving ? 'Saving…' : editingValuationId ? 'Save Changes' : 'Add Valuation'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Delete Valuation Confirm ────────────────────────────────── */}
      {showDrawLoanPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '26px 28px', maxWidth: 380, width: '90%', boxShadow: '0 8px 40px rgba(0,0,0,.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0c1929', marginBottom: 8 }}>Update loan balance?</div>
            <p style={{ fontSize: 13, color: '#5c6478', marginBottom: 22, lineHeight: 1.55 }}>
              Draw recorded. Would you like to update your loan balance to reflect this draw?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDrawLoanPrompt(false)}
                style={{ padding: '8px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                Not now
              </button>
              <button onClick={() => { setShowDrawLoanPrompt(false); setTab(1) }}
                style={{ padding: '8px 16px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Go to Finance tab
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteValuationId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteValuationId(null) }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #fca5a5', background: '#fef2f2', borderRadius: '16px 16px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#c8332a' }}>Delete Valuation</h2>
              <button onClick={() => setDeleteValuationId(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#5c6478', lineHeight: 1.6 }}>This valuation will be permanently removed. This cannot be undone.</p>
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteValuationId(null)} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>Cancel</button>
              <button onClick={() => deleteValuation(deleteValuationId)} disabled={valDeleteSaving}
                style={{ padding: '9px 18px', background: '#c8332a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {valDeleteSaving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
