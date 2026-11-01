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

-- Assistant messages are written only by the ownership-checking RPC.
-- Direct client inserts are intentionally not granted.
