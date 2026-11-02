-- Link a BusinessFlow conversation to its tenant-scoped persistent Grey conversation.
alter table public.businessflow_conversations
  add column if not exists grey_conversation_id text;

create unique index if not exists businessflow_conversations_grey_conversation_unique
  on public.businessflow_conversations (grey_conversation_id)
  where grey_conversation_id is not null;
