-- Actual balance tracking on loans (from uploaded statements or manual entry)
alter table loans
  add column actual_balance numeric(14,2),
  add column balance_date   date;

-- Extend upload_type enum to include loan statements
alter type upload_type add value 'loan_statement';

-- Extend upload_status to include pending_confirmation
alter type upload_status add value 'pending_confirmation';
