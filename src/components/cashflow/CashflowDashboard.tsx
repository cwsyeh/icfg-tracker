'use client'

import { useState, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils/finance'
import MonthlyChart from './MonthlyChart'
import CashflowChart from './CashflowChart'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

export interface FYDetail {
  rentIncome: number
  otherIncome: number
  interestExpense: number
  otherExpenses: number
  depreciation: number
  capital: number
}

export interface FYRow {
  fy: string
  income: number
  expenses: number
  depreciation: number
  capital: number
  net: number
  detail: FYDetail
  byProperty: Record<string, { name: string; income: number; expenses: number; net: number }>
}

export interface MonthlyRow {
  month: string
  monthLabel: string
  fy: string
  income: number
  expenses: number
  net: number
}

interface Props {
  fyRows: FYRow[]
  monthlyData: MonthlyRow[]
  chartData: { fy: string; income: number; expenses: number; net: number }[]
  fyDetail: Record<string, FYDetail>
  properties: { id: string; name: string; usage: string }[]
}

function pct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function num(label: string, val: number, onChange: (v: number) => void) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          value={val}
          step={0.5}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{
            width: 64, padding: '5px 8px', fontSize: 13, fontWeight: 700,
            border: '1.5px solid #e4e7f0', borderRadius: 7, textAlign: 'right',
            outline: 'none', background: '#fff',
          }}
        />
        <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>%</span>
      </div>
    </div>
  )
}

const MONTH_ORDER: Record<string, number> = { Jul: 0, Aug: 1, Sep: 2, Oct: 3, Nov: 4, Dec: 5, Jan: 6, Feb: 7, Mar: 8, Apr: 9, May: 10, Jun: 11 }

