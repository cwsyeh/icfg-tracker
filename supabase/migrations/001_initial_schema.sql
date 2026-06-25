-- ============================================================
-- ICFG Property Tracker — Initial Schema
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── TENANTS ──────────────────────────────────────────────────
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subdomain   text not null unique,
  branding    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- Seed ICFG as the first tenant
insert into tenants (name, subdomain, branding) values (
  'Inner Circle Financial Group',
  'icfg',
  '{"primary_color": "#f7c925", "secondary_color": "#2563a8", "nav_color": "#0c1929", "logo_url": null}'
);

-- ── USERS (extends Supabase auth.users) ──────────────────────
create type user_role as enum ('client', 'broker', 'admin');

create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id),
  role        user_role not null default 'client',
  full_name   text not null,
  email       text not null,
  phone       text,
  broker_id   uuid references users(id),   -- clients linked to their broker
  created_at  timestamptz not null default now()
);

-- Audit log for broker reassignments
create table broker_client_history (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references users(id),
  from_broker_id  uuid references users(id),
  to_broker_id    uuid not null references users(id),
  changed_by      uuid not null references users(id),
  reason          text,
  changed_at      timestamptz not null default now()
);

-- ── PROPERTIES ───────────────────────────────────────────────
create type property_status as enum ('active', 'sold', 'archived');
create type property_usage as enum ('investment', 'ppor', 'mixed');

create table properties (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  name            text not null,
  street_address  text not null,
  suburb          text not null,
  state           text not null,
  postcode        text not null,
  usage           property_usage not null default 'investment',
  status          property_status not null default 'active',
  purchase_date   date,
  purchase_price  numeric(14,2),
  sold_date       date,
  sold_price      numeric(14,2),
  notes           text,
  created_at      timestamptz not null default now()
);

-- Co-ownership junction
create table property_owners (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references properties(id) on delete cascade,
  user_id           uuid not null references users(id),
  share_percentage  numeric(5,2) not null check (share_percentage > 0 and share_percentage <= 100),
  created_at        timestamptz not null default now(),
  unique (property_id, user_id)
);

-- Invites for co-owners
create type invite_status as enum ('pending', 'accepted', 'expired');

create table property_invites (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references properties(id) on delete cascade,
  inviter_id        uuid not null references users(id),
  invitee_email     text not null,
  share_percentage  numeric(5,2) not null check (share_percentage > 0 and share_percentage <= 100),
  token             text not null unique default encode(gen_random_bytes(32), 'hex'),
  status            invite_status not null default 'pending',
  expires_at        timestamptz not null default (now() + interval '7 days'),
  created_at        timestamptz not null default now()
);

-- ── LOANS ────────────────────────────────────────────────────
create type loan_repayment_type as enum ('principal_and_interest', 'interest_only');
create type loan_rate_type as enum ('variable', 'fixed', 'split');

create table loans (
  id                    uuid primary key default gen_random_uuid(),
  tax_property_id       uuid not null references properties(id),   -- for interest deductibility
  lender                text not null,
  account_suffix        text,                                       -- last 3-4 digits shown to user
  repayment_type        loan_repayment_type not null default 'principal_and_interest',
  rate_type             loan_rate_type not null default 'variable',
  original_amount       numeric(14,2) not null,
  interest_rate         numeric(6,4) not null,                      -- e.g. 6.13 stored as 6.1300
  loan_term_years       integer not null,
  io_period_years       integer,
  start_date            date not null,
  fixed_rate_expiry     date,
  notes                 text,
  created_at            timestamptz not null default now()
);

-- Security properties (for LVR calculation — can differ from tax_property_id)
create table loan_securities (
  id           uuid primary key default gen_random_uuid(),
  loan_id      uuid not null references loans(id) on delete cascade,
  property_id  uuid not null references properties(id),
  created_at   timestamptz not null default now(),
  unique (loan_id, property_id)
);

-- ── VALUATIONS ───────────────────────────────────────────────
create type valuation_type as enum ('purchase_price', 'bank_valuation', 'corelogic_avm', 'manual');

