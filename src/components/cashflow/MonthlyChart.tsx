'use client'

import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid, Cell,
} from 'recharts'
import { formatCurrency } from '@/lib/utils/finance'

interface MonthRow {
  month: string
  monthLabel: string
  income: number
  expenses: number
  net: number
}

export default function MonthlyChart({ data }: { data: MonthRow[] }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
        No transactions in this period
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis
          tickFormatter={v => v === 0 ? '$0' : `${v > 0 ? '' : '-'}${Math.round(Math.abs(v) / 1000)}k`}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          formatter={(v: unknown, name: unknown) => {
            const n = Number(v)
            const sign = n < 0 ? '-' : ''
            return [`${sign}${formatCurrency(Math.abs(n))}`, String(name)]
          }}
          contentStyle={{ fontSize: 12, border: '1px solid #e4e7f0', borderRadius: 8, padding: '8px 12px' }}
          labelStyle={{ fontWeight: 700, color: '#1a1e2e', marginBottom: 4 }}
        />
        <ReferenceLine y={0} stroke="#d1d5db" />
        <Bar dataKey="income" name="Income" fill="#15803d" radius={[2, 2, 0, 0]} maxBarSize={18} />
        <Bar dataKey="expenses" name="Expenses" radius={[0, 0, 2, 2]} maxBarSize={18}>
          {data.map((_, i) => <Cell key={i} fill="#fca5a5" />)}
        </Bar>
        <Line
          type="monotone"
          dataKey="net"
          name="Net"
          stroke="#2563a8"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#2563a8', strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
