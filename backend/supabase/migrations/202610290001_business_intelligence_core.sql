-- BusinessFlow Intelligence core tables.
-- Hosted in the existing GrowthFlow Supabase project, isolated by table prefix.
-- Phase 1 is owner-only. Do not expose service-role credentials to browsers.

create table public.businessflow_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  business_type text,
  business_description text,
  primary_goal text,
  onboarding_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(onboarding_answers) = 'object'),
  country_code text not null default 'CI' check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businessflow_memberships (
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.businessflow_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text,
  metric_name text,
  target_value numeric,
  current_value numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businessflow_experiments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  hypothesis text,
  success_metric text,
  status text not null default 'draft' check (status in ('draft', 'planned', 'running', 'completed', 'cancelled')),
  result_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create table public.businessflow_memory (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  category text not null check (category in ('business_context', 'decision', 'observation', 'preference', 'lesson', 'experiment_result')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  source text not null default 'user' check (source in ('user', 'businessflow', 'grey', 'integration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businessflow_memberships_user_idx on public.businessflow_memberships(user_id, business_id);
create index businessflow_goals_business_idx on public.businessflow_goals(business_id, status);
create index businessflow_experiments_business_idx on public.businessflow_experiments(business_id, status);
create index businessflow_memory_business_idx on public.businessflow_memory(business_id, category, created_at desc);

alter table public.businessflow_profiles enable row level security;
alter table public.businessflow_memberships enable row level security;
alter table public.businessflow_goals enable row level security;
alter table public.businessflow_experiments enable row level security;
alter table public.businessflow_memory enable row level security;

create policy businessflow_profiles_owner_select on public.businessflow_profiles
for select to authenticated using (owner_user_id = (select auth.uid()));
create policy businessflow_profiles_owner_insert on public.businessflow_profiles
for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy businessflow_profiles_owner_update on public.businessflow_profiles
for update to authenticated using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

create policy businessflow_memberships_self_select on public.businessflow_memberships
for select to authenticated using (user_id = (select auth.uid()));
create policy businessflow_memberships_owner_insert on public.businessflow_memberships
for insert to authenticated with check (
  user_id = (select auth.uid()) and role = 'owner' and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_goals_owner_all on public.businessflow_goals
for all to authenticated using (
  exists (select 1 from public.businessflow_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_experiments_owner_all on public.businessflow_experiments
for all to authenticated using (
  exists (select 1 from public.businessflow_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy businessflow_memory_owner_all on public.businessflow_memory
for all to authenticated using (
  exists (select 1 from public.businessflow_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  (created_by is null or created_by = (select auth.uid())) and exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.businessflow_profiles to authenticated;
grant select, insert, update, delete on public.businessflow_memberships to authenticated;
grant select, insert, update, delete on public.businessflow_goals to authenticated;
grant select, insert, update, delete on public.businessflow_experiments to authenticated;
grant select, insert, update, delete on public.businessflow_memory to authenticated;
