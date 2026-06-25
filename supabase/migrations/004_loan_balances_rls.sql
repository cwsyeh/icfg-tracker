-- Add RLS to loan_balances (consistent with all other tables)
alter table loan_balances enable row level security;

-- Users can read balances for loans on properties they own
create policy "users_read_own_loan_balances" on loan_balances
  for select using (
    exists (
      select 1 from loans l
      join property_owners po on po.property_id = l.tax_property_id
      where l.id = loan_balances.loan_id
        and po.user_id = auth.uid()
    )
  );

-- Service role handles inserts/updates via API routes (bypasses RLS)
