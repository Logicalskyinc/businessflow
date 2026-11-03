-- Keep BusinessFlow and Grey conversation identifiers separate.
alter table public.businessflow_conversations
  add column if not exists grey_conversation_id uuid,
  add column if not exists grey_initialization_token uuid,
  add column if not exists grey_initialization_expires_at timestamptz;

grant update (title, updated_at, grey_conversation_id, grey_initialization_token, grey_initialization_expires_at)
  on public.businessflow_conversations to authenticated;

-- Freeze the workspace snapshot per user message so retries send identical input.
alter table public.businessflow_messages
  add column if not exists workspace_context jsonb;

create or replace function public.businessflow_set_message_context(
  p_message_id uuid,
  p_context jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_context jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object'
     or octet_length(p_context::text) > 11500 then
    raise exception 'invalid_workspace_context' using errcode = '22023';
  end if;

  select m.workspace_context into v_context
  from public.businessflow_messages m
  where m.id = p_message_id
    and m.created_by = v_user_id
    and m.role = 'user'
  for update;

  if not found then
    raise exception 'user_message_not_found' using errcode = '42501';
  end if;

  if v_context is null then
    update public.businessflow_messages
    set workspace_context = p_context
    where id = p_message_id
    returning workspace_context into v_context;
  end if;
  return v_context;
end;
$$;

create or replace function public.businessflow_claim_grey_initialization(
  p_conversation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.businessflow_conversations;
  v_token uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select c.* into v_conversation
  from public.businessflow_conversations c
  join public.businessflow_profiles p on p.id = c.business_id
  where c.id = p_conversation_id
    and c.created_by = v_user_id
    and p.owner_user_id = v_user_id
  for update of c;

  if not found then
    raise exception 'conversation_not_found' using errcode = '42501';
  end if;

  if v_conversation.grey_conversation_id is not null then
    return jsonb_build_object('status', 'ready', 'conversation_id', v_conversation.grey_conversation_id);
  end if;

  if v_conversation.grey_initialization_token is not null
     and v_conversation.grey_initialization_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;

  v_token := gen_random_uuid();
  update public.businessflow_conversations
  set grey_initialization_token = v_token,
      grey_initialization_expires_at = now() + interval '2 minutes'
  where id = p_conversation_id;

  return jsonb_build_object('status', 'claimed', 'token', v_token);
end;
$$;

create or replace function public.businessflow_complete_grey_initialization(
  p_conversation_id uuid,
  p_token uuid,
  p_grey_conversation_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  update public.businessflow_conversations c
  set grey_conversation_id = p_grey_conversation_id,
      grey_initialization_token = null,
      grey_initialization_expires_at = null
  where c.id = p_conversation_id
    and c.created_by = v_user_id
    and c.grey_conversation_id is null
    and c.grey_initialization_token = p_token
    and exists (
      select 1 from public.businessflow_profiles p
      where p.id = c.business_id and p.owner_user_id = v_user_id
    );
  return found;
end;
$$;

create or replace function public.businessflow_release_grey_initialization(
  p_conversation_id uuid,
  p_token uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  update public.businessflow_conversations c
  set grey_initialization_token = null,
      grey_initialization_expires_at = null
  where c.id = p_conversation_id
    and c.created_by = v_user_id
    and c.grey_initialization_token = p_token
    and c.grey_conversation_id is null
    and exists (
      select 1 from public.businessflow_profiles p
      where p.id = c.business_id and p.owner_user_id = v_user_id
    );
end;
$$;

revoke all on function public.businessflow_set_message_context(uuid, jsonb) from public, anon;
revoke all on function public.businessflow_claim_grey_initialization(uuid) from public, anon;
revoke all on function public.businessflow_complete_grey_initialization(uuid, uuid, uuid) from public, anon;
revoke all on function public.businessflow_release_grey_initialization(uuid, uuid) from public, anon;
grant execute on function public.businessflow_set_message_context(uuid, jsonb) to authenticated;
grant execute on function public.businessflow_claim_grey_initialization(uuid) to authenticated;
grant execute on function public.businessflow_complete_grey_initialization(uuid, uuid, uuid) to authenticated;
grant execute on function public.businessflow_release_grey_initialization(uuid, uuid) to authenticated;
