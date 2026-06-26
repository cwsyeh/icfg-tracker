alter table properties drop constraint if exists properties_property_type_check;
alter table properties add constraint properties_property_type_check
  check (property_type in ('established', 'house_and_land', 'land', 'off_the_plan'));
