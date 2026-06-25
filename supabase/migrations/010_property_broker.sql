-- Mortgage broker contact details per property
alter table properties
  add column broker_name        text,
  add column broker_phone       text,
  add column broker_email       text,
  add column broker_company     text,
  add column broker_license     text;
