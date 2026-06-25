-- RLS policies for depreciation_schedules
-- Property owners can read, insert, update, and delete their own depreciation records

create policy "owners_select_depreciation" on depreciation_schedules
  for select using (
    property_id in (
      select property_id from property_owners
      where user_id = auth.uid()
    )
  );

create policy "owners_insert_depreciation" on depreciation_schedules
  for insert with check (
    property_id in (
      select property_id from property_owners
      where user_id = auth.uid()
    )
  );

create policy "owners_update_depreciation" on depreciation_schedules
  for update using (
    property_id in (
      select property_id from property_owners
      where user_id = auth.uid()
    )
  );

create policy "owners_delete_depreciation" on depreciation_schedules
  for delete using (
    property_id in (
      select property_id from property_owners
      where user_id = auth.uid()
    )
  );
