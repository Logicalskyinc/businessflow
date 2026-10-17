-- Restrict the SECURITY DEFINER event-trigger function to trusted database administration.
-- It is not an application RPC and must not be callable through the exposed public API.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