export default function CashflowDashboard({ fyRows, monthlyData, chartData, fyDetail, properties: _props }: Props) {
  const allFYs = fyRows.map(r => r.fy)
  const defaultFY = allFYs[0] ?? ''

  const [tab, setTab] = useState<'actual' | 'forecast'>('actual')
  const [selectedFY, setSelectedFY] = useState(defaultFY)
  const [expandedFYs, setExpandedFYs] = useState<Set<string>>(() => new Set([defaultFY]))
  const [baseFY, setBaseFY] = useState(defaultFY)
  const [rentGrowth, setRentGrowth] = useState(3)
  const [cpiGrowth, setCpiGrowth] = useState(3)
  const [interestGrowth, setInterestGrowth] = useState(0)

  function toggleFY(fy: string) {
    setExpandedFYs(prev => {
      const next = new Set(prev)
      next.has(fy) ? next.delete(fy) : next.add(fy)
      return next
    })
  }

  // Monthly data for selected FY, sorted Jul-Jun
  const monthlyForFY = useMemo(() => {
    const rows = monthlyData.filter(m => m.fy === selectedFY)
    return rows.sort((a, b) => {
      const aLabel = a.monthLabel.split(' ')[0]
      const bLabel = b.monthLabel.split(' ')[0]
      return (MONTH_ORDER[aLabel] ?? 99) - (MONTH_ORDER[bLabel] ?? 99)
    })
  }, [monthlyData, selectedFY])

  // KPIs for selected FY
  const kfyRow = useMemo(() => fyRows.find(r => r.fy === selectedFY), [fyRows, selectedFY])

  // Gearing summary
  const gearing = useMemo(() => {
    if (!kfyRow) return { positive: 0, negative: 0 }
    const props = Object.values(kfyRow.byProperty)
    return { positive: props.filter(p => p.net >= 0).length, negative: props.filter(p => p.net < 0).length }
  }, [kfyRow])

  // Forecast
  const forecast = useMemo(() => {
    const base = fyDetail[baseFY]
    if (!base) return []
    const baseYear = 2000 + parseInt(baseFY.slice(2))
    return [0, 1, 2, 3].map(n => {
      const riF = Math.pow(1 + rentGrowth / 100, n)
      const exF = Math.pow(1 + cpiGrowth / 100, n)
      const inF = Math.pow(1 + interestGrowth / 100, n)
      const rentIncome = base.rentIncome * riF
      const otherIncome = base.otherIncome * riF
      const interestExpense = base.interestExpense * inF
      const otherExpenses = base.otherExpenses * exF
      const income = rentIncome + otherIncome
      const expenses = interestExpense + otherExpenses
      return {
        fy: `FY${String(baseYear + n).slice(-2)}`,
        isBase: n === 0,
        income, expenses, net: income + expenses,
        rentIncome, otherIncome, interestExpense, otherExpenses,
      }
    })
  }, [fyDetail, baseFY, rentGrowth, cpiGrowth, interestGrowth])

  const breakEven = forecast.find(r => r.net >= 0)
  const currentBase = forecast[0]

  // Style helpers
  const S = {
    card: {
      background: '#fff', borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)',
      padding: '18px 20px',
    } as React.CSSProperties,
    cardTitle: { fontSize: 13, fontWeight: 800, color: '#0c1929', marginBottom: 14 } as React.CSSProperties,
    kpiLabel: { fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 5 },
    netColor: (n: number) => n >= 0 ? '#2563a8' : '#d97706',
  }

  const no = fyRows.length === 0

  return (
    <div style={{
      padding: '24px 28px 56px', maxWidth: 1200, margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0c1929', margin: 0, marginBottom: 4 }}>
            Cashflow &amp; Forecast
          </h1>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: 0 }}>
            Cash income and expenses · excludes depreciation and capital items
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {tab === 'actual' && allFYs.length > 1 && (
            <select
              value={selectedFY}
              onChange={e => setSelectedFY(e.target.value)}
              style={{ fontSize: 12.5, padding: '7px 10px', borderRadius: 8, border: '1.5px solid #e4e7f0', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              {allFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 9, padding: 3 }}>
            {(['actual', 'forecast'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: tab === t ? 800 : 500,
                  background: tab === t ? '#fff' : 'transparent',
                  color: tab === t ? '#0c1929' : '#9ca3af',
                  boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
                  transition: '.15s',
                }}
              >
                {t === 'actual' ? 'Actual' : 'Forecast'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════ ACTUAL TAB ═══════════════════ */}
      {tab === 'actual' && (
        <>
          {/* ── KPI strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            {[
              { label: `${selectedFY} Gross Income`, value: formatCurrency(kfyRow?.income ?? 0), sub: 'Rent & other income', color: '#15803d' },
              { label: `${selectedFY} Total Expenses`, value: `(${formatCurrency(Math.abs(kfyRow?.expenses ?? 0))})`, sub: 'Deductible cash outflows', color: '#c8332a' },
              { label: `${selectedFY} Net Cashflow`, value: formatCurrency(kfyRow?.net ?? 0, true), sub: (kfyRow?.net ?? 0) >= 0 ? 'Positively geared' : 'Negatively geared', color: S.netColor(kfyRow?.net ?? 0) },
              { label: `${selectedFY} Depr. Shield`, value: formatCurrency(Math.abs(kfyRow?.depreciation ?? 0)), sub: 'Non-cash deduction', color: '#7c3aed' },
            ].map(k => (
              <div key={k.label} style={S.card}>
                <div style={S.kpiLabel}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{k.value}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Monthly chart + sidebar ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 296px', gap: 14, marginBottom: 14 }}>

            {/* Monthly chart */}
            <div style={{ ...S.card, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={S.cardTitle}>{selectedFY} Monthly Cashflow</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { color: '#15803d', label: 'Income' },
                    { color: '#fca5a5', label: 'Expenses' },
                    { color: '#2563a8', label: 'Net' },
                  ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#6b7280' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              </div>
              {no ? (
                <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                  No transaction data yet
                </div>
              ) : (
                <MonthlyChart data={monthlyForFY} />
              )}
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Gearing summary */}
              <div style={S.card}>
                <div style={S.cardTitle}>{selectedFY} Gearing Split</div>
                {no ? (
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>No data</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { label: 'Positively geared', count: gearing.positive, color: '#15803d', bg: '#f0fdf4' },
                        { label: 'Negatively geared', count: gearing.negative, color: '#c8332a', bg: '#fef2f2' },
                      ].map(g => (
                        <div key={g.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: g.bg }}>
                          <span style={{ fontSize: 12, color: g.color, fontWeight: 600 }}>{g.label}</span>
                          <span style={{ fontSize: 18, fontWeight: 900, color: g.color }}>{g.count}</span>
                        </div>
                      ))}
                    </div>
                    {kfyRow && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                          Per property
                        </div>
                        {Object.values(kfyRow.byProperty).sort((a, b) => b.net - a.net).map(p => (
                          <div key={p.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f9fafb' }}>
                            <span style={{ fontSize: 11, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{p.name}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: S.netColor(p.net), fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                              {formatCurrency(p.net, true)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Annual trend mini */}
              {chartData.length > 1 && (
                <div style={{ ...S.card, padding: '16px 18px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0c1929', marginBottom: 10 }}>Annual Trend</div>
                  <CashflowChart data={chartData} />
                </div>
              )}
            </div>
          </div>

          {/* ── By-year table ── */}
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid #e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={S.cardTitle}>By Financial Year</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>Click a row to expand</div>
            </div>

            {no ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>
                No transactions recorded yet.
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 1fr 80px', gap: 12, padding: '10px 22px', borderBottom: '1px solid #f3f4f6' }}>
                  {['FY', 'Income', 'Expenses', 'Net Cashflow', ''].map(h => (
                    <div key={h} style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: h === '' || h === 'Expenses' || h === 'Net Cashflow' || h === 'Income' ? 'right' : 'left' }}>
                      {h}
                    </div>
                  ))}
                </div>
                {fyRows.map((r, idx) => {
                  const expanded = expandedFYs.has(r.fy)
                  const propRows = Object.values(r.byProperty).sort((a, b) => b.net - a.net)
                  return (
                    <div key={r.fy} style={{ borderBottom: idx < fyRows.length - 1 ? '1px solid #e4e7f0' : undefined }}>
                      <div
                        onClick={() => toggleFY(r.fy)}
                        style={{
                          display: 'grid', gridTemplateColumns: '90px 1fr 1fr 1fr 80px',
                          gap: 12, padding: '14px 22px', alignItems: 'center',
                          background: r.fy === selectedFY ? '#f8faff' : idx % 2 === 0 ? '#fff' : '#fafafa',
                          cursor: 'pointer',
                          transition: 'background .1s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 900, color: '#0c1929' }}>{r.fy}</span>
                          {r.fy === allFYs[0] && (
                            <span style={{ fontSize: 9, fontWeight: 700, background: '#0c1929', color: '#f7c925', padding: '2px 6px', borderRadius: 4, letterSpacing: '.05em' }}>
                              LATEST
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatCurrency(r.income)}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#c8332a', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          ({formatCurrency(Math.abs(r.expenses))})
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: S.netColor(r.net), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatCurrency(r.net, true)}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>{expanded ? '▲' : '▼'} {propRows.length} props</span>
                        </div>
                      </div>

                      {expanded && propRows.map(p => (
                        <div
                          key={p.name}
                          style={{
                            display: 'grid', gridTemplateColumns: '90px 1fr 1fr 1fr 80px',
                            gap: 12, padding: '8px 22px 8px 36px',
                            background: '#f8fafc', borderTop: '1px solid #f0f2f5', alignItems: 'center',
                          }}
                        >
                          <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', gridColumn: '1 / 2' }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 11, color: '#374151', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {p.income > 0 ? formatCurrency(p.income) : <span style={{ color: '#d1d5db' }}>—</span>}
                          </div>
                          <div style={{ fontSize: 11, color: '#374151', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {p.expenses < 0 ? `(${formatCurrency(Math.abs(p.expenses))})` : <span style={{ color: '#d1d5db' }}>—</span>}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: S.netColor(p.net), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {formatCurrency(p.net, true)}
                          </div>
                          <div />
                        </div>
                      ))}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════ FORECAST TAB ═══════════════════ */}
      {tab === 'forecast' && (
        <>
          {no ? (
            <div style={{ padding: '60px', textAlign: 'center', background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
              <div style={{ fontSize: 14, color: '#9ca3af' }}>Add transactions to generate a cashflow forecast.</div>
            </div>
          ) : (
            <>
              {/* ── Assumptions panel ── */}
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
                  <div>
                    <div style={S.kpiLabel}>Base Year</div>
                    <select
                      value={baseFY}
                      onChange={e => setBaseFY(e.target.value)}
                      style={{ fontSize: 13, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e4e7f0', background: '#fff', cursor: 'pointer' }}
                    >
                      {allFYs.map(fy => <option key={fy} value={fy}>{fy} (Actual)</option>)}
                    </select>
                  </div>
                  <div style={{ width: 1, height: 36, background: '#e4e7f0', alignSelf: 'center' }} />
                  {num('Income / Rent growth', rentGrowth, setRentGrowth)}
                  {num('Expenses (CPI)', cpiGrowth, setCpiGrowth)}
                  {num('Interest expense growth', interestGrowth, setInterestGrowth)}
                  <div style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', maxWidth: 180, lineHeight: 1.5 }}>
                    Adjust sliders to model different rate and growth scenarios across the next 3 financial years.
                  </div>
                </div>
              </div>

              {/* ── Projection table + chart ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, marginBottom: 14 }}>

                {/* Projection table */}
                <div style={{ ...S.card, overflow: 'auto' }}>
                  <div style={S.cardTitle}>3-Year Cashflow Projection</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontWeight: 700, color: '#6b7280', paddingBottom: 10, borderBottom: '2px solid #e4e7f0', fontSize: 11 }}>
                          Category
                        </th>
                        {forecast.map(r => (
                          <th key={r.fy} style={{
                            textAlign: 'right', fontWeight: 800, paddingBottom: 10,
                            borderBottom: '2px solid #e4e7f0',
                            color: r.isBase ? '#0c1929' : '#2563a8',
                          }}>
                            {r.fy}
                            <div style={{ fontSize: 9, fontWeight: 600, color: r.isBase ? '#9ca3af' : '#93c5fd', marginTop: 2 }}>
                              {r.isBase ? 'ACTUAL' : 'PROJECTED'}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Income section */}
                      {[
                        { key: 'rentIncome', label: 'Rent income', color: '#374151' },
                        { key: 'otherIncome', label: 'Other income', color: '#374151' },
                      ].map(row => (
                        <tr key={row.key}>
                          <td style={{ padding: '8px 0 8px 12px', color: row.color, borderBottom: '1px solid #f3f4f6' }}>{row.label}</td>
                          {forecast.map(r => (
                            <td key={r.fy} style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#374151', borderBottom: '1px solid #f3f4f6' }}>
                              {formatCurrency(r[row.key as keyof typeof r] as number)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {/* Income total */}
                      <tr style={{ background: '#f0fdf4' }}>
                        <td style={{ padding: '10px 0 10px 12px', fontWeight: 800, color: '#15803d', borderBottom: '2px solid #d1fae5' }}>
                          Gross Income
                        </td>
                        {forecast.map(r => (
                          <td key={r.fy} style={{ padding: '10px 0', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#15803d', borderBottom: '2px solid #d1fae5' }}>
                            {formatCurrency(r.income)}
                          </td>
                        ))}
                      </tr>
                      {/* Expense rows */}
                      {[
                        { key: 'interestExpense', label: 'Interest expense', color: '#374151' },
                        { key: 'otherExpenses', label: 'Other expenses', color: '#374151' },
                      ].map(row => (
                        <tr key={row.key}>
                          <td style={{ padding: '8px 0 8px 12px', color: row.color, borderBottom: '1px solid #f3f4f6' }}>{row.label}</td>
                          {forecast.map(r => {
                            const v = r[row.key as keyof typeof r] as number
                            return (
                              <td key={r.fy} style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#374151', borderBottom: '1px solid #f3f4f6' }}>
                                ({formatCurrency(Math.abs(v))})
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {/* Expense total */}
                      <tr style={{ background: '#fef2f2' }}>
                        <td style={{ padding: '10px 0 10px 12px', fontWeight: 800, color: '#c8332a', borderBottom: '2px solid #fecaca' }}>
                          Total Expenses
                        </td>
                        {forecast.map(r => (
                          <td key={r.fy} style={{ padding: '10px 0', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#c8332a', borderBottom: '2px solid #fecaca' }}>
                            ({formatCurrency(Math.abs(r.expenses))})
                          </td>
                        ))}
                      </tr>
                      {/* Net row */}
                      <tr style={{ background: '#f8fafc' }}>
                        <td style={{ padding: '12px 0 12px 12px', fontWeight: 900, color: '#0c1929', fontSize: 13 }}>
                          Net Cashflow
                        </td>
                        {forecast.map(r => (
                          <td key={r.fy} style={{ padding: '12px 0', textAlign: 'right', fontWeight: 900, fontVariantNumeric: 'tabular-nums', fontSize: 13, color: S.netColor(r.net) }}>
                            {formatCurrency(r.net, true)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Right column: chart + insight */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* Forecast bar chart */}
                  <div style={{ ...S.card, padding: '18px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0c1929', marginBottom: 12 }}>Net Cashflow Trend</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={forecast} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <XAxis dataKey="fy" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                        <YAxis
                          tickFormatter={v => v === 0 ? '$0' : `${Math.round(v / 1000)}k`}
                          tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40}
                        />
                        <Tooltip
                          formatter={(v: unknown) => [formatCurrency(Number(v), true), 'Net Cashflow']}
                          contentStyle={{ fontSize: 12, border: '1px solid #e4e7f0', borderRadius: 8 }}
                          labelStyle={{ fontWeight: 700 }}
                        />
                        <ReferenceLine y={0} stroke="#e4e7f0" />
                        <Bar dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={40}>
                          {forecast.map((r, i) => (
                            <Cell key={i} fill={r.net >= 0 ? '#2563a8' : '#d97706'} fillOpacity={r.isBase ? 1 : 0.65} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>
                      Projected years shown at reduced opacity
                    </div>
                  </div>

                  {/* Insight card */}
                  <div style={{ ...S.card, background: '#f0f6ff', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', marginBottom: 10 }}>Forecast Insight</div>
                    {currentBase && (
                      <div style={{ fontSize: 12, color: '#1e3a8a', lineHeight: 1.6 }}>
                        {breakEven ? (
                          breakEven.isBase ? (
                            <>Portfolio is <strong>currently positively geared</strong> at {formatCurrency(currentBase.net, true)} net in {baseFY}. Projected to reach {formatCurrency(forecast[forecast.length - 1].net, true)} by {forecast[forecast.length - 1].fy}.</>
                          ) : (
                            <>Portfolio is currently negatively geared at {formatCurrency(currentBase.net, true)}. At these growth rates, it is projected to turn positive in <strong>{breakEven.fy}</strong> ({formatCurrency(breakEven.net, true)}).</>
                          )
                        ) : (
                          <>Portfolio is projected to remain negatively geared through {forecast[forecast.length - 1].fy} at current growth assumptions. Consider adjusting rent or expense assumptions.</>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 14, padding: '10px 12px', background: '#fff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                      <div style={{ fontSize: 10.5, color: '#6b7280', lineHeight: 1.5 }}>
                        <strong>Assumptions:</strong> Rent/income +{pct(rentGrowth)} p.a. · Expenses (CPI) +{pct(cpiGrowth)} p.a. · Interest {interestGrowth >= 0 ? '+' : ''}{pct(interestGrowth)} p.a.
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Non-cash items reference */}
              <div style={{ ...S.card, fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                <span style={{ fontWeight: 700, color: '#374151' }}>Note: </span>
                Depreciation and capital items are excluded from the cashflow projection. Forecast figures are indicative only and should be reviewed with your accountant. Actual interest costs depend on your current loan balances and rate movements.
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
