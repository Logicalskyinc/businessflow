-- Starter plan: maximum two business workspaces per account.
-- Locking the owning auth.users row serializes concurrent inserts for one owner.
CREATE OR REPLACE FUNCTION public.enforce_businessflow_workspace_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  existing_count integer;
BEGIN
  PERFORM 1 FROM auth.users WHERE id = NEW.owner_user_id FOR UPDATE;

  SELECT count(*) INTO existing_count
  FROM public.businessflow_profiles
  WHERE owner_user_id = NEW.owner_user_id;

  IF existing_count >= 2 THEN
    RAISE EXCEPTION 'businessflow_workspace_limit_reached'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_businessflow_workspace_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS businessflow_workspace_limit_before_insert ON public.businessflow_profiles;
CREATE TRIGGER businessflow_workspace_limit_before_insert
BEFORE INSERT ON public.businessflow_profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_businessflow_workspace_limit();
