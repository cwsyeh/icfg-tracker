alter table construction_progress_payments
  add column if not exists funding_source text null check (funding_source in ('bank', 'self')),
  add column if not exists verified boolean not null default false,
  add column if not exists linked_transaction_id uuid null references transactions(id) on delete set null;
