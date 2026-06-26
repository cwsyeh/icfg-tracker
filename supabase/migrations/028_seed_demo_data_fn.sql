-- Creates the seed_demo_data(target_user_id) function.
-- Clones all properties (and related data) owned by the demo account
-- into independent copies owned by the target user.
-- Skips silently if the target already owns any properties.

create or replace function seed_demo_data(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  demo_user_id   uuid;
  source_prop    record;
  source_loan    record;
  source_ls      record;
  new_prop_id    uuid;
  new_loan_id    uuid;
  prop_id_map    jsonb := '{}';
  loan_id_map    jsonb := '{}';
begin
  -- Look up the designated demo account
  select id into demo_user_id
  from auth.users
  where email = 'simon@icfg.com.au'
  limit 1;

  if demo_user_id is null then
    raise notice 'Demo user not found — skipping seed';
    return;
  end if;

  -- Skip if target already owns any properties
  if exists (
    select 1 from property_owners
    where user_id = target_user_id and role = 'owner'
  ) then
    return;
  end if;

  -- Ensure target user exists in public.users
  if not exists (select 1 from users where id = target_user_id) then
    insert into users (id, tenant_id, role, full_name, email, phone, broker_id, created_at)
    select target_user_id, tenant_id, 'client',
           coalesce((select raw_user_meta_data->>'full_name' from auth.users where id = target_user_id), 'User'),
           coalesce((select email from auth.users where id = target_user_id), target_user_id::text),
           null, null, now()
    from users
    where id = demo_user_id
    limit 1;
  end if;

  -- ── Clone properties ──────────────────────────────────────────────
  for source_prop in
    select p.*
    from properties p
    join property_owners po on po.property_id = p.id
    where po.user_id = demo_user_id and po.role = 'owner'
  loop
    new_prop_id := gen_random_uuid();
    prop_id_map := prop_id_map || jsonb_build_object(source_prop.id::text, new_prop_id::text);

    insert into properties (
      id, tenant_id, name, street_address, suburb, state, postcode,
      usage, mixed_use_investment_percent, property_type, land_value,
      construction_builder, construction_contract_amount, construction_start_date,
      construction_completion_date, construction_status, capitalise_construction_interest,
      status, purchase_date, settlement_date, purchase_price, deposit_paid,
      sold_date, sold_price,
      broker_name, broker_phone, broker_email, broker_company, broker_license,
      pm_agency, pm_name, pm_phone, pm_email, pm_fee_percent, lease_expiry_date,
      insurance_provider, insurance_policy_number, insurance_expiry, insurance_premium,
      photo_url, notes
    )
    select
      new_prop_id, tenant_id, name, street_address, suburb, state, postcode,
      usage, mixed_use_investment_percent, property_type, land_value,
      construction_builder, construction_contract_amount, construction_start_date,
      construction_completion_date, construction_status, capitalise_construction_interest,
      status, purchase_date, settlement_date, purchase_price, deposit_paid,
      sold_date, sold_price,
      broker_name, broker_phone, broker_email, broker_company, broker_license,
      pm_agency, pm_name, pm_phone, pm_email, pm_fee_percent, lease_expiry_date,
      insurance_provider, insurance_policy_number, insurance_expiry, insurance_premium,
      photo_url, notes
    from properties where id = source_prop.id;

    insert into property_owners (id, property_id, user_id, share_percentage, role)
    values (gen_random_uuid(), new_prop_id, target_user_id, 100, 'owner');

    -- Valuations
    insert into valuations (id, property_id, valuation_date, amount, type, source, notes)
    select gen_random_uuid(), new_prop_id, valuation_date, amount, type, source, notes
    from valuations where property_id = source_prop.id;

    -- Acquisition costs
    insert into property_acquisition_costs (id, property_id, type, amount, description, date)
    select gen_random_uuid(), new_prop_id, type, amount, description, date
    from property_acquisition_costs where property_id = source_prop.id;

    -- Depreciation schedules
    insert into depreciation_schedules (id, property_id, financial_year, division_43_amount, plant_equipment_amount, source, notes)
    select gen_random_uuid(), new_prop_id, financial_year, division_43_amount, plant_equipment_amount, source, notes
    from depreciation_schedules where property_id = source_prop.id;

    -- Construction progress payments
    insert into construction_progress_payments (id, property_id, stage_name, amount, scheduled_date, drawn_date, bank_amount, self_amount, sort_order, notes)
    select gen_random_uuid(), new_prop_id, stage_name, amount, scheduled_date, drawn_date, bank_amount, self_amount, sort_order, notes
    from construction_progress_payments where property_id = source_prop.id;
  end loop;

  -- ── Clone loans ───────────────────────────────────────────────────
  for source_loan in
    select l.*
    from loans l
    join property_owners po on po.property_id = l.tax_property_id
    where po.user_id = demo_user_id and po.role = 'owner'
  loop
    if prop_id_map ->> source_loan.tax_property_id::text is null then continue; end if;

    new_loan_id := gen_random_uuid();
    loan_id_map := loan_id_map || jsonb_build_object(source_loan.id::text, new_loan_id::text);

    insert into loans (
      id, tax_property_id, lender, account_suffix, repayment_type, rate_type,
      original_amount, interest_rate, loan_term_years, io_period_years, start_date,
      fixed_rate_expiry, io_expiry_date, actual_balance, balance_date, rate_effective_date,
      reforecast_balance, reforecast_date,
      outside_security_description, outside_security_value,
      notes, status, closed_date, refinanced_from_loan_id,
      purpose, deductible_portion_percent, loan_limit
    )
    select
      new_loan_id,
      (prop_id_map ->> source_loan.tax_property_id::text)::uuid,
      lender, account_suffix, repayment_type, rate_type,
      original_amount, interest_rate, loan_term_years, io_period_years, start_date,
      fixed_rate_expiry, io_expiry_date, actual_balance, balance_date, rate_effective_date,
      reforecast_balance, reforecast_date,
      outside_security_description, outside_security_value,
      notes, status, closed_date, refinanced_from_loan_id,
      purpose, deductible_portion_percent, loan_limit
    from loans where id = source_loan.id;
  end loop;

  -- ── Clone loan securities ─────────────────────────────────────────
  for source_ls in
    select ls.*
    from loan_securities ls
    join loans l on l.id = ls.loan_id
    join property_owners po on po.property_id = l.tax_property_id
    where po.user_id = demo_user_id and po.role = 'owner'
  loop
    if loan_id_map ->> source_ls.loan_id::text is null then continue; end if;
    if prop_id_map ->> source_ls.property_id::text is null then continue; end if;

    insert into loan_securities (id, loan_id, property_id)
    values (
      gen_random_uuid(),
      (loan_id_map ->> source_ls.loan_id::text)::uuid,
      (prop_id_map ->> source_ls.property_id::text)::uuid
    );
  end loop;

  -- ── Clone transactions ────────────────────────────────────────────
  insert into transactions (
    id, property_id, loan_id, project_id, transaction_date, type, amount,
    description, ownership_note, financial_year, source, manually_edited, capitalised
  )
  select
    gen_random_uuid(),
    (prop_id_map ->> t.property_id::text)::uuid,
    case when t.loan_id is not null and loan_id_map ->> t.loan_id::text is not null
         then (loan_id_map ->> t.loan_id::text)::uuid
    end,
    null,
    t.transaction_date, t.type, t.amount,
    t.description, t.ownership_note, t.financial_year, t.source, t.manually_edited, t.capitalised
  from transactions t
  join property_owners po on po.property_id = t.property_id
  where po.user_id = demo_user_id
    and po.role = 'owner'
    and prop_id_map ->> t.property_id::text is not null;

end;
$$;

grant execute on function seed_demo_data(uuid) to service_role;
