-- Workspace-scoped activity history for BusinessFlow.
create table if not exists public.businessflow_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  event_type text not null check (event_type in (
    'goal_created','goal_updated','goal_completed','goal_deleted',
    'experiment_created','experiment_updated','experiment_deleted','dataset_imported'
  )),
  title text not null check (char_length(title) between 1 and 120),
  message text not null default '' check (char_length(message) <= 300),
  entity_id text not null default '' check (char_length(entity_id) <= 100),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, event_key)
);
create index if not exists businessflow_activity_workspace_created_idx
  on public.businessflow_activity (business_id, created_at desc);
alter table public.businessflow_activity enable row level security;
drop policy if exists "businessflow_activity_owner_select" on public.businessflow_activity;
create policy "businessflow_activity_owner_select" on public.businessflow_activity
  for select to authenticated using (
    exists (select 1 from public.businessflow_profiles p
      where p.id = businessflow_activity.business_id and p.owner_user_id = auth.uid())
  );
drop policy if exists "businessflow_activity_owner_insert" on public.businessflow_activity;
create policy "businessflow_activity_owner_insert" on public.businessflow_activity
  for insert to authenticated with check (
    created_by = auth.uid() and exists (
      select 1 from public.businessflow_profiles p
      where p.id = businessflow_activity.business_id and p.owner_user_id = auth.uid()
    )
  );
drop policy if exists "businessflow_activity_owner_update" on public.businessflow_activity;
create policy "businessflow_activity_owner_update" on public.businessflow_activity
  for update to authenticated using (
    exists (select 1 from public.businessflow_profiles p
      where p.id = businessflow_activity.business_id and p.owner_user_id = auth.uid())
  ) with check (
    created_by = auth.uid() and exists (
      select 1 from public.businessflow_profiles p
      where p.id = businessflow_activity.business_id and p.owner_user_id = auth.uid()
    )
  );
drop policy if exists "businessflow_activity_owner_delete" on public.businessflow_activity;
create policy "businessflow_activity_owner_delete" on public.businessflow_activity
  for delete to authenticated using (
    exists (select 1 from public.businessflow_profiles p
      where p.id = businessflow_activity.business_id and p.owner_user_id = auth.uid())
  );
grant select, insert, update, delete on public.businessflow_activity to authenticated;
