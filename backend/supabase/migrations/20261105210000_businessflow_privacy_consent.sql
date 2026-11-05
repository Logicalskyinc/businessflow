-- Account-level privacy preferences and per-conversation shared-learning exclusion.
-- Defaults preserve existing private chat history while keeping learning opt-in.
-- No model training or candidate collection is enabled by this migration.

create table if not exists public.businessflow_privacy_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personal_learning_enabled boolean not null default false,
  shared_improvement_enabled boolean not null default false,
  conversation_history_enabled boolean not null default true,
  policy_version integer not null default 1 check (policy_version > 0),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.businessflow_privacy_preferences is
  'Account-scoped privacy controls. Shared improvement and personal learning default off.';
comment on column public.businessflow_privacy_preferences.conversation_history_enabled is
  'Controls retention of private chat transcripts; defaults on to preserve existing BusinessFlow behavior.';

alter table public.businessflow_conversations
  add column if not exists shared_improvement_excluded boolean not null default false,
  add column if not exists privacy_revision integer not null default 0;

create table if not exists public.businessflow_privacy_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_type text not null check (subject_type in ('account', 'conversation')),
  subject_id uuid not null,
  setting text not null check (setting in (
    'personal_learning_enabled',
    'shared_improvement_enabled',
    'conversation_history_enabled',
    'shared_improvement_excluded'
  )),
  enabled boolean not null,
  policy_version integer not null check (policy_version > 0),
  revision integer not null check (revision > 0),
  created_at timestamptz not null default now()
);

create index if not exists businessflow_privacy_events_user_created_idx
  on public.businessflow_privacy_consent_events (user_id, created_at desc);

alter table public.businessflow_privacy_preferences enable row level security;
alter table public.businessflow_privacy_consent_events enable row level security;

drop policy if exists "Users read their own privacy preferences"
  on public.businessflow_privacy_preferences;
create policy "Users read their own privacy preferences"
  on public.businessflow_privacy_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users read their own privacy consent events"
  on public.businessflow_privacy_consent_events;
create policy "Users read their own privacy consent events"
  on public.businessflow_privacy_consent_events for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.businessflow_privacy_preferences,
  public.businessflow_privacy_consent_events from anon, authenticated;
grant select on public.businessflow_privacy_preferences,
  public.businessflow_privacy_consent_events to authenticated;


create or replace function public.businessflow_get_privacy_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_preferences public.businessflow_privacy_preferences;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  insert into public.businessflow_privacy_preferences (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_preferences
  from public.businessflow_privacy_preferences
  where user_id = v_user_id;

  return jsonb_build_object(
    'personal_learning_enabled', v_preferences.personal_learning_enabled,
    'shared_improvement_enabled', v_preferences.shared_improvement_enabled,
    'conversation_history_enabled', v_preferences.conversation_history_enabled,
    'policy_version', v_preferences.policy_version,
    'revision', v_preferences.revision,
    'updated_at', v_preferences.updated_at
  );
end;
$function$;

revoke all on function public.businessflow_get_privacy_preferences()
  from public, anon, authenticated, service_role;
grant execute on function public.businessflow_get_privacy_preferences()
  to authenticated;

create or replace function public.businessflow_set_privacy_preference(
  p_setting text,
  p_enabled boolean,
  p_expected_revision integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_revision integer;
  v_policy_version integer := 1;
  v_preferences public.businessflow_privacy_preferences;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_enabled is null or p_setting is null or p_setting not in (
    'personal_learning_enabled',
    'shared_improvement_enabled',
    'conversation_history_enabled'
  ) then
    raise exception 'invalid_privacy_preference' using errcode = '22023';
  end if;

  insert into public.businessflow_privacy_preferences (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select revision into v_revision
  from public.businessflow_privacy_preferences
  where user_id = v_user_id
  for update;

  if p_expected_revision is not null and p_expected_revision <> v_revision then
    raise exception 'privacy_preference_revision_conflict' using errcode = '40001';
  end if;

  update public.businessflow_privacy_preferences
  set personal_learning_enabled = case
        when p_setting = 'personal_learning_enabled' then p_enabled
        else personal_learning_enabled end,
      shared_improvement_enabled = case
        when p_setting = 'shared_improvement_enabled' then p_enabled
        else shared_improvement_enabled end,
      conversation_history_enabled = case
        when p_setting = 'conversation_history_enabled' then p_enabled
        else conversation_history_enabled end,
      revision = revision + 1,
      updated_at = now()
  where user_id = v_user_id
  returning * into v_preferences;

  insert into public.businessflow_privacy_consent_events (
    user_id, subject_type, subject_id, setting, enabled, policy_version, revision
  ) values (
    v_user_id, 'account', v_user_id, p_setting, p_enabled,
    v_policy_version, v_preferences.revision
  );

  return jsonb_build_object(
    'personal_learning_enabled', v_preferences.personal_learning_enabled,
    'shared_improvement_enabled', v_preferences.shared_improvement_enabled,
    'conversation_history_enabled', v_preferences.conversation_history_enabled,
    'policy_version', v_preferences.policy_version,
    'revision', v_preferences.revision,
    'updated_at', v_preferences.updated_at
  );
end;
$function$;

create or replace function public.businessflow_set_conversation_shared_exclusion(
  p_conversation_id uuid,
  p_excluded boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_revision integer;
  v_policy_version integer := 1;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_conversation_id is null or p_excluded is null then
    raise exception 'invalid_conversation_privacy_setting' using errcode = '22023';
  end if;

  update public.businessflow_conversations c
  set shared_improvement_excluded = p_excluded,
      privacy_revision = c.privacy_revision + 1
  where c.id = p_conversation_id
    and c.created_by = v_user_id
    and exists (
      select 1 from public.businessflow_profiles p
      where p.id = c.business_id and p.owner_user_id = v_user_id
    )
  returning privacy_revision into v_revision;

  if not found then
    raise exception 'conversation_not_found' using errcode = '42501';
  end if;

  insert into public.businessflow_privacy_consent_events (
    user_id, subject_type, subject_id, setting, enabled, policy_version, revision
  ) values (
    v_user_id, 'conversation', p_conversation_id,
    'shared_improvement_excluded', p_excluded, v_policy_version, v_revision
  );

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'shared_improvement_excluded', p_excluded,
    'revision', v_revision
  );
end;
$function$;

revoke all on function public.businessflow_set_privacy_preference(text, boolean, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.businessflow_set_conversation_shared_exclusion(uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.businessflow_set_privacy_preference(text, boolean, integer)
  to authenticated;
grant execute on function public.businessflow_set_conversation_shared_exclusion(uuid, boolean)
  to authenticated;
