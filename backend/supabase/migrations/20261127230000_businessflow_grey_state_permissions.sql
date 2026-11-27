-- Restrict browser-controlled writes to Grey-managed conversation state.
--
-- Conversation creation is performed through the authenticated API and only
-- supplies business_id, created_by, and title. Grey state is written through
-- the SECURITY DEFINER initialization RPCs, not directly by the browser.
--
-- Revoke the table-level INSERT grant first. A table-level grant would
-- override any narrower column-level INSERT restrictions.
revoke insert on table public.businessflow_conversations from authenticated;

grant insert (business_id, created_by, title)
  on table public.businessflow_conversations to authenticated;

-- Grey conversation IDs are written only by
-- businessflow_complete_grey_initialization(). Keep the browser role from
-- bypassing that token-checked RPC.
revoke update (grey_conversation_id)
  on table public.businessflow_conversations from authenticated;

-- Preserve the existing title/updated_at column-level UPDATE grant.
