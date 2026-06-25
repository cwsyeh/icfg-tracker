import type { TransactionType } from '@/lib/types/database'

export interface AtoScheduleLabel {
  label: string        // A–S letter from NAT 1836, or '' for income/calculated rows
  name: string         // ATO schedule line item name
  types: TransactionType[]   // transaction types that map to this label
  nonCash?: boolean    // Div 40/43 — pulled from depreciation_schedule, not transactions
  notClaimable?: boolean  // Label Q — travel, not deductible since Jul 2017
}

export const ATO_INCOME_LABELS: AtoScheduleLabel[] = [
  { label: '', name: 'Gross rent received', types: ['rent_income'] },
  { label: '', name: 'Other rental income', types: ['other_income'] },
]

export const ATO_EXPENSE_LABELS: AtoScheduleLabel[] = [
  { label: 'A', name: 'Advertising for tenants', types: ['advertising'] },
  { label: 'B', name: 'Body corporate fees and charges', types: ['strata_body_corp'] },
  { label: 'C', name: 'Borrowing expenses (amortised)', types: ['borrowing_expenses'] },
  { label: 'D', name: 'Capital allowances — depreciating assets (Div 40)', types: ['depreciation'], nonCash: true },
  { label: 'E', name: 'Capital works deduction (Div 43)', types: [], nonCash: true },
  { label: 'F', name: 'Cleaning', types: ['cleaning'] },
  { label: 'G', name: 'Council rates', types: ['council_rates'] },
  { label: 'H', name: 'Gardening and lawn mowing', types: ['repairs_maintenance'] },
  { label: 'I', name: 'Insurance', types: ['insurance'] },
  { label: 'J', name: 'Interest and finance charges', types: ['interest_expense'] },
  { label: 'K', name: 'Land tax', types: ['land_tax'] },
  { label: 'L', name: 'Legal expenses', types: ['legal_fees'] },
  { label: 'M', name: 'Pest control', types: ['repairs_maintenance'] },
  { label: 'N', name: 'Property agent fees and commissions', types: ['property_management_fee'] },
  { label: 'O', name: 'Repairs and maintenance', types: ['repairs_maintenance'] },
  { label: 'P', name: 'Stationery, postage and telephone', types: ['other_expense'] },
  { label: 'Q', name: 'Travel expenses', types: [], notClaimable: true },
  { label: 'R', name: 'Water charges', types: ['water_rates'] },
  { label: 'S', name: 'Sundry rental expenses', types: ['other_expense'] },
]

// Labels H, M, O all map to repairs_maintenance — only O is shown as the primary row.
// When building the ATO report, sum repairs_maintenance once under Label O.
// H and M are listed for ATO completeness but share the same source bucket.
export const PRIMARY_REPAIRS_LABEL = 'O'
