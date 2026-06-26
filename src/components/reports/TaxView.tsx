'use client'
import { useMemo, useState } from 'react'
import { formatCurrency, formatCompact } from '@/lib/utils/finance'
import { ATO_EXPENSE_LABELS } from '@/lib/utils/ato-categories'
import type { PropertyReport, FyLabel } from './types'
import { fyFullYear } from './types'

const SKIP_LABELS = new Set(['H', 'M', 'P', 'Q'])

const BRACKETS = [
  { label: '$0–$18,200', threshold: 0, rate: 19, effective: 0 },
  { label: '$18,201–$45,000', threshold: 18201, rate: 19, effective: 21 },
  { label: '$45,001–$135,000', threshold: 45001, rate: 32.5, effective: 34.5 },
  { label: '$135,001–$190,000', threshold: 135001, rate: 37, effective: 39 },
  { label: '$190,001+', threshold: 190001, rate: 45, effective: 47 },
]

function bracketForIncome(income: number) {
  return [...BRACKETS].reverse().find(b => income >= b.threshold) ?? BRACKETS[0]
}

interface Props {
  property: PropertyReport
  fy: FyLabel
}

const CARD: React.CSSProperties = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }

const EXP_GRID = '40px 100px 1fr 130px'

export default function TaxView({ property: p, fy }: Props) {
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set())
  const [taxableIncome, setTaxableIncome] = useState('')

  function toggleCode(code: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  const { grossRent, otherIncome, totalIncome, rentTxns, otherIncomeTxns, expenseRows, totalExpenses, netResult, interestByLoan, costBase } = useMemo(() => {
    const fyTxns = p.allTransactions.filter(t => t.financial_year === fy)
    const depEntry = p.depreciation.find(d => d.financial_year === fy)

    const rentTxns = fyTxns.filter(t => t.type === 'rent_income')
    const otherIncomeTxns = fyTxns.filter(t => t.type === 'other_income')
    const grossRent = rentTxns.reduce((s, t) => s + t.amount, 0)
    const otherIncome = otherIncomeTxns.reduce((s, t) => s + t.amount, 0)
    const totalIncome = grossRent + otherIncome

    const expenseRows = ATO_EXPENSE_LABELS.filter(l => !l.notClaimable && !SKIP_LABELS.has(l.label)).map(l => {
      let amount = 0
      let txns: typeof fyTxns = []
      if (l.nonCash) {
        amount = l.label === 'D' ? (depEntry?.plant_equipment_amount ?? 0) : (depEntry?.division_43_amount ?? 0)
        txns = []
      } else {
        txns = fyTxns.filter(t => l.types.includes(t.type as never) && t.amount < 0)
        amount = txns.reduce((s, t) => s + Math.abs(t.amount), 0)
      }
      return { label: l.label, name: l.name, amount, nonCash: !!l.nonCash, txns }
    }).filter(e => e.amount > 0)

    const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0)
    const netResult = totalIncome - totalExpenses

    const interestByLoan = p.activeLoans.map(loan => {
      const interest = fyTxns.filter(t => t.loan_id === loan.id && t.type === 'interest_expense').reduce((s, t) => s + Math.abs(t.amount), 0)
      return { loan, interest }
    }).filter(({ interest }) => interest > 0)

    const fyYear = fyFullYear(fy)
    const landPrice = p.property.purchase_price ?? 0
    const drawnBuildCost = p.property.property_type === 'house_and_land'
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
    const cumulativeDepreciation = cumulativeDiv40 + cumulativeDiv43
    const costBase = purchase + acquisitionTotal + capitalImprovements - cumulativeDepreciation

    return { grossRent, otherIncome, totalIncome, rentTxns, otherIncomeTxns, expenseRows, totalExpenses, netResult, interestByLoan, costBase: { purchase, landPrice, drawnBuildCost, acquisitionTotal, capitalImprovements, cumulativeDepreciation, cumulativeDiv40, cumulativeDiv43, total: costBase } }
  }, [p, fy])

  const prop = p.property
  const fyYear = fyFullYear(fy)

  const parsedIncome = taxableIncome ? parseFloat(taxableIncome.replace(/,/g, '')) : null
  const activeBracket = parsedIncome !== null ? bracketForIncome(parsedIncome) : BRACKETS[4]

  function ExpandedRows({ txns, isIncome }: { txns: typeof rentTxns; isIncome: boolean }) {
    return (
      <div style={{ background: isIncome ? '#f0fdf4' : '#f8faff', borderBottom: `1px solid ${isIncome ? '#bbf7d0' : '#dbeafe'}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: EXP_GRID, padding: '6px 22px', borderBottom: `1px solid ${isIncome ? '#bbf7d0' : '#dbeafe'}` }}>
          {['', 'Date', 'Label', 'Amount'].map((h, j) => (
            <div key={j} style={{ fontSize: 9.5, fontWeight: 700, color: isIncome ? '#4ade80' : '#93c5fd', textTransform: 'uppercase', letterSpacing: '.08em', textAlign: j === 3 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
        {txns.map(t => (
          <div key={t.id} style={{ display: 'grid', gridTemplateColumns: EXP_GRID, padding: '7px 22px', borderBottom: `1px solid ${isIncome ? '#dcfce7' : '#eff6ff'}`, fontSize: 12, alignItems: 'center' }}>
            <span />
            <span style={{ color: '#6b7280' }}>{t.transaction_date}</span>
            <span style={{ color: '#374151' }}>{t.description || '—'}</span>
            <span style={{ textAlign: 'right', color: isIncome ? '#15803d' : '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>
              {isIncome ? formatCurrency(t.amount) : `(${formatCurrency(Math.abs(t.amount))})`}
            </span>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: EXP_GRID, padding: '7px 22px', background: isIncome ? '#dcfce7' : '#eff6ff' }}>
          <span /><span />
          <span style={{ fontSize: 11, fontWeight: 700, color: isIncome ? '#15803d' : '#1d4ed8' }}>{txns.length} transaction{txns.length !== 1 ? 's' : ''}</span>
          <span style={{ textAlign: 'right', fontWeight: 800, color: isIncome ? '#15803d' : '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>
            {isIncome ? formatCurrency(txns.reduce((s, t) => s + t.amount, 0)) : `(${formatCurrency(txns.reduce((s, t) => s + Math.abs(t.amount), 0))})`}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Property header card */}
      <div style={CARD}>
        <div style={{ background: '#0c1929', padding: '20px 28px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#f7c925', marginBottom: 6 }}>ATO Tax Report — NAT 1836</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1.1 }}>{prop.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>{prop.street_address}, {prop.suburb} {prop.state}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{fy} — 1 Jul {fyYear - 1} to 30 Jun {fyYear}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 3 }}>{p.sharePercent}% ownership interest</div>
          </div>
        </div>
      </div>

      {/* ATO Schedule */}
      <div style={CARD}>
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Rental Property Schedule</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>Click a category to expand transactions</div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 20px 130px', padding: '8px 22px', borderBottom: '1.5px solid #e4e7f0', background: '#f9fafb' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em' }}>Code</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em' }}>Description</div>
          <div />
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'right' }}>Amount (AUD)</div>
        </div>

        {/* Income section header */}
        <div style={{ padding: '8px 22px 6px', background: '#fffbeb', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, background: '#f7c925', borderRadius: 2 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6b7280' }}>Income</span>
        </div>

        {/* Gross rent row — expandable */}
        {(() => {
          const isExpanded = expandedCodes.has('INCOME_RENT')
          const hasTxns = rentTxns.length > 0
          return (
            <div>
              <div
                onClick={() => hasTxns && toggleCode('INCOME_RENT')}
                style={{ display: 'grid', gridTemplateColumns: '40px 1fr 20px 130px', alignItems: 'center', padding: '10px 22px', borderBottom: '1px solid #f0f2f7', fontSize: 13, background: isExpanded ? '#f0fdf4' : '#fff', cursor: hasTxns ? 'pointer' : 'default' }}
              >
                <span style={{ fontSize: 10, color: '#d1d5db' }}></span>
                <span>Gross rent received</span>
                <span style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>{hasTxns ? (isExpanded ? '▲' : '▼') : ''}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(grossRent)}</span>
              </div>
              {isExpanded && hasTxns && <ExpandedRows txns={rentTxns} isIncome={true} />}
            </div>
          )
        })()}

        {/* Other income row — expandable */}
        {otherIncome > 0 && (() => {
          const isExpanded = expandedCodes.has('INCOME_OTHER')
          const hasTxns = otherIncomeTxns.length > 0
          return (
            <div>
              <div
                onClick={() => hasTxns && toggleCode('INCOME_OTHER')}
                style={{ display: 'grid', gridTemplateColumns: '40px 1fr 20px 130px', alignItems: 'center', padding: '10px 22px', borderBottom: '1px solid #f0f2f7', fontSize: 13, background: isExpanded ? '#f0fdf4' : '#fafafa', cursor: hasTxns ? 'pointer' : 'default' }}
              >
                <span />
                <span>Other rental income</span>
                <span style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>{hasTxns ? (isExpanded ? '▲' : '▼') : ''}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(otherIncome)}</span>
              </div>
              {isExpanded && hasTxns && <ExpandedRows txns={otherIncomeTxns} isIncome={true} />}
            </div>
          )
        })()}

        {/* Deductions section header */}
        <div style={{ padding: '8px 22px 6px', background: '#fff5f5', borderBottom: '1px solid #e4e7f0', borderTop: '2px solid #e4e7f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, background: '#ef4444', borderRadius: 2 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6b7280' }}>Deductions</span>
        </div>

        {expenseRows.length === 0 && (
          <div style={{ padding: '14px 22px', fontSize: 13, color: '#9ca3af' }}>No deductions recorded for {fy}</div>
        )}

        {expenseRows.map((e, i) => {
          const isExpanded = expandedCodes.has(e.label)
          const hasTransactions = e.txns.length > 0 && !e.nonCash
          return (
            <div key={e.label}>
              <div
                onClick={() => hasTransactions && toggleCode(e.label)}
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 20px 130px', alignItems: 'center', padding: '10px 22px',
                  borderBottom: '1px solid #f0f2f7', fontSize: 13,
                  background: isExpanded ? '#f0f6ff' : i % 2 === 1 ? '#fafafa' : '#fff',
                  cursor: hasTransactions ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af' }}>{e.label}</span>
                <span style={{ color: e.nonCash ? '#6b7280' : 'inherit', fontStyle: e.nonCash ? 'italic' : 'normal' }}>
                  {e.name}
                  {e.nonCash && <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6 }}>(non-cash)</span>}
                </span>
                <span style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
                  {hasTransactions ? (isExpanded ? '▲' : '▼') : ''}
                </span>
                <span style={{ textAlign: 'right', color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>({formatCurrency(e.amount)})</span>
              </div>
              {isExpanded && hasTransactions && <ExpandedRows txns={e.txns} isIncome={false} />}
            </div>
          )
        })}

        {/* Net result */}
        <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 20px 130px', alignItems: 'center', padding: '14px 22px', background: netResult < 0 ? '#fef2f2' : '#f0fdf4', borderTop: '2px solid #0c1929' }}>
          <span />
          <span style={{ fontSize: 15, fontWeight: 900 }}>Net Rental Result</span>
          <span />
          <span style={{ textAlign: 'right', fontSize: 15, fontWeight: 900, color: netResult < 0 ? '#b91c1c' : '#15803d', fontVariantNumeric: 'tabular-nums' }}>
            {netResult < 0 ? `(${formatCurrency(Math.abs(netResult))})` : formatCurrency(netResult)}
          </span>
        </div>
      </div>

      {/* Tax saving — income-based */}
      {netResult < 0 && (
        <div style={CARD}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Estimated Tax Saving</div>
            <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 4 }}>
              Rental loss of <strong style={{ color: '#111827' }}>{formatCurrency(Math.abs(netResult))}</strong> — assumes full offset against other income. Not tax advice; verify with your accountant.
            </div>
          </div>
          <div style={{ padding: '20px 24px 24px', display: 'flex', gap: 24, alignItems: 'stretch' }}>
            {/* Income input side */}
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 6 }}>
                Taxable income before this deduction
              </label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #e4e7f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <span style={{ padding: '0 10px', fontSize: 13, color: '#9ca3af', borderRight: '1px solid #e4e7f0', height: '100%', display: 'flex', alignItems: 'center', background: '#f9fafb' }}>$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 150,000"
                  value={taxableIncome}
                  onChange={e => setTaxableIncome(e.target.value)}
                  style={{ flex: 1, padding: '10px 12px', border: 'none', outline: 'none', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', background: 'transparent' }}
                />
              </div>
              {/* Bracket chips */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' as const }}>
                {BRACKETS.slice(1).map(b => (
                  <button
                    key={b.threshold}
                    onClick={() => setTaxableIncome(String(b.threshold))}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: '1px solid',
                      background: activeBracket.threshold === b.threshold ? '#0c1929' : 'transparent',
                      color: activeBracket.threshold === b.threshold ? '#f7c925' : '#9ca3af',
                      borderColor: activeBracket.threshold === b.threshold ? '#0c1929' : '#e4e7f0',
                    }}
                  >
                    {b.effective}%
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                {activeBracket.label} bracket — {activeBracket.rate}% tax + 2% Medicare levy = <strong style={{ color: '#374151' }}>{activeBracket.effective}% effective</strong>
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: 1, background: '#e4e7f0', flexShrink: 0 }} />

            {/* Result side */}
            <div style={{ minWidth: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>Est. tax saving</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#15803d', fontVariantNumeric: 'tabular-nums', lineHeight: 1, textAlign: 'right' }}>
                {formatCurrency(Math.abs(netResult) * activeBracket.effective / 100)}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, textAlign: 'right' }}>
                {activeBracket.effective}% of {formatCurrency(Math.abs(netResult))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loans with interest breakdown */}
      {p.activeLoans.length > 0 && (
        <div style={CARD}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Loan Details — {fy} Interest</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>Interest paid this financial year is claimed under Label J</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 110px 110px 80px 140px 130px', gap: 12, padding: '8px 22px', borderBottom: '1px solid #f0f2f7', background: '#f9fafb' }}>
            {[['Purpose', 'left'], ['Lender', 'left'], ['Limit', 'right'], ['Balance', 'right'], ['Rate', 'right'], ['Repayment', 'left'], [`${fy} Interest`, 'right']].map(([h, a]) => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: a as 'left' | 'right' }}>{h}</div>
            ))}
          </div>
          {p.activeLoans.map((loan, i) => {
            const fyInterest = interestByLoan.find(e => e.loan.id === loan.id)?.interest ?? null
            return (
              <div key={loan.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 110px 110px 80px 140px 130px', gap: 12, padding: '13px 22px', borderBottom: i < p.activeLoans.length - 1 ? '1px solid #e4e7f0' : 'none', alignItems: 'center', fontSize: 13 }}>
                <div style={{ color: '#6b7280', fontSize: 12 }}>{loan.purpose === 'investment' ? 'Investment' : 'Owner-occ.'}</div>
                <div>
                  <div style={{ fontWeight: 700 }}>{loan.lender}</div>
                  {loan.account_suffix && <div style={{ fontSize: 10.5, color: '#9ca3af' }}>…{loan.account_suffix}</div>}
                </div>
                <div style={{ textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{loan.loan_limit ? formatCompact(loan.loan_limit) : '—'}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCompact(loan.currentBalance)}</div>
                <div style={{ textAlign: 'right' }}>{loan.interest_rate.toFixed(2)}%</div>
                <div style={{ fontSize: 12 }}>{loan.repayment_type === 'interest_only' ? 'Interest Only' : 'P&I'}</div>
                <div style={{ textAlign: 'right', fontWeight: fyInterest ? 700 : 400, color: fyInterest ? '#b91c1c' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                  {fyInterest ? `(${formatCurrency(fyInterest)})` : 'No data'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Cost base — investment/mixed only */}
      {prop.usage !== 'ppor' && (prop.purchase_price || costBase.acquisitionTotal > 0) && (
        <div style={CARD}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Cost Base — As at 30 Jun {fyYear}</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>Relevant for CGT planning. Cost base reduces each year depreciation is claimed.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, padding: 1 }}>
            {[
              { label: 'Purchase Price', value: formatCurrency(costBase.purchase), sub: prop.property_type === 'house_and_land' ? `Land: ${formatCurrency(costBase.landPrice)} · Build drawn: ${formatCurrency(costBase.drawnBuildCost)}` : (prop.purchase_date ?? undefined) },
              { label: 'Acquisition Costs', value: formatCurrency(costBase.acquisitionTotal), sub: 'Stamp duty, legal, inspections etc.' },
              { label: 'Capital Improvements', value: formatCurrency(costBase.capitalImprovements), sub: 'Capital expenses to date' },
              { label: `Cumulative Depreciation (to ${fy})`, value: `(${formatCurrency(costBase.cumulativeDepreciation)})`, sub: `Div 40: ${formatCurrency(costBase.cumulativeDiv40)} · Div 43: ${formatCurrency(costBase.cumulativeDiv43)}`, neg: true },
            ].map(item => (
              <div key={item.label} style={{ padding: '16px 20px', background: '#fff', border: '1px solid #e4e7f0', margin: -1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: item.neg ? '#b91c1c' : '#111827', fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                {item.sub && <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 4 }}>{item.sub}</div>}
              </div>
            ))}
          </div>
          <div style={{ padding: '16px 24px', background: '#0c1929', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f7c925', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 5 }}>Adjusted Cost Base — {fy}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>
                {p.latestValuation && costBase.total > 0
                  ? <>If sold at {formatCompact(p.latestValuation)}, est. capital {p.latestValuation - costBase.total >= 0 ? 'gain' : 'loss'}: <strong style={{ color: p.latestValuation - costBase.total >= 0 ? '#4ade80' : '#fca5a5' }}>{formatCurrency(Math.abs(p.latestValuation - costBase.total))}</strong></>
                  : 'Enter purchase price to calculate capital gain/loss'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{formatCurrency(costBase.total)}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>cost base</div>
            </div>
          </div>
        </div>
      )}

      {/* ATO code legend */}
      <div style={CARD}>
        <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>ATO Schedule Reference — NAT 1836</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Labels A to S as defined in the ATO Rental Property schedule</div>
        </div>
        <div style={{ padding: '16px 22px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 28px' }}>
          {ATO_EXPENSE_LABELS.map(l => (
            <div key={l.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12 }}>
              <span style={{ fontWeight: 800, color: l.notClaimable ? '#d1d5db' : '#9ca3af', width: 16, flexShrink: 0, fontSize: 11 }}>{l.label}</span>
              <span style={{ color: l.notClaimable ? '#9ca3af' : '#374151', textDecoration: l.notClaimable ? 'line-through' : 'none' }}>{l.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
