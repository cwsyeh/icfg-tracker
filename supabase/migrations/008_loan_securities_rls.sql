-- loan_securities had RLS enabled but no policies, blocking all client reads
create policy "owners_read_loan_securities" on loan_securities
  for select using (
    loan_id in (
      select l.id from loans l
      join property_owners po on po.property_id = l.tax_property_id
      where po.user_id = auth.uid()
    )
  );
