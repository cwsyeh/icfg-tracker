-- Tracks historical loan balance snapshots so the Finance tab can plot actual paydown over time
create table loan_balances (
  id           uuid primary key default gen_random_uuid(),
  loan_id      uuid not null references loans(id) on delete cascade,
  balance_date date not null,
  balance      numeric(14,2) not null,
  source       text not null default 'statement', -- 'statement' | 'manual'
  created_at   timestamptz default now(),
  unique(loan_id, balance_date)
);

create index loan_balances_loan_id_idx on loan_balances(loan_id);
