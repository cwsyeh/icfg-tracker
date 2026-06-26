-- Add role to property_owners: 'owner' can edit, 'viewer' is read-only
alter table property_owners
  add column if not exists role text not null default 'owner'
  check (role in ('owner', 'viewer'));
