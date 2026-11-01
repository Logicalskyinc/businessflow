-- Reconcile the production schema baseline.
-- The conversations and workspace-limit objects were already present in the
-- live database but were not represented in its migration history. This
-- migration deliberately changes no schema; it fails unless those objects
-- have been verified, so future migrations have an explicit baseline marker.

do $$
declare
  required_policy text;
begin
  if to_regclass('public.businessflow_conversations') is null
     or to_regclass('public.businessflow_messages') is null then
    raise exception 'businessflow_conversation_tables_missing';
  end if;

  if to_regclass('public.businessflow_conversations_business_updated_idx') is null
     or to_regclass('public.businessflow_messages_conversation_created_idx') is null then
    raise exception 'businessflow_conversation_indexes_missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'businessflow_workspace_limit_before_insert'
      and tgrelid = 'public.businessflow_profiles'::regclass
      and not tgisinternal
  ) then
    raise exception 'businessflow_workspace_limit_trigger_missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'businessflow_profile_create_owner_membership'
      and tgrelid = 'public.businessflow_profiles'::regclass
      and not tgisinternal
  ) then
    raise exception 'businessflow_owner_membership_trigger_missing';
  end if;

  if to_regprocedure('public.businessflow_append_assistant_message(uuid,uuid,text)') is null then
    raise exception 'businessflow_assistant_message_rpc_missing';
  end if;

  foreach required_policy in array array[
    'Business owners read conversations',
    'Business owners create conversations',
    'Business owners update conversations',
    'Business owners read messages',
    'Business owners add user messages'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('businessflow_conversations', 'businessflow_messages')
        and policyname = required_policy
        and 'authenticated' = any(roles)
    ) then
      raise exception 'businessflow_conversation_policy_missing: %', required_policy;
    end if;
  end loop;

  if not (
    (select relrowsecurity from pg_class where oid = 'public.businessflow_conversations'::regclass)
    and
    (select relrowsecurity from pg_class where oid = 'public.businessflow_messages'::regclass)
  ) then
    raise exception 'businessflow_conversation_rls_disabled';
  end if;
end;
$$;
