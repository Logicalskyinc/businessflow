-- Prepared security hardening for the existing BusinessFlow Supabase project.
-- This is a review script, not an applied migration. Apply through a tracked
-- Supabase migration after the release owner approves the database change.

revoke all on table
  public.businessflow_profiles,
  public.businessflow_memberships,
  public.businessflow_goals,
  public.businessflow_experiments,
  public.businessflow_memory,
  public.businessflow_imports,
  public.businessflow_conversations,
  public.businessflow_messages
from anon, authenticated, public;

grant select, insert, update
  on table public.businessflow_profiles to authenticated;

grant select, insert
  on table public.businessflow_memberships to authenticated;

grant select, insert, update, delete
  on table
    public.businessflow_goals,
    public.businessflow_experiments,
    public.businessflow_memory
to authenticated;

grant select, insert, delete
  on table public.businessflow_imports to authenticated;

grant select, insert
  on table public.businessflow_conversations to authenticated;

grant update (title, updated_at)
  on table public.businessflow_conversations to authenticated;

grant select
  on table public.businessflow_messages to authenticated;

-- The API inserts user messages directly. RLS limits these to owner-authored
-- user messages with a client_message_id. Assistant replies use the RPC.
grant insert (conversation_id, created_by, role, content, client_message_id)
  on table public.businessflow_messages to authenticated;
