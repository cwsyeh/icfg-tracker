'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { formatCurrency } from '@/lib/utils/finance'
import MonthlyChart from '@/components/cashflow/MonthlyChart'
import type { MonthlyRow } from '@/components/cashflow/CashflowDashboard'

interface GrowthPoint {
  date: string
  label: string
  value: number
}

interface Props {
  cashflowData: MonthlyRow[]
  growthData: GrowthPoint[]
}

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)',
  padding: '20px 22px',
}

export default function PortfolioCharts({ cashflowData, growthData }: Props) {
  const firstVal = growthData[0]?.value ?? 0
  const lastVal = growthData[growthData.length - 1]?.value ?? 0
  const growthPct = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : null
  const growthAbs = lastVal - firstVal

  // Net cashflow for the 12-month period
  const totalIncome = cashflowData.reduce((s, m) => s + m.income, 0)
  const totalExpenses = cashflowData.reduce((s, m) => s + m.expenses, 0)
  const totalNet = totalIncome + totalExpenses

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>

      {/* ── 12-Month Cashflow ── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0c1929', marginBottom: 3 }}>
              Cashflow — Last 12 Months
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Cash income and expenses · excl. depreciation &amp; capital items
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: totalNet >= 0 ? '#2563a8' : '#d97706', fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(totalNet, true)}
            </div>
            <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 1 }}>net cashflow</div>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
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

        <MonthlyChart data={cashflowData} />

        {cashflowData.length === 0 && (
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
            No transactions in the last 12 months
          </div>
        )}
      </div>

      {/* ── Portfolio Growth ── */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0c1929', marginBottom: 3 }}>
              Portfolio Value
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Based on recorded valuations across all properties
            </div>
          </div>
          {growthPct !== null && growthData.length >= 2 && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: growthPct >= 0 ? '#15803d' : '#c8332a' }}>
                {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 1 }}>
                {growthAbs >= 0 ? '+' : ''}{formatCurrency(growthAbs)} since first valuation
              </div>
            </div>
          )}
        </div>

        {growthData.length < 2 ? (
          <div style={{ height: 254, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#9ca3af' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <div style={{ fontSize: 12 }}>Add valuations to track portfolio growth</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={254}>
            <AreaChart data={growthData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f7c925" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f7c925" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f0f0f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={v => {
                  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
                  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`
                  return `$${v}`
                }}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                formatter={(v: unknown) => [formatCurrency(Number(v)), 'Portfolio Value']}
                contentStyle={{ fontSize: 12, border: '1px solid #e4e7f0', borderRadius: 8, padding: '8px 12px' }}
                labelStyle={{ fontWeight: 700, color: '#0c1929', marginBottom: 2 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="Portfolio Value"
                stroke="#0c1929"
                strokeWidth={2.5}
                fill="url(#pgGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#0c1929', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
