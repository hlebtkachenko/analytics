-- Entity access is granted, never assumed. A member or admin reaches an entity only through a
-- stored scope, so a member without a scope row now resolves to no access instead of all access
-- (the resolver default flips in application code). Every admin or member invitation therefore
-- carries the scope its acceptance will apply. Two companion tables hold that scope until the
-- invitation is accepted, and two definer functions write it at invite time and apply it at accept
-- time. Both run as bap_owner and are callable by bap_auth, which still holds nothing directly in
-- schema app. Forward-only and additive: pre-launch data has no pending invitations to backfill.

-- The scope chosen for one invitation, keyed by its id. The cross-schema foreign key drops the
-- scope when the invitation is deleted with its organization or inviter.
CREATE TABLE IF NOT EXISTS app.invitation_entity_scope (
  invitation_id text PRIMARY KEY,
  organization_id text NOT NULL,
  mode text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitation_entity_scope_mode_check CHECK (mode IN ('all', 'restricted')),
  CONSTRAINT invitation_entity_scope_invitation_fkey FOREIGN KEY (invitation_id)
    REFERENCES auth.invitation(id) ON DELETE CASCADE
);

-- Only read when the invitation scope mode is 'restricted'; each row names one granted entity.
CREATE TABLE IF NOT EXISTS app.invitation_legal_entity_access (
  invitation_id text NOT NULL,
  legal_entity_id uuid NOT NULL,
  CONSTRAINT invitation_legal_entity_access_pkey PRIMARY KEY (invitation_id, legal_entity_id),
  CONSTRAINT invitation_legal_entity_access_scope_fkey FOREIGN KEY (invitation_id)
    REFERENCES app.invitation_entity_scope(invitation_id) ON DELETE CASCADE
);

ALTER TABLE app.invitation_entity_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_entity_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_legal_entity_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation_legal_entity_access FORCE ROW LEVEL SECURITY;

-- Only the definer functions below, running as bap_owner, ever touch these tables; no request
-- facing role holds a grant here, so one owner maintenance policy per table is enough.
CREATE POLICY invitation_entity_scope_maintenance ON app.invitation_entity_scope
  FOR ALL TO bap_owner USING (true) WITH CHECK (true);
CREATE POLICY invitation_legal_entity_access_maintenance ON app.invitation_legal_entity_access
  FOR ALL TO bap_owner USING (true) WITH CHECK (true);

-- Applying an accepted invitation inserts the member scope as bap_owner, so the owner needs an
-- insert and update path through FORCE row level security, alongside the select and delete
-- maintenance policies added with the scope tables.
CREATE POLICY member_entity_scope_maintenance_insert ON app.member_entity_scope
  FOR INSERT TO bap_owner WITH CHECK (true);
CREATE POLICY member_entity_scope_maintenance_update ON app.member_entity_scope
  FOR UPDATE TO bap_owner USING (true) WITH CHECK (true);
CREATE POLICY legal_entity_access_maintenance_insert ON app.legal_entity_access
  FOR INSERT TO bap_owner WITH CHECK (true);

