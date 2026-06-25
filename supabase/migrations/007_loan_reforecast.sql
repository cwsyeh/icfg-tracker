-- Reforecast: when balance/rate changes, store the new starting point for the amortisation schedule
alter table loans
  add column reforecast_balance numeric(14,2),
  add column reforecast_date    date;
