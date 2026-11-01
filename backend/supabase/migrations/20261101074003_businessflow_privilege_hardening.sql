-- Restrict direct Data API privileges to the operations used by BusinessFlow.
-- RLS remains the row-level authorization boundary; these grants remove
-- dangerous table-level capabilities such as TRUNCATE and broad UPDATE/DELETE.

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

-- The API inserts user messages directly. The RLS INSERT policy restricts
-- these rows to role='user', the authenticated owner, and a client message ID.
-- Assistant messages remain restricted to the ownership-checking SECURITY
-- DEFINER RPC and cannot be inserted directly by authenticated clients.
grant insert (conversation_id, created_by, role, content, client_message_id)
  on table public.businessflow_messages to authenticated;
