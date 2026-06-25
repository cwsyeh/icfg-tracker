alter table loans
  add column status text not null default 'active' check (status in ('active', 'closed')),
  add column closed_date date,
  add column refinanced_from_loan_id uuid references loans(id),
  add column purpose text check (purpose in ('investment', 'owner_occupied', 'mixed')),
  add column deductible_portion_percent numeric,
  add column loan_limit numeric;
