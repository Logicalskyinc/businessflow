-- Preserve the existing text type of grey_conversation_id.
alter table public.businessflow_conversations
  add column if not exists grey_conversation_id text,
  add column if not exists grey_initialization_token uuid,
  add column if not exists grey_initialization_expires_at timestamptz,
  add column if not exists grey_initialization_message_id uuid;

alter table public.businessflow_messages
  add column if not exists workspace_context jsonb;

-- These RPCs are server-only: SECURITY INVOKER, executable only by service_role.
-- The backend passes the verified Supabase Auth user ID and each function checks
-- conversation creator and workspace ownership before reading or changing rows.
create or replace function public.businessflow_set_message_context(
  p_message_id uuid, p_context jsonb, p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  if p_user_id is null then
    raise exception 'user_identity_required' using errcode = '22023';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object'
     or octet_length(p_context::text) > 11500 then
    raise exception 'invalid_workspace_context' using errcode = '22023';
  end if;

  select m.workspace_context into v_context
  from public.businessflow_messages m
  join public.businessflow_conversations c on c.id = m.conversation_id
  join public.businessflow_profiles p on p.id = c.business_id
  where m.id = p_message_id and m.created_by = p_user_id and m.role = 'user'
    and c.created_by = p_user_id and p.owner_user_id = p_user_id
  for update of m;

  if not found then
    raise exception 'user_message_not_found' using errcode = '42501';
  end if;
  if v_context is null then
    update public.businessflow_messages set workspace_context = p_context
    where id = p_message_id returning workspace_context into v_context;
  end if;
  return v_context;
end;
$$;

create or replace function public.businessflow_claim_grey_initialization(
  p_conversation_id uuid, p_message_id uuid, p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.businessflow_conversations;
  v_token uuid;
begin
  if p_user_id is null then
    raise exception 'user_identity_required' using errcode = '22023';
  end if;

  select c.* into v_conversation
  from public.businessflow_conversations c
  join public.businessflow_profiles p on p.id = c.business_id
  where c.id = p_conversation_id and c.created_by = p_user_id
    and p.owner_user_id = p_user_id
  for update of c;
  if not found then
    raise exception 'conversation_not_found' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.businessflow_messages m
    where m.id = p_message_id and m.conversation_id = p_conversation_id
      and m.created_by = p_user_id and m.role = 'user'
      and m.workspace_context is not null
  ) then
    raise exception 'initialization_message_not_ready' using errcode = '22023';
  end if;

  if v_conversation.grey_conversation_id is not null then
    return jsonb_build_object('status','ready',
      'conversation_id',v_conversation.grey_conversation_id,
      'message_id',v_conversation.grey_initialization_message_id);
  end if;
  if v_conversation.grey_initialization_token is not null
     and v_conversation.grey_initialization_expires_at > now() then
    return jsonb_build_object('status','busy');
  end if;

  v_token := gen_random_uuid();
  update public.businessflow_conversations
  set grey_initialization_message_id = coalesce(grey_initialization_message_id,p_message_id),
      grey_initialization_token = v_token,
      grey_initialization_expires_at = now() + interval '2 minutes'
  where id = p_conversation_id returning * into v_conversation;

  return jsonb_build_object('status','claimed','token',v_token,
    'message_id',v_conversation.grey_initialization_message_id);
end;
$$;

create or replace function public.businessflow_complete_grey_initialization(
  p_conversation_id uuid, p_token uuid, p_grey_conversation_id text, p_user_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_grey_conversation_id is null
     or p_grey_conversation_id !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    raise exception 'invalid_initialization_completion' using errcode = '22023';
  end if;

  update public.businessflow_conversations c
  set grey_conversation_id = p_grey_conversation_id,
      grey_initialization_token = null,
      grey_initialization_expires_at = null
  where c.id = p_conversation_id and c.created_by = p_user_id
    and c.grey_conversation_id is null and c.grey_initialization_token = p_token
    and exists (select 1 from public.businessflow_profiles p
      where p.id = c.business_id and p.owner_user_id = p_user_id);
  return found;
end;
$$;

revoke all on function public.businessflow_set_message_context(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.businessflow_claim_grey_initialization(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.businessflow_complete_grey_initialization(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.businessflow_set_message_context(uuid,jsonb,uuid) to service_role;
grant execute on function public.businessflow_claim_grey_initialization(uuid,uuid,uuid) to service_role;
grant execute on function public.businessflow_complete_grey_initialization(uuid,uuid,text,uuid) to service_role;
 then
    raise exception 'invalid_initialization_completion' using errcode = '22023';
  end if;

  update public.businessflow_conversations c
  set grey_conversation_id = p_grey_conversation_id,
      grey_initialization_token = null,
      grey_initialization_expires_at = null
  where c.id = p_conversation_id and c.created_by = p_user_id
    and c.grey_conversation_id is null and c.grey_initialization_token = p_token
    and exists (select 1 from public.businessflow_profiles p
      where p.id = c.business_id and p.owner_user_id = p_user_id);
  return found;
end;
$$;

revoke all on function public.businessflow_set_message_context(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.businessflow_claim_grey_initialization(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.businessflow_complete_grey_initialization(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.businessflow_set_message_context(uuid,jsonb,uuid) to service_role;
grant execute on function public.businessflow_claim_grey_initialization(uuid,uuid,uuid) to service_role;
grant execute on function public.businessflow_complete_grey_initialization(uuid,uuid,text,uuid) to service_role;