-- Stores the entity scope an owner chose for an invitation. Runs as bap_owner so it can read the
-- organization's entities and write the app tables; bap_auth calls it after Better Auth creates
-- the invitation. Tenant context is set from the argument, never from a caller GUC.
CREATE OR REPLACE FUNCTION auth.write_invitation_entity_scope(
  p_invitation_id text,
  p_organization_id text,
  p_mode text,
  p_legal_entity_ids uuid[],
  p_created_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth
AS $$
DECLARE
  provided_count integer := coalesce(array_length(p_legal_entity_ids, 1), 0);
  distinct_count integer;
  known_count integer;
BEGIN
  IF coalesce(p_invitation_id, '') = '' OR coalesce(p_organization_id, '') = '' THEN
    RAISE EXCEPTION 'An invitation scope requires an invitation and an organization'
      USING ERRCODE = 'BP007';
  END IF;

  IF p_mode NOT IN ('all', 'restricted') THEN
    RAISE EXCEPTION 'An invitation scope mode must be all or restricted' USING ERRCODE = 'BP007';
  END IF;

  IF p_mode = 'all' AND provided_count > 0 THEN
    RAISE EXCEPTION 'An all invitation scope carries no entities' USING ERRCODE = 'BP007';
  END IF;

  IF p_mode = 'restricted' AND provided_count = 0 THEN
    RAISE EXCEPTION 'A restricted invitation scope needs at least one entity' USING ERRCODE = 'BP007';
  END IF;

  -- The entity read passes the tenant select policy only inside its own organization.
  PERFORM set_config('bap.organization_id', p_organization_id, true);

  IF p_mode = 'restricted' THEN
    SELECT count(*) INTO distinct_count
    FROM (SELECT DISTINCT entity_id FROM unnest(p_legal_entity_ids) AS entity_id) AS distinct_ids;

    SELECT count(*) INTO known_count
    FROM app.legal_entity
    WHERE organization_id = p_organization_id
      AND id = any(p_legal_entity_ids);

    IF known_count <> distinct_count THEN
      RAISE EXCEPTION 'An invitation scope names an unknown entity' USING ERRCODE = 'BP008';
    END IF;
  END IF;

  INSERT INTO app.invitation_entity_scope (invitation_id, organization_id, mode, created_by)
  VALUES (p_invitation_id, p_organization_id, p_mode, p_created_by)
  ON CONFLICT (invitation_id) DO UPDATE
    SET organization_id = excluded.organization_id,
        mode = excluded.mode,
        created_by = excluded.created_by,
        created_at = now();

  DELETE FROM app.invitation_legal_entity_access WHERE invitation_id = p_invitation_id;

  IF p_mode = 'restricted' THEN
    INSERT INTO app.invitation_legal_entity_access (invitation_id, legal_entity_id)
    SELECT p_invitation_id, entity_id
    FROM (SELECT DISTINCT entity_id FROM unnest(p_legal_entity_ids) AS entity_id) AS distinct_ids;
  END IF;
END;
$$;

ALTER FUNCTION auth.write_invitation_entity_scope(text, text, text, uuid[], text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.write_invitation_entity_scope(text, text, text, uuid[], text) FROM PUBLIC;
-- The web BFF calls this through the bap_auth pool, the role that owns the auth.invitation write.
GRANT EXECUTE ON FUNCTION auth.write_invitation_entity_scope(text, text, text, uuid[], text) TO bap_auth;

-- Applies the stored invitation scope to the new membership and removes the invitation scope.
-- Runs as bap_owner; bap_auth calls it from the accept-invitation hook. A missing scope row leaves
-- the member with no stored scope, which the resolver now reads as no entity access. Foreign or
-- deleted entities are filtered out, so a stale grant never blocks acceptance.
CREATE OR REPLACE FUNCTION auth.apply_invitation_entity_scope(
  p_invitation_id text,
  p_organization_id text,
  p_user_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth
AS $$
DECLARE
  scope_mode text;
  scope_author text;
  granted_count integer := 0;
BEGIN
  SELECT mode, created_by INTO scope_mode, scope_author
  FROM app.invitation_entity_scope
  WHERE invitation_id = p_invitation_id AND organization_id = p_organization_id;

  IF scope_mode IS NULL THEN
    RETURN;
  END IF;

  -- Tenant context for the entity read, the scope write and the audit entry.
  PERFORM set_config('bap.organization_id', p_organization_id, true);
  PERFORM set_config('bap.user_id', p_user_id, true);

  INSERT INTO app.member_entity_scope (organization_id, user_id, mode, updated_by)
  VALUES (p_organization_id, p_user_id, scope_mode, scope_author)
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now();

  IF scope_mode = 'restricted' THEN
    INSERT INTO app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by)
    SELECT p_organization_id, p_user_id, invited.legal_entity_id, scope_author
    FROM app.invitation_legal_entity_access AS invited
    INNER JOIN app.legal_entity AS entity
      ON entity.id = invited.legal_entity_id AND entity.organization_id = p_organization_id
    WHERE invited.invitation_id = p_invitation_id
    ON CONFLICT (organization_id, user_id, legal_entity_id) DO NOTHING;
    GET DIAGNOSTICS granted_count = ROW_COUNT;
  END IF;

  DELETE FROM app.invitation_entity_scope WHERE invitation_id = p_invitation_id;

  PERFORM app.record_audit(
    'member_entity_scope.granted',
    'member',
    p_user_id,
    jsonb_build_object('mode', scope_mode, 'entities', granted_count)
  );
END;
$$;

ALTER FUNCTION auth.apply_invitation_entity_scope(text, text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.apply_invitation_entity_scope(text, text, text) FROM PUBLIC;
-- The web BFF calls this through the bap_auth pool from the accept-invitation hook.
GRANT EXECUTE ON FUNCTION auth.apply_invitation_entity_scope(text, text, text) TO bap_auth;
