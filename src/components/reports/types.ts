import type { Property, Loan, Transaction, Valuation, DepreciationSchedule, PropertyAcquisitionCost, LoanSecurity } from '@/lib/types/database'

export type FyLabel = 'FY20' | 'FY21' | 'FY22' | 'FY23' | 'FY24' | 'FY25' | 'FY26' | 'FY27'

export interface EnrichedLoan extends Loan {
  currentBalance: number
  ioExpiryDate: string | null
  securities: { propertyId: string; propertyName: string }[]
}

export interface PropertyReport {
  property: Property
  sharePercent: number
  latestValuation: number | null
  isValFallback: boolean
  activeLoans: EnrichedLoan[]
  allTransactions: Transaction[]
  depreciation: DepreciationSchedule[]
  allValuations: Valuation[]
  acquisitionCosts: PropertyAcquisitionCost[]
}

export type ReportType = 'portfolio' | 'property' | 'tax'

export const FY_OPTIONS: FyLabel[] = ['FY22', 'FY23', 'FY24', 'FY25', 'FY26']

// FY chart range — up to 10 years, limited to what has data
export const FY_CHART_RANGE: FyLabel[] = ['FY17', 'FY18', 'FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25', 'FY26'] as FyLabel[]

export function fyEndDate(fy: FyLabel): string {
  const year = parseInt(fy.replace('FY', ''), 10)
  return `20${String(year).padStart(2, '0')}-06-30`
}

export function fyStartDate(fy: FyLabel): string {
  const year = parseInt(fy.replace('FY', ''), 10)
  return `20${String(year - 1).padStart(2, '0')}-07-01`
}

export function fyDateRange(fy: FyLabel): { start: string; end: string } {
  return { start: fyStartDate(fy), end: fyEndDate(fy) }
}

export function fyLabel(fy: FyLabel): string {
  const year = parseInt(fy.replace('FY', ''), 10)
  return `${fy} — 1 Jul ${year - 1} to 30 Jun ${year}`
}

export function fyFullYear(fy: FyLabel): number {
  return 2000 + parseInt(fy.replace('FY', ''), 10)
}

/** Valuation for a property as of a given end date (most recent at or before that date) */
export function valuationAsOf(valuations: Valuation[], asOfDate: string, fallback: number | null): number | null {
  const v = valuations
    .filter(v => v.valuation_date <= asOfDate)
    .sort((a, b) => b.valuation_date.localeCompare(a.valuation_date))[0]
  return v?.amount ?? fallback
}
