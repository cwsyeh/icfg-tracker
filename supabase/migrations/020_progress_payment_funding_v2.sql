alter table construction_progress_payments
  add column if not exists bank_amount numeric(12,2) null,
  add column if not exists self_amount numeric(12,2) null;

alter table construction_progress_payments
  drop column if exists funding_source,
  drop column if exists verified,
  drop column if exists linked_transaction_id;
