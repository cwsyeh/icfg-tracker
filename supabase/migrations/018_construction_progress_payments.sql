create table if not exists construction_progress_payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  stage_name text not null,
  amount numeric(12,2) null,
  scheduled_date date null,
  drawn_date date null,
  sort_order int not null default 0,
  notes text null,
  created_at timestamptz not null default now()
);

alter table construction_progress_payments enable row level security;

create policy "Users manage own construction progress payments"
on construction_progress_payments
using (
  exists (
    select 1 from property_owners
    where property_owners.property_id = construction_progress_payments.property_id
      and property_owners.user_id = auth.uid()
  )
);
