-- Exactly one owner per organization, plus an atomic ownership transfer.
-- The trigger caps active owners at one; the definer function is the only writer
-- that promotes a new owner, and it demotes the sitting owner first so the trigger
-- never observes two active owners at once. Forward-only and additive: pre-launch
-- data has a single owner per organization, so no backfill runs.

-- Fires per row before a member is inserted or has its role changed. A row that
-- would itself be an active owner is refused when the organization already keeps
-- another active owner, matching the active-owner filter used everywhere else.
CREATE OR REPLACE FUNCTION auth.enforce_single_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
BEGIN
  IF 'owner' = any(string_to_array(NEW.role, ',')) THEN
    IF EXISTS (
      SELECT 1
      FROM auth.member AS existing_owner
      WHERE existing_owner.organization_id = NEW.organization_id
        AND existing_owner.user_id <> NEW.user_id
        AND existing_owner.status = 'active'
        AND 'owner' = any(string_to_array(existing_owner.role, ','))
    ) THEN
      RAISE EXCEPTION 'An organization may keep only one active owner'
        USING ERRCODE = 'BP005';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION auth.enforce_single_owner() OWNER TO bap_owner;

DROP TRIGGER IF EXISTS member_single_owner ON auth.member;
CREATE TRIGGER member_single_owner
  BEFORE INSERT OR UPDATE OF role ON auth.member
  FOR EACH ROW
  EXECUTE FUNCTION auth.enforce_single_owner();

-- The only writer that promotes a new owner. In one transaction it verifies the
-- caller is the sitting active owner and the target an active member, demotes the
-- caller to admin, promotes the target to owner, and audits the swap. The demote
-- runs first so member_single_owner never sees two active owners. Actor and tenant
-- context are set here for app.record_audit, never taken from a caller argument.
CREATE OR REPLACE FUNCTION auth.transfer_ownership(
  p_organization_id text,
  p_from_user_id text,
  p_to_user_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  from_role text;
  to_status text;
BEGIN
  IF coalesce(p_organization_id, '') = ''
     OR coalesce(p_from_user_id, '') = ''
     OR coalesce(p_to_user_id, '') = '' THEN
    RAISE EXCEPTION 'Ownership transfer requires an organization and both members'
      USING ERRCODE = 'BP006';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Ownership cannot transfer to the current owner'
      USING ERRCODE = 'BP006';
  END IF;

  -- Serialize the transfer per organization so two cannot interleave into two owners.
  PERFORM pg_advisory_xact_lock(hashtext(p_organization_id));

  SELECT m.role
  INTO from_role
  FROM auth.member AS m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_from_user_id
    AND m.status = 'active';

  IF from_role IS NULL OR NOT ('owner' = any(string_to_array(from_role, ','))) THEN
    RAISE EXCEPTION 'Only the current owner may transfer ownership'
      USING ERRCODE = 'BP006';
  END IF;

  SELECT m.status
  INTO to_status
  FROM auth.member AS m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_to_user_id;

  IF to_status IS NULL OR to_status <> 'active' THEN
    RAISE EXCEPTION 'Ownership can only transfer to an active member'
      USING ERRCODE = 'BP006';
  END IF;

  -- Demote first so the single-owner trigger never observes two active owners.
  UPDATE auth.member AS m
  SET role = 'admin'
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_from_user_id;

  UPDATE auth.member AS m
  SET role = 'owner'
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_to_user_id;

  -- Audit under the acting owner and this tenant, exactly like the other member writes.
  PERFORM set_config('bap.organization_id', p_organization_id, true);
  PERFORM set_config('bap.user_id', p_from_user_id, true);
  PERFORM app.record_audit(
    'organization.ownership_transferred',
    'member',
    p_to_user_id,
    jsonb_build_object('from_user_id', p_from_user_id, 'to_user_id', p_to_user_id)
  );
END;
$$;

ALTER FUNCTION auth.transfer_ownership(text, text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.transfer_ownership(text, text, text) FROM PUBLIC;
-- The web BFF calls this through the bap_auth pool, the role that owns auth.member writes.
GRANT EXECUTE ON FUNCTION auth.transfer_ownership(text, text, text) TO bap_auth;
