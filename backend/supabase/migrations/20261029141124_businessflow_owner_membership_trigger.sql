-- Ensure every new BusinessFlow profile receives its owner membership atomically.
-- This is a separate migration because the core schema has already been applied.

create function public.businessflow_create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.businessflow_memberships (business_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (business_id, user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.businessflow_create_owner_membership() from public, anon, authenticated;

create trigger businessflow_profile_create_owner_membership
after insert on public.businessflow_profiles
for each row execute function public.businessflow_create_owner_membership();
