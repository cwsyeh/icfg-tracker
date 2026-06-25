-- Property type and construction fields
alter table properties
  add column if not exists property_type text not null default 'established'
    check (property_type in ('established', 'house_and_land', 'land')),
  add column if not exists land_value numeric(12,2) null,
  add column if not exists construction_builder text null,
  add column if not exists construction_contract_amount numeric(12,2) null,
  add column if not exists construction_start_date date null,
  add column if not exists construction_completion_date date null,
  add column if not exists construction_status text null
    check (construction_status in ('pre_construction', 'in_progress', 'completed')),
  add column if not exists capitalise_construction_interest boolean not null default false;

-- Acquisition costs (one row per cost item per property)
create table if not exists property_acquisition_costs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  type text not null check (type in (
    'stamp_duty', 'legal_conveyancing', 'building_inspection',
    'buyers_agent', 'qs_report', 'soil_test_da', 'loan_establishment', 'other'
  )),
  amount numeric(12,2) not null,
  description text null,  -- required for 'other', optional label for named types
  date date null,
  created_at timestamptz not null default now()
);

alter table property_acquisition_costs enable row level security;

create policy "Users manage own acquisition costs"
on property_acquisition_costs
using (
  exists (
    select 1 from property_owners
    where property_owners.property_id = property_acquisition_costs.property_id
      and property_owners.user_id = auth.uid()
  )
);

-- Projects (construction, renovation, granny flat)
create table if not exists property_projects (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  type text not null check (type in ('construction', 'renovation', 'granny_flat')),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed')),
  name text null,  -- e.g. "Kitchen reno", "Granny flat"
  builder text null,
  contract_amount numeric(12,2) null,
  start_date date null,
  completion_date date null,
  capitalise_interest boolean not null default false,
  qs_report_date date null,
  notes text null,
  created_at timestamptz not null default now()
);

alter table property_projects enable row level security;

create policy "Users manage own projects"
on property_projects
using (
  exists (
    select 1 from property_owners
    where property_owners.property_id = property_projects.property_id
      and property_owners.user_id = auth.uid()
  )
);

-- Link transactions to projects (for progress payments, capitalised interest)
alter table transactions
  add column if not exists project_id uuid null references property_projects(id) on delete set null,
  add column if not exists capitalised boolean not null default false;

-- Add property_type and acquisition costs to the properties update allowlist handled in app code
