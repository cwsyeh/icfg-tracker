alter table properties
  add column if not exists photo_url text null;

-- Storage bucket for property photos (run once)
insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their own folder
create policy if not exists "Authenticated upload property photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'property-photos');

create policy if not exists "Public read property photos"
on storage.objects for select to public
using (bucket_id = 'property-photos');

create policy if not exists "Authenticated delete property photos"
on storage.objects for delete to authenticated
using (bucket_id = 'property-photos');
