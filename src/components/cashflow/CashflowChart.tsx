'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { formatCurrency } from '@/lib/utils/finance'

interface FYRow {
  fy: string
  income: number
  expenses: number
  net: number
}

export default function CashflowChart({ data }: { data: FYRow[] }) {
  const chartData = [...data].reverse()

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={4}>
        <XAxis dataKey="fy" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={v => v === 0 ? '$0' : `${v >= 0 ? '+' : ''}${Math.round(v / 1000)}k`}
          tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48}
        />
        <Tooltip
          formatter={(v: unknown) => formatCurrency(Number(v))}
          contentStyle={{ fontSize: 12, border: '1px solid #e4e7f0', borderRadius: 8 }}
          labelStyle={{ fontWeight: 700, color: '#1a1e2e' }}
        />
        <ReferenceLine y={0} stroke="#e4e7f0" />
        <Bar dataKey="income" name="Income" fill="#15803d" radius={[3, 3, 0, 0]} maxBarSize={40} />
        <Bar dataKey="expenses" name="Expenses" fill="#c8332a" radius={[3, 3, 0, 0]} maxBarSize={40} />
        <Bar dataKey="net" name="Net" radius={[3, 3, 0, 0]} maxBarSize={40}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.net >= 0 ? '#2563a8' : '#d97706'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