create table valuations (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references properties(id) on delete cascade,
  valuation_date   date not null,
  amount           numeric(14,2) not null,
  type             valuation_type not null,
  source           text,                   -- e.g. "ANZ Bank", "CoreLogic AVM"
  notes            text,
  created_at       timestamptz not null default now()
);

-- ── TRANSACTIONS ─────────────────────────────────────────────
create type transaction_type as enum (
  'rent_income',
  'interest_expense',
  'principal_payment',
  'council_rates',
  'water_rates',
  'insurance',
  'property_management_fee',
  'repairs_maintenance',
  'advertising',
  'legal_fees',
  'bank_fees',
  'strata_body_corp',
  'capital_expense',
  'depreciation',
  'other_income',
  'other_expense'
);

create type transaction_source as enum ('manual', 'rental_statement_parsed', 'loan_auto');

create table transactions (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references properties(id) on delete cascade,
  loan_id            uuid references loans(id),        -- populated for loan-related transactions
  transaction_date   date not null,
  type               transaction_type not null,
  amount             numeric(14,2) not null,            -- positive = income, negative = expense
  description        text,
  ownership_note     text,                              -- e.g. "Your share: 50% of $1,400"
  financial_year     text not null,                     -- e.g. "FY26"
  source             transaction_source not null default 'manual',
  created_at         timestamptz not null default now()
);

-- ── DEPRECIATION SCHEDULES ───────────────────────────────────
create table depreciation_schedules (
  id                      uuid primary key default gen_random_uuid(),
  property_id             uuid not null references properties(id) on delete cascade,
  financial_year          text not null,                -- e.g. "FY26"
  division_43_amount      numeric(14,2) not null default 0,
  plant_equipment_amount  numeric(14,2) not null default 0,
  source                  text,                         -- e.g. "BMT QS Report"
  notes                   text,
  created_at              timestamptz not null default now(),
  unique (property_id, financial_year)
);

-- ── UPLOAD JOBS ──────────────────────────────────────────────
create type upload_type as enum ('rental_statement', 'depreciation_schedule');
create type upload_status as enum ('pending', 'processing', 'completed', 'failed');

create table upload_jobs (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references properties(id) on delete cascade,
  uploaded_by           uuid not null references users(id),
  type                  upload_type not null,
  original_filename     text not null,
  status                upload_status not null default 'pending',
  transactions_created  integer default 0,
  error_message         text,
  uploaded_at           timestamptz not null default now(),
  processed_at          timestamptz
  -- no file storage column: bytes deleted after processing
);

-- ============================================================
-- INDEXES
-- ============================================================
create index on properties (tenant_id);
create index on property_owners (user_id);
create index on property_owners (property_id);
create index on loans (tax_property_id);
create index on loan_securities (property_id);
create index on loan_securities (loan_id);
create index on transactions (property_id);
create index on transactions (financial_year);
create index on valuations (property_id);
create index on depreciation_schedules (property_id);
create index on upload_jobs (property_id);
create index on users (tenant_id);
create index on users (broker_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table tenants             enable row level security;
alter table users               enable row level security;
alter table properties          enable row level security;
alter table property_owners     enable row level security;
alter table property_invites    enable row level security;
alter table loans               enable row level security;
alter table loan_securities     enable row level security;
alter table valuations          enable row level security;
alter table transactions        enable row level security;
alter table depreciation_schedules enable row level security;
alter table upload_jobs         enable row level security;
alter table broker_client_history enable row level security;

-- Clients see only their own properties (via property_owners)
create policy "clients_own_properties" on properties
  for select using (
    id in (
      select property_id from property_owners
      where user_id = auth.uid()
    )
  );

-- Brokers see all properties belonging to their clients in their tenant
create policy "brokers_see_tenant_properties" on properties
  for select using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
      and u.role in ('broker', 'admin')
      and u.tenant_id = (
        select tenant_id from users where id = auth.uid()
      )
    )
  );

-- Clients see their own user record
create policy "users_own_record" on users
  for select using (id = auth.uid());

-- Brokers see all users in their tenant
create policy "brokers_see_tenant_users" on users
  for select using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
      and u.role in ('broker', 'admin')
      and u.tenant_id = tenant_id
    )
  );
