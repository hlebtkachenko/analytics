-- Member status: an active or inactive flag on the Better-Auth-owned membership row.
-- Forward-only and additive: the column takes a fast default, so no table rewrite runs.
-- Inactive means zero access everywhere, while the row is retained so audit history survives.

-- Fast default in PostgreSQL: the existing rows read 'active' without a rewrite.
ALTER TABLE auth.member
  ADD COLUMN status text NOT NULL DEFAULT 'active';

ALTER TABLE auth.member
  ADD CONSTRAINT member_status_check CHECK (status IN ('active', 'inactive'));

-- Membership resolution now excludes an inactive member, so every access resolver that reads it denies at once.
CREATE OR REPLACE FUNCTION auth.resolve_membership(subject_id text, organization_id text)
RETURNS TABLE(email_verified boolean, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
  SELECT u.email_verified, m.role
  FROM auth.member AS m
  INNER JOIN auth."user" AS u ON u.id = m.user_id
  WHERE m.user_id = $1
    AND m.organization_id = $2
    AND m.status = 'active'
    AND u.email_verified = true
$$;

ALTER FUNCTION auth.resolve_membership(text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.resolve_membership(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.resolve_membership(text, text) TO bap_api, bap_reporting;

-- The only status writer: bap_api never holds DML on auth.member, so the change goes through this definer.
-- Organization, actor and role come from the transaction context, never from an argument, exactly like app.record_audit.
CREATE OR REPLACE FUNCTION auth.set_member_status(subject_user_id text, new_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
  context_user_id text := current_setting('bap.user_id', true);
  context_role text := current_setting('bap.role', true);
  previous_status text;
  subject_role text;
BEGIN
  IF coalesce(context_organization_id, '') = '' OR coalesce(context_user_id, '') = '' THEN
    RAISE EXCEPTION 'Member status changes require tenant and actor context'
      USING ERRCODE = 'BP002';
  END IF;

  IF new_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Member status must be active or inactive'
      USING ERRCODE = 'BP001';
  END IF;

  -- Acting on another member is owner-only; acting on self may only deactivate (leave), never self-reactivate.
  IF subject_user_id <> context_user_id THEN
    IF coalesce(context_role, '') <> 'owner' THEN
      RAISE EXCEPTION 'Only an owner may change another member status'
        USING ERRCODE = 'BP003';
    END IF;
  ELSIF new_status <> 'inactive' THEN
    RAISE EXCEPTION 'A member may only deactivate their own membership'
      USING ERRCODE = 'BP003';
  END IF;

  -- Serialize the last-owner decision per organization so two concurrent deactivations cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext(context_organization_id));

  SELECT m.status, m.role
  INTO previous_status, subject_role
  FROM auth.member AS m
  WHERE m.organization_id = context_organization_id
    AND m.user_id = subject_user_id;

  -- A row absent from this organization is not found, and never leaks another organization's membership.
  IF previous_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- The last active owner may never be deactivated, or the organization would lock itself out.
  IF new_status = 'inactive'
     AND previous_status = 'active'
     AND 'owner' = any(string_to_array(subject_role, ','))
     AND NOT EXISTS (
       SELECT 1
       FROM auth.member AS other_owner
       WHERE other_owner.organization_id = context_organization_id
         AND other_owner.user_id <> subject_user_id
         AND other_owner.status = 'active'
         AND 'owner' = any(string_to_array(other_owner.role, ','))
     ) THEN
    RAISE EXCEPTION 'The last active owner cannot be deactivated'
      USING ERRCODE = 'BP004';
  END IF;

  UPDATE auth.member AS m
  SET status = new_status
  WHERE m.organization_id = context_organization_id
    AND m.user_id = subject_user_id;

  RETURN previous_status;
END;
$$;

ALTER FUNCTION auth.set_member_status(text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.set_member_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.set_member_status(text, text) TO bap_api;

-- Erasure also tombstones the member audit resource_id: metadata is never rewritten, so it must carry no name or email.
CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN
    RAISE EXCEPTION 'User erasure requires an explicit subject';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.audit_log
    WHERE resource_type = 'member' AND resource_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.dataset WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.member_entity_scope
    WHERE user_id = subject_user_id OR updated_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity_access
    WHERE user_id = subject_user_id OR created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.partner WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_link WHERE created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

  -- A member action records its subject as the resource_id, so erasure tombstones that too.
  UPDATE app.audit_log
  SET resource_id = tombstone
  WHERE resource_type = 'member' AND resource_id = subject_user_id;

  UPDATE app.dataset
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.legal_entity
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  DELETE FROM app.legal_entity_access
  WHERE user_id = subject_user_id;

  DELETE FROM app.member_entity_scope
  WHERE user_id = subject_user_id;

  -- Rows the subject wrote for someone else survive, attributed to the tombstone.
  UPDATE app.member_entity_scope
  SET updated_by = tombstone
  WHERE updated_by = subject_user_id;

  UPDATE app.legal_entity_access
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.partner
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document_link
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;

ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;

-- The eraser rewrites the member resource_id as well: it reads resource_type to target member rows and writes resource_id.
GRANT SELECT (user_id, resource_id, resource_type), UPDATE (user_id, resource_id) ON app.audit_log TO bap_eraser;
