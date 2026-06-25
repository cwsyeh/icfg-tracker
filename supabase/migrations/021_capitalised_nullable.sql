-- Make transactions.capitalised nullable so we can distinguish:
--   null  = auto-determine from construction window + expense type
--   true  = user explicitly included in cost base
--   false = user explicitly excluded from cost base
alter table transactions
  alter column capitalised drop not null,
  alter column capitalised set default null;

-- Reset existing false values to null (they were just the DB default, not explicit user choices)
update transactions set capitalised = null where capitalised = false;
