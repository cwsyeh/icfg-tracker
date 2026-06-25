/**
 * Calculates the current outstanding balance of a loan using amortisation.
 * Works for both P&I and IO loans.
 */
export function calculateLoanBalance({
  originalAmount,
  annualRate,
  termYears,
  startDate,
  repaymentType,
  ioExpiryDate,
  ioPeriodYears = 0,
  asOfDate,
}: {
  originalAmount: number
  annualRate: number           // e.g. 6.13 (percent)
  termYears: number
  startDate: string            // ISO date string
  repaymentType: 'principal_and_interest' | 'interest_only' | 'interest_in_advance'
  ioExpiryDate?: string | null // preferred: IO expiry as a date
  ioPeriodYears?: number       // legacy fallback
  asOfDate?: string            // calculate balance at a past/future date instead of today
}): number {
  const monthlyRate = annualRate / 100 / 12
  const start = new Date(startDate)
  const ref = asOfDate ? new Date(asOfDate) : new Date()
  const monthsElapsed = Math.max(
    0,
    (ref.getFullYear() - start.getFullYear()) * 12 + (ref.getMonth() - start.getMonth())
  )

  if (repaymentType === 'interest_only' || repaymentType === 'interest_in_advance') {
    const ioMonths = ioExpiryDate
      ? Math.max(0, (new Date(ioExpiryDate).getFullYear() - start.getFullYear()) * 12 + (new Date(ioExpiryDate).getMonth() - start.getMonth()))
      : (ioPeriodYears ?? 0) * 12
    if (monthsElapsed <= ioMonths) return originalAmount
    const remainingMonths = termYears * 12 - ioMonths
    const piMonthsElapsed = monthsElapsed - ioMonths
    return piBalance(originalAmount, monthlyRate, remainingMonths, piMonthsElapsed)
  }

  return piBalance(originalAmount, monthlyRate, termYears * 12, monthsElapsed)
}

function piBalance(principal: number, monthlyRate: number, totalMonths: number, elapsed: number): number {
  if (monthlyRate === 0) return Math.max(0, principal - (principal / totalMonths) * elapsed)
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
    (Math.pow(1 + monthlyRate, totalMonths) - 1)
  const balance = principal * Math.pow(1 + monthlyRate, elapsed) -
    payment * (Math.pow(1 + monthlyRate, elapsed) - 1) / monthlyRate
  return Math.max(0, balance)
}

/** Returns the IO expiry date for a loan, or null if not IO */
export function getIOExpiryDate(startDate: string, ioPeriodYears: number | null): string | null {
  if (!ioPeriodYears) return null
  const d = new Date(startDate)
  d.setFullYear(d.getFullYear() + ioPeriodYears)
  return d.toISOString().split('T')[0]
}

/** Derives the financial year string (e.g. "FY26") from a date */
export function getFinancialYear(date: string | Date): string {
  const d = new Date(date)
  const year = d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear()
  return `FY${String(year).slice(-2)}`
}

/** Format as AUD currency */
export function formatCurrency(amount: number, showSign = false): string {
  const abs = Math.abs(amount)
  const formatted = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  if (amount < 0) return `(${formatted})`
  if (showSign && amount > 0) return `+${formatted}`
  return formatted
}

/** Format currency in compact form: $1.05M, $750k, $1.2k */
export function formatCompact(amount: number): string {
  const abs = Math.abs(amount)
  let result: string
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000
    result = `$${m % 1 === 0 ? m.toFixed(0) : m < 10 ? m.toFixed(2).replace(/\.?0+$/, '') : m.toFixed(1).replace(/\.?0+$/, '')}M`
  } else if (abs >= 1_000) {
    result = `$${Math.round(abs / 1_000)}k`
  } else {
    result = `$${Math.round(abs)}`
  }
  return amount < 0 ? `(${result})` : result
}

/** Format LVR as percentage */
export function formatLVR(loanBalance: number, propertyValue: number): string {
  if (propertyValue === 0) return '—'
  return `${Math.round((loanBalance / propertyValue) * 100)}%`
}
