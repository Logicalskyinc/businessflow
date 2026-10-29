-- BusinessFlow Intelligence schema foundation.
-- Owner-only first release. Do not apply until the target Supabase project is confirmed.

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  business_type text,
  country_code text not null default 'CI' check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_memberships (
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
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

create table if not exists public.business_experiments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
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

create table if not exists public.business_memory (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  category text not null check (category in ('business_context', 'decision', 'observation', 'preference', 'lesson', 'experiment_result')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  source text not null default 'user' check (source in ('user', 'businessflow', 'grey', 'integration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_memberships_user_idx on public.business_memberships(user_id, business_id);
create index if not exists business_goals_business_idx on public.business_goals(business_id, status);
create index if not exists business_experiments_business_idx on public.business_experiments(business_id, status);
create index if not exists business_memory_business_idx on public.business_memory(business_id, category, created_at desc);

alter table public.business_profiles enable row level security;
alter table public.business_memberships enable row level security;
alter table public.business_goals enable row level security;
alter table public.business_experiments enable row level security;
alter table public.business_memory enable row level security;

create policy "business_profiles_owner_select" on public.business_profiles
for select to authenticated using (owner_user_id = (select auth.uid()));
create policy "business_profiles_owner_insert" on public.business_profiles
for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy "business_profiles_owner_update" on public.business_profiles
for update to authenticated using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

create policy "business_memberships_self_select" on public.business_memberships
for select to authenticated using (user_id = (select auth.uid()));
create policy "business_memberships_owner_insert" on public.business_memberships
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.business_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy "business_goals_owner_all" on public.business_goals
for all to authenticated using (
  exists (select 1 from public.business_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.business_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy "business_experiments_owner_all" on public.business_experiments
for all to authenticated using (
  exists (select 1 from public.business_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.business_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

create policy "business_memory_owner_all" on public.business_memory
for all to authenticated using (
  exists (select 1 from public.business_profiles p
          where p.id = business_id and p.owner_user_id = (select auth.uid()))
) with check (
  (created_by is null or created_by = (select auth.uid())) and exists (
    select 1 from public.business_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.business_profiles to authenticated;
grant select, insert, update, delete on public.business_memberships to authenticated;
grant select, insert, update, delete on public.business_goals to authenticated;
grant select, insert, update, delete on public.business_experiments to authenticated;
grant select, insert, update, delete on public.business_memory to authenticated;
