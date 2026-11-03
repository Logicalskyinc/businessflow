-- Store Grey's conversation identifier separately from BusinessFlow's conversation id.
alter table public.businessflow_conversations
  add column if not exists grey_conversation_id uuid;

grant update (title, updated_at, grey_conversation_id)
  on public.businessflow_conversations to authenticated;
