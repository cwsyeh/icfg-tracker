'use client'
import { useMemo } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { formatCompact, calculateLoanBalance } from '@/lib/utils/finance'
import { FY_CHART_RANGE, fyEndDate, valuationAsOf } from './types'
import type { PropertyReport } from './types'

interface Props {
  properties: PropertyReport[]
}

const CARD: React.CSSProperties = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }

function compactTick(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${value}`
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.08)', fontSize: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: '#1a1a2e' }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{compactTick(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function PortfolioView({ properties }: Props) {
  const { rows, totalVal, totalDebt, totalEquity, portfolioLTV, allLoans, ioAlerts, chartData } = useMemo(() => {
    const rows = properties.map(p => {
      const pr = p.property
      const isSold = pr.status === 'sold'
      const isOtpPre = pr.property_type === 'off_the_plan' && pr.construction_status !== 'completed'
      const totalSaleCosts = (p.saleCosts ?? []).reduce((s, c) => s + c.amount, 0)
      const netProceeds = (pr.sold_price ?? 0) - totalSaleCosts
      const contractAmt = p.progressPayments.reduce((s, pp) => s + (pp.amount ?? 0), 0)
      const totalAcq = p.acquisitionCosts.reduce((s, c) => s + c.amount, 0)
      const totalCapEx = p.allTransactions.filter(t => t.type === 'capital_expense').reduce((s, t) => s + Math.abs(t.amount), 0)
      const totalDepr = p.depreciation.reduce((s, d) => s + (d.division_43_amount ?? 0) + (d.plant_equipment_amount ?? 0), 0)
      const costBase = (pr.purchase_price ?? 0) + contractAmt + totalAcq + totalCapEx - totalDepr
      const estimatedGain = isSold && pr.sold_price !== null ? netProceeds - costBase : null
      // Sold: show capital gain; OTP pre-completion: show deposit_paid (already in latestValuation)
      const val = isSold ? (estimatedGain ?? 0) : (p.latestValuation ?? 0)
      const debt = p.activeLoans.reduce((s, l) => s + l.currentBalance, 0)
      const equity = isSold ? null : val - debt
      const ltv = !isSold && !isOtpPre && val > 0 ? Math.round((debt / val) * 100) : null
      const currentYear = 'FY26'
      const grossRent = p.allTransactions.filter(t => t.financial_year === currentYear && t.type === 'rent_income').reduce((s, t) => s + t.amount, 0)
      const depEntry = p.depreciation.find(d => d.financial_year === currentYear)
      const nonCash = (depEntry?.division_43_amount ?? 0) + (depEntry?.plant_equipment_amount ?? 0)
      const totalExp = p.allTransactions.filter(t => t.financial_year === currentYear && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
      const netResult = grossRent - totalExp - nonCash
      const grossYield = val > 0 && grossRent > 0 ? (grossRent / val) * 100 : null
      const netYield = val > 0 && grossRent > 0 ? (netResult / val) * 100 : null
      return { p, val, debt, equity, ltv, grossRent, grossYield, netYield, isSold, isOtpPre, estimatedGain }
    })

    // All properties included: sold at capital gain, OTP at deposit_paid, active at valuation
    const totalVal = rows.reduce((s, r) => s + r.val, 0)
    const totalDebt = rows.reduce((s, r) => s + r.debt, 0)
    const totalEquity = totalVal - totalDebt
    const portfolioLTV = totalVal > 0 ? Math.round((totalDebt / totalVal) * 100) : 0

    const allLoans = properties.flatMap(p => p.activeLoans)
    const ioAlerts = allLoans.filter(l => {
      if (!l.ioExpiryDate) return false
      const months = (new Date(l.ioExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
      return months > 0 && months <= 6
    })

    // Dynamic chart range from earliest property purchase to current FY
    const earliestFy = properties.reduce((earliest: string | null, p) => {
      const startDate = p.property.settlement_date ?? p.property.purchase_date
      if (!startDate) return earliest
      const [y, m] = startDate.split('-').map(Number)
      const fy = `FY${String(m >= 7 ? y + 1 : y).slice(-2)}`
      return !earliest || fy < earliest ? fy : earliest
    }, null)
    const currentFy = FY_CHART_RANGE[FY_CHART_RANGE.length - 1]
    const chartStartYr = earliestFy ? 2000 + parseInt(earliestFy.slice(2)) : 2000 + parseInt(FY_CHART_RANGE[0].slice(2))
    const chartEndYr = 2000 + parseInt(currentFy.slice(2))
    const dynamicRange: string[] = Array.from({ length: chartEndYr - chartStartYr + 1 }, (_, i) => `FY${String(chartStartYr + i).slice(-2)}`)

    // Multi-year chart data
    const chartData = dynamicRange.map(fy => {
      const endDate = fyEndDate(fy as typeof FY_CHART_RANGE[number])
      const portfolioValue = properties.reduce((sum, p) => {
        const pr = p.property
        // Sold properties drop off after sold_date
        if (pr.status === 'sold' && pr.sold_date && endDate > pr.sold_date) return sum
        const fv = valuationAsOf(p.allValuations, endDate, null)
        if (fv !== null) return sum + fv
        if (!pr.purchase_date || pr.purchase_date > endDate) return sum
        const settled = pr.settlement_date ? pr.settlement_date <= endDate : true
        let fallback: number | null = null
        if (pr.property_type === 'off_the_plan') {
          fallback = settled ? (pr.purchase_price ?? 0) : (pr.deposit_paid ?? 0)
        } else if (pr.property_type === 'house_and_land') {
          const drawn = p.progressPayments
            .filter(pp => pp.drawn_date && pp.drawn_date <= endDate)
            .reduce((s, pp) => s + ((pp.bank_amount !== null || pp.self_amount !== null)
              ? (pp.bank_amount ?? 0) + (pp.self_amount ?? 0)
              : (pp.amount ?? 0)), 0)
          fallback = (pr.purchase_price ?? 0) + drawn
        } else {
          fallback = pr.purchase_price ?? 0
        }
        return sum + (fallback || 0)
      }, 0)
      const portfolioDebt = properties.reduce((sum, p) => {
        return sum + p.loans.reduce((ls, loan) => {
          if (loan.start_date > endDate) return ls
          if (loan.closed_date && loan.closed_date <= endDate) return ls
          const bal = calculateLoanBalance({
            originalAmount: loan.original_amount,
            annualRate: loan.interest_rate,
            termYears: loan.loan_term_years,
            startDate: loan.start_date,
            repaymentType: loan.repayment_type,
            ioPeriodYears: loan.io_period_years ?? 0,
            ioExpiryDate: loan.io_expiry_date,
            asOfDate: endDate,
          })
          return ls + bal
        }, 0)
      }, 0)
      const fyTxns = properties.flatMap(p => p.allTransactions.filter(t => t.financial_year === fy))
      const grossRent = fyTxns.filter(t => t.type === 'rent_income').reduce((s, t) => s + t.amount, 0)
      const totalCashExp = fyTxns.filter(t => t.amount < 0 && t.type !== 'principal_payment').reduce((s, t) => s + Math.abs(t.amount), 0)
      const depTotal = properties.reduce((s, p) => {
        const dep = p.depreciation.find(d => d.financial_year === fy)
        return s + (dep?.division_43_amount ?? 0) + (dep?.plant_equipment_amount ?? 0)
      }, 0)
      const cashNet = grossRent > 0 ? grossRent - totalCashExp : null
      const nonCash = grossRent > 0 ? -depTotal : null
      const netResult = cashNet !== null ? cashNet + (nonCash ?? 0) : null

      if (portfolioValue === 0 && grossRent === 0) return null
      return {
        fy: fy as string,
        Value: portfolioValue > 0 ? portfolioValue : undefined,
        Debt: portfolioDebt > 0 ? portfolioDebt : undefined,
        Equity: portfolioValue > 0 && portfolioDebt >= 0 ? portfolioValue - portfolioDebt : undefined,
        cashNet,
        nonCash,
        netResult,
        grossYield: portfolioValue > 0 && grossRent > 0 ? (grossRent / portfolioValue) * 100 : undefined,
      }
    }).filter(Boolean) as { fy: string; Value?: number; Debt?: number; Equity?: number; cashNet: number | null; nonCash: number | null; netResult: number | null; grossYield?: number }[]

    return { rows, totalVal, totalDebt, totalEquity, portfolioLTV, allLoans, ioAlerts, chartData }
  }, [properties])

  const hasChartData = chartData.length > 0
  const hasRentalData = chartData.some(d => d.netResult !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {ioAlerts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '11px 16px', fontSize: 12.5, color: '#92400e' }}>
          ⚠ <span><strong>IO expiry within 6 months</strong> — {ioAlerts.length} loan{ioAlerts.length !== 1 ? 's' : ''} approaching repayment switch. Review rates.</span>
        </div>
      )}

      {/* Summary + properties */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18 }}>
        {/* Hero summary card */}
        <div style={CARD}>
          <div style={{ background: '#0c1929', padding: '20px 22px 22px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 6 }}>Portfolio Value</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 16 }}>
              {totalVal > 0 ? formatCompact(totalVal) : '—'}
            </div>
            {[
              { label: 'Equity', amount: totalEquity, color: '#f7c925', pct: totalVal > 0 ? Math.max(0, (totalEquity / totalVal) * 100) : 0 },
              { label: 'Debt', amount: totalDebt, color: '#2563a8', pct: totalVal > 0 ? (totalDebt / totalVal) * 100 : 0 },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 6 }}>
                <span style={{ width: 40, textAlign: 'right', color: 'rgba(255,255,255,.4)', flexShrink: 0 }}>{row.label}</span>
                <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${row.pct}%`, height: '100%', background: row.color }} />
                </div>
                <span style={{ fontWeight: 700, color: '#fff', minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{formatCompact(Math.max(0, row.amount))}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'LTV', value: `${portfolioLTV}%` },
              { label: 'Properties', value: String(properties.length) },
              { label: 'Total Debt', value: formatCompact(totalDebt) },
              { label: 'Active Loans', value: String(allLoans.length) },
            ].map(s => (
              <div key={s.label} style={{ padding: '10px 12px', background: '#f0f2f7', borderRadius: 9 }}>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Property list */}
        <div style={CARD}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Properties — Current Snapshot</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 110px 90px 130px', gap: 16, padding: '8px 22px', borderBottom: '1px solid #f0f2f7' }}>
            {[['Property', 'left'], ['Debt / Equity', 'left'], ['Value', 'right'], ['LTV', 'right'], ['Gross / Net Yield', 'right']].map(([h, a]) => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: a as 'left' | 'right' }}>{h}</div>
            ))}
          </div>
          {rows.map(({ p, val, debt, equity, ltv, grossYield, netYield, isSold, isOtpPre, estimatedGain }) => {
            const ltvPct = ltv !== null ? Math.min(100, ltv) : null
            return (
              <div key={p.property.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 110px 90px 130px', gap: 16, padding: '14px 22px', borderBottom: '1px solid #e4e7f0', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{p.property.name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{p.property.suburb} {p.property.state}</div>
                </div>
                <div>
                  {!isSold && (
                    <>
                      <div style={{
                        height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 4,
                        background: ltvPct !== null
                          ? `linear-gradient(to right, #2563a8 ${ltvPct}%, #f7c925 ${ltvPct}%)`
                          : '#e4e7f0'
                      }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, fontWeight: 600 }}>
                        <span style={{ color: '#2563a8' }}>D {formatCompact(debt)}</span>
                        {equity !== null && equity > 0 ? <span style={{ color: '#92690d' }}>E {formatCompact(equity)}</span> : <span style={{ color: '#9ca3af' }}>No equity</span>}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{val > 0 ? formatCompact(val) : '—'}</div>
                  {isSold
                    ? <div style={{ fontSize: 9.5, color: '#9ca3af', marginTop: 1 }}>Est. capital gain</div>
                    : isOtpPre
                      ? <div style={{ fontSize: 9.5, color: '#b45309', marginTop: 1 }}>Deposit paid</div>
                      : p.isValFallback && <div style={{ fontSize: 9.5, color: '#9ca3af', marginTop: 1 }}>est. cost</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: ltv !== null && ltv > 100 ? '#dc2626' : ltv !== null && ltv > 80 ? '#b45309' : '#15803d' }}>
                    {ltv !== null ? `${ltv}%` : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{grossYield !== null ? `${grossYield.toFixed(1)}%` : '—'}</div>
                  <div style={{ fontSize: 11, color: netYield !== null && netYield < 0 ? '#dc2626' : '#9ca3af', marginTop: 2 }}>
                    {netYield !== null ? `Net ${netYield >= 0 ? '+' : ''}${netYield.toFixed(1)}%` : 'Not income-producing'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Charts row */}
      {hasChartData && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 18 }}>
          {/* Value / Debt / Equity trend */}
          <div style={CARD}>
            <div style={{ padding: '16px 22px 4px' }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Portfolio Growth</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Value, debt and equity over time</div>
            </div>
            <div style={{ padding: '8px 22px 20px' }}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
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

          {/* Net rental result by year */}
          {hasRentalData && (
            <div style={CARD}>
              <div style={{ padding: '16px 22px 4px' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Net Rental Result</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>After all expenses & depreciation</div>
              </div>
              <div style={{ padding: '8px 22px 20px' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData.filter(d => d.netResult !== null)} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} maxBarSize={20}>
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

      {/* Loan portfolio */}
      <div style={CARD}>
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Loan Portfolio</div>
        </div>
        {allLoans.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No active loans recorded</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 110px 110px 80px 140px 110px', gap: 12, padding: '8px 22px', borderBottom: '1px solid #f0f2f7' }}>
              {[['Purpose', 'left'], ['Lender', 'left'], ['Linked Securities', 'left'], ['Limit', 'right'], ['Balance', 'right'], ['Rate', 'right'], ['Repayment', 'left'], ['IO Expiry', 'right']].map(([h, a]) => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: a as 'left' | 'right' }}>{h}</div>
              ))}
            </div>
            {allLoans.map((loan, i) => {
              const ioMonths = loan.ioExpiryDate
                ? (new Date(loan.ioExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
                : null
              const taxProp = properties.find(p => p.property.id === loan.tax_property_id)
              const allSecurities = [
                ...(taxProp ? [taxProp.property.name] : []),
                ...loan.securities.filter(s => s.propertyId !== loan.tax_property_id).map(s => s.propertyName),
              ]
              return (
                <div key={loan.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr 110px 110px 80px 140px 110px', gap: 12, padding: '13px 22px', borderBottom: i < allLoans.length - 1 ? '1px solid #e4e7f0' : 'none', alignItems: 'center', fontSize: 13 }}>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{loan.purpose === 'investment' ? 'Investment' : loan.purpose === 'owner_occupied' ? 'Owner-occ.' : loan.purpose ?? '—'}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{loan.lender}</div>
                    {loan.account_suffix && <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 1 }}>…{loan.account_suffix}</div>}
                  </div>
                  <div>
                    {allSecurities.map((name, j) => (
                      <span key={j} style={{ display: 'inline-block', padding: '2px 6px', background: '#f0f2f7', color: '#374151', fontSize: 10, borderRadius: 4, marginRight: 4, marginBottom: 2 }}>{name}</span>
                    ))}
                    {allSecurities.length > 1 && (
                      <div style={{ fontSize: 9.5, color: '#b45309', marginTop: 2 }}>Cross-collateralised</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{loan.loan_limit ? formatCompact(loan.loan_limit) : '—'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCompact(loan.currentBalance)}</div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{loan.interest_rate.toFixed(2)}%</div>
                  <div style={{ fontSize: 12 }}>{loan.repayment_type === 'interest_only' ? 'Interest Only' : loan.repayment_type === 'principal_and_interest' ? 'P&I' : 'IO in advance'}</div>
                  <div style={{ textAlign: 'right', fontWeight: ioMonths !== null && ioMonths <= 6 ? 700 : 400, color: ioMonths !== null && ioMonths <= 3 ? '#dc2626' : ioMonths !== null && ioMonths <= 6 ? '#b45309' : '#374151' }}>
                    {loan.ioExpiryDate ?? '—'}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
