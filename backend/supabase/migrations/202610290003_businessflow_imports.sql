-- Workspace-scoped imported datasets for BusinessFlow.
create table public.businessflow_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  source_filename text not null check (char_length(source_filename) between 1 and 255),
  columns jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 40),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 250),
  row_count integer not null check (row_count between 1 and 250),
  created_at timestamptz not null default now(),
  check (row_count = jsonb_array_length(rows))
);
create index businessflow_imports_business_idx on public.businessflow_imports(business_id, created_at desc);
alter table public.businessflow_imports enable row level security;
create policy businessflow_imports_owner_all on public.businessflow_imports for all to authenticated
using (exists (select 1 from public.businessflow_profiles p where p.id = business_id and p.owner_user_id = (select auth.uid())))
with check (created_by = (select auth.uid()) and exists (select 1 from public.businessflow_profiles p where p.id = business_id and p.owner_user_id = (select auth.uid())));
revoke all on public.businessflow_imports from anon, public;
grant select, insert, delete on public.businessflow_imports to authenticated;
