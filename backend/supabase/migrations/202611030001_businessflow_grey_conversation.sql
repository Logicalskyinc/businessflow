-- Store Grey's conversation identifier separately from BusinessFlow's conversation id.
alter table public.businessflow_conversations
  add column if not exists grey_conversation_id uuid;

grant update (title, updated_at, grey_conversation_id)
  on public.businessflow_conversations to authenticated;

-- Freeze the workspace snapshot per user message so retries send the identical
-- payload to Grey and remain compatible with Grey's request-idempotency check.
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

revoke all on function public.businessflow_set_message_context(uuid, jsonb) from public, anon;
grant execute on function public.businessflow_set_message_context(uuid, jsonb) to authenticated;
