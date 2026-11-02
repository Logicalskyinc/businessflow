-- Preserve the assistant selected for each message and keep Grey linkage writable by the tenant.
alter table public.businessflow_messages
  add column if not exists assistant_mode text not null default 'businessflow'
  check (assistant_mode in ('businessflow', 'oyosky', 'grey'));

grant update (grey_conversation_id) on public.businessflow_conversations to authenticated;
grant insert (conversation_id, created_by, role, content, client_message_id, assistant_mode)
  on public.businessflow_messages to authenticated;

create or replace function public.businessflow_append_assistant_message(
  p_conversation_id uuid,
  p_reply_to_message_id uuid,
  p_content text,
  p_assistant_mode text
) returns public.businessflow_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.businessflow_messages;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_content is null or char_length(p_content) not between 1 and 8000 then
    raise exception 'invalid_message_content' using errcode = '22023';
  end if;
  if p_assistant_mode not in ('businessflow', 'oyosky', 'grey') then
    raise exception 'invalid_assistant_mode' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.businessflow_conversations c
    join public.businessflow_profiles p on p.id = c.business_id
    where c.id = p_conversation_id and p.owner_user_id = v_user_id
  ) then
    raise exception 'conversation_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.businessflow_messages m
    where m.id = p_reply_to_message_id
      and m.conversation_id = p_conversation_id
      and m.created_by = v_user_id and m.role = 'user'
  ) then
    raise exception 'user_message_not_found' using errcode = '42501';
  end if;

  insert into public.businessflow_messages
    (conversation_id, created_by, role, content, reply_to_message_id, assistant_mode)
  values
    (p_conversation_id, v_user_id, 'assistant', p_content, p_reply_to_message_id, p_assistant_mode)
  on conflict (reply_to_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select * into v_message from public.businessflow_messages
    where reply_to_message_id = p_reply_to_message_id;
  end if;
  return v_message;
end;
$$;

revoke all on function public.businessflow_append_assistant_message(uuid, uuid, text, text) from public, anon;
grant execute on function public.businessflow_append_assistant_message(uuid, uuid, text, text) to authenticated;
