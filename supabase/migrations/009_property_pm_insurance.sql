-- Property manager contact details
alter table properties
  add column pm_agency       text,
  add column pm_name         text,
  add column pm_phone        text,
  add column pm_email        text,
  add column pm_fee_percent  numeric(5,2);

-- Insurance policy details
alter table properties
  add column insurance_provider      text,
  add column insurance_policy_number text,
  add column insurance_expiry        date,
  add column insurance_premium       numeric(14,2);
