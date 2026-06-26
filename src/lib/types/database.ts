export type UserRole = 'client' | 'broker' | 'admin'
export type PropertyStatus = 'active' | 'sold' | 'archived'
export type PropertyUsage = 'investment' | 'ppor' | 'mixed'
export type PropertyType = 'established' | 'house_and_land' | 'land' | 'off_the_plan'
export type ConstructionStatus = 'pre_construction' | 'in_progress' | 'completed'
export type ProjectType = 'construction' | 'renovation' | 'granny_flat'
export type ProjectStatus = 'planned' | 'in_progress' | 'completed'
export type AcquisitionCostType = 'stamp_duty' | 'legal_conveyancing' | 'building_inspection' | 'buyers_agent' | 'qs_report' | 'soil_test_da' | 'loan_establishment' | 'other'
export type SaleCostType = 'agent_commission' | 'legal_conveyancing' | 'advertising' | 'auction_fees' | 'other'
export type LoanRepaymentType = 'principal_and_interest' | 'interest_only' | 'interest_in_advance'
export type LoanRateType = 'variable' | 'fixed'
export type ValuationType = 'purchase_price' | 'bank_valuation' | 'corelogic_avm' | 'manual'
export type TransactionType =
  | 'rent_income' | 'interest_expense' | 'principal_payment'
  | 'council_rates' | 'water_rates' | 'insurance'
  | 'property_management_fee' | 'repairs_maintenance' | 'advertising'
  | 'legal_fees' | 'bank_fees' | 'strata_body_corp'
  | 'land_tax' | 'borrowing_expenses' | 'cleaning'
  | 'capital_expense' | 'depreciation'
  | 'other_income' | 'other_expense'
export type TransactionSource = 'manual' | 'rental_statement_parsed' | 'loan_auto'
export type UploadType = 'rental_statement' | 'depreciation_schedule' | 'loan_statement' | 'expense_document'
export type UploadStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'pending_confirmation'
export type InviteStatus = 'pending' | 'accepted' | 'expired'

export interface Tenant {
  id: string
  name: string
  subdomain: string
  branding: {
    primary_color: string
    secondary_color: string
    nav_color: string
    logo_url: string | null
  }
  created_at: string
}

export interface User {
  id: string
  tenant_id: string
  role: UserRole
  full_name: string
  email: string
  phone: string | null
  broker_id: string | null
  created_at: string
}

export interface Property {
  id: string
  tenant_id: string
  name: string
  street_address: string
  suburb: string
  state: string
  postcode: string
  usage: PropertyUsage
  mixed_use_investment_percent: number | null
  property_type: PropertyType
  land_value: number | null
  construction_builder: string | null
  construction_contract_amount: number | null
  construction_start_date: string | null
  construction_completion_date: string | null
  construction_status: ConstructionStatus | null
  capitalise_construction_interest: boolean
  status: PropertyStatus
  purchase_date: string | null
  settlement_date: string | null
  purchase_price: number | null
  deposit_paid: number | null
  sold_date: string | null
  sold_price: number | null
  broker_name: string | null
  broker_phone: string | null
  broker_email: string | null
  broker_company: string | null
  broker_license: string | null
  pm_agency: string | null
  pm_name: string | null
  pm_phone: string | null
  pm_email: string | null
  pm_fee_percent: number | null
  lease_expiry_date: string | null
  insurance_provider: string | null
  insurance_policy_number: string | null
  insurance_expiry: string | null
  insurance_premium: number | null
  photo_url: string | null
  notes: string | null
  created_at: string
}

export interface PropertyOwner {
  id: string
  property_id: string
  user_id: string
  share_percentage: number
  created_at: string
}

export interface PropertyInvite {
  id: string
  property_id: string
  inviter_id: string
  invitee_email: string
  share_percentage: number
  token: string
  status: InviteStatus
  expires_at: string
  created_at: string
}

export interface Loan {
  id: string
  tax_property_id: string
  lender: string
  account_suffix: string | null
  repayment_type: LoanRepaymentType
  rate_type: LoanRateType
  original_amount: number
  interest_rate: number
  loan_term_years: number
  io_period_years: number | null
  start_date: string
  fixed_rate_expiry: string | null
  io_expiry_date: string | null
  actual_balance: number | null
  balance_date: string | null
  rate_effective_date: string | null
  reforecast_balance: number | null
  reforecast_date: string | null
  outside_security_description: string | null
  outside_security_value: number | null
  notes: string | null
  status: 'active' | 'closed'
  closed_date: string | null
  refinanced_from_loan_id: string | null
  purpose: 'investment' | 'owner_occupied' | 'mixed' | null
  deductible_portion_percent: number | null
  loan_limit: number | null
  created_at: string
}

export interface LoanSecurity {
  id: string
  loan_id: string
  property_id: string
  created_at: string
}

export interface Valuation {
  id: string
  property_id: string
  valuation_date: string
  amount: number
  type: ValuationType
  source: string | null
  notes: string | null
  created_at: string
}

export interface Transaction {
  id: string
  property_id: string
  loan_id: string | null
  project_id: string | null
  transaction_date: string
  type: TransactionType
  amount: number
  description: string | null
  ownership_note: string | null
  financial_year: string
  source: TransactionSource
  manually_edited: boolean
  capitalised: boolean | null
  created_at: string
}

export interface PropertyAcquisitionCost {
  id: string
  property_id: string
  type: AcquisitionCostType
  amount: number
  description: string | null
  date: string | null
  created_at: string
}

export interface PropertySaleCost {
  id: string
  property_id: string
  type: SaleCostType
  amount: number
  description: string | null
  date: string | null
  created_at: string
}

export interface PropertyProject {
  id: string
  property_id: string
  type: ProjectType
  status: ProjectStatus
  name: string | null
  builder: string | null
  contract_amount: number | null
  start_date: string | null
  completion_date: string | null
  capitalise_interest: boolean
  qs_report_date: string | null
  notes: string | null
  created_at: string
}

export interface ConstructionProgressPayment {
  id: string
  property_id: string
  stage_name: string
  amount: number | null
  scheduled_date: string | null
  drawn_date: string | null
  bank_amount: number | null
  self_amount: number | null
  sort_order: number
  notes: string | null
  created_at: string
}

export interface DepreciationSchedule {
  id: string
  property_id: string
  financial_year: string
  division_43_amount: number
  plant_equipment_amount: number
  source: string | null
  notes: string | null
  created_at: string
}

export interface UploadJob {
  id: string
  property_id: string
  uploaded_by: string
  type: UploadType
  original_filename: string
  status: UploadStatus
  transactions_created: number
  error_message: string | null
  uploaded_at: string
  processed_at: string | null
}

// ── Computed/joined types used in the UI ──────────────────────

export interface PropertyWithOwnership extends Property {
  share_percentage: number
  current_valuation: number | null
  total_loan_balance: number | null
  equity: number | null
  ltv: number | null
}

export interface LoanBalance {
  id: string
  loan_id: string
  balance_date: string
  balance: number
  source: 'statement' | 'manual'
  created_at: string
}

export interface LoanWithBalance extends Loan {
  current_balance: number
  io_expiry_date: string | null
  security_properties: Pick<Property, 'id' | 'name'>[]
}
