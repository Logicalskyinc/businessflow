-- BusinessFlow Intelligence conversation history.
create table if not exists public.businessflow_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businessflow_profiles(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists businessflow_conversations_business_updated_idx
  on public.businessflow_conversations (business_id, updated_at desc);

create table if not exists public.businessflow_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.businessflow_conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  client_message_id uuid,
  reply_to_message_id uuid references public.businessflow_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint businessflow_messages_client_id_unique unique (conversation_id, client_message_id),
  constraint businessflow_messages_reply_unique unique (reply_to_message_id)
);

create index if not exists businessflow_messages_conversation_created_idx
  on public.businessflow_messages (conversation_id, created_at asc);

alter table public.businessflow_conversations enable row level security;
alter table public.businessflow_messages enable row level security;

create policy "Business owners read conversations"
  on public.businessflow_conversations for select to authenticated
  using (exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  ));

create policy "Business owners create conversations"
  on public.businessflow_conversations for insert to authenticated
  with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public.businessflow_profiles p
      where p.id = business_id and p.owner_user_id = (select auth.uid())
    )
  );

create policy "Business owners update conversations"
  on public.businessflow_conversations for update to authenticated
  using (exists (
    select 1 from public.businessflow_profiles p
    where p.id = business_id and p.owner_user_id = (select auth.uid())
  ))
  with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public.businessflow_profiles p
      where p.id = business_id and p.owner_user_id = (select auth.uid())
    )
  );

create policy "Business owners read messages"
  on public.businessflow_messages for select to authenticated
  using (exists (
    select 1 from public.businessflow_conversations c
    join public.businessflow_profiles p on p.id = c.business_id
    where c.id = conversation_id and p.owner_user_id = (select auth.uid())
  ));

create policy "Business owners add user messages"
  on public.businessflow_messages for insert to authenticated
  with check (
    role = 'user' and created_by = (select auth.uid())
    and client_message_id is not null and reply_to_message_id is null
    and exists (
      select 1 from public.businessflow_conversations c
      join public.businessflow_profiles p on p.id = c.business_id
      where c.id = conversation_id and p.owner_user_id = (select auth.uid())
    )
  );

revoke all on public.businessflow_conversations, public.businessflow_messages from anon;
grant select, insert on public.businessflow_conversations to authenticated;
grant update (title, updated_at) on public.businessflow_conversations to authenticated;
grant select, insert on public.businessflow_messages to authenticated;

create or replace function public.businessflow_append_assistant_message(
  p_conversation_id uuid,
  p_reply_to_message_id uuid,
  p_content text
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
    (conversation_id, created_by, role, content, reply_to_message_id)
  values
    (p_conversation_id, v_user_id, 'assistant', p_content, p_reply_to_message_id)
  on conflict (reply_to_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select * into v_message from public.businessflow_messages
    where reply_to_message_id = p_reply_to_message_id;
  end if;
  return v_message;
end;
$$;

revoke all on function public.businessflow_append_assistant_message(uuid, uuid, text) from public, anon;
grant execute on function public.businessflow_append_assistant_message(uuid, uuid, text) to authenticated;
