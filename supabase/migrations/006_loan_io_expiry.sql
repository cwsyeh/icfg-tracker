-- Store IO expiry as a date rather than integer years (more precise, handles extensions)
alter table loans add column io_expiry_date date;

-- Interest in advance: interest-only payment where interest is paid a year ahead (common AUS investment loan)
alter type loan_repayment_type add value 'interest_in_advance';
