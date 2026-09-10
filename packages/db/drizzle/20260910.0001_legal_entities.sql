-- Two level tenancy: the organization stays the only row level security boundary and gains legal entities inside it.
-- Entity selection and the restricted member scope are application level filters; no policy here filters by entity.
-- A development database holding datasets must be reset first: the two new columns are NOT NULL without a default.

CREATE TABLE IF NOT EXISTS app.legal_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name text NOT NULL,
  -- Closed vocabulary: a third kind is a product decision, so it takes a migration.
  kind text NOT NULL,
  registration_number text,
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entity_kind_check CHECK (kind IN ('company', 'sole_trader')),
  CONSTRAINT legal_entity_name_check CHECK (length(name) BETWEEN 1 AND 200),
  -- The same bound and alphabet the API validates, so a bypassed boundary still cannot store free text.
  CONSTRAINT legal_entity_registration_number_check
    CHECK (registration_number IS NULL OR registration_number ~ '^[A-Za-z0-9-]{1,32}$'),
  CONSTRAINT legal_entity_organization_name_key UNIQUE (organization_id, name),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT legal_entity_id_organization_key UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS legal_entity_organization_id_idx ON app.legal_entity(organization_id, created_at DESC);

-- One row per member: absent means the default 'all', so an unscoped member needs no row at all.
CREATE TABLE IF NOT EXISTS app.member_entity_scope (
  organization_id text NOT NULL,
  user_id text NOT NULL,
  mode text NOT NULL DEFAULT 'all',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Leading organization_id makes the primary key index the tenant index too.
  CONSTRAINT member_entity_scope_pkey PRIMARY KEY (organization_id, user_id),
  CONSTRAINT member_entity_scope_mode_check CHECK (mode IN ('all', 'restricted'))
);

-- Only read when the scope mode is 'restricted'; a stale row under mode 'all' grants nothing.
CREATE TABLE IF NOT EXISTS app.legal_entity_access (
  organization_id text NOT NULL,
  user_id text NOT NULL,
  legal_entity_id uuid NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entity_access_pkey PRIMARY KEY (organization_id, user_id, legal_entity_id),
  -- Composite foreign key makes the denormalized organization_id provably equal to the entity's.
  CONSTRAINT legal_entity_access_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS legal_entity_access_entity_idx
  ON app.legal_entity_access(organization_id, legal_entity_id);

-- NOT NULL without a default on purpose: every dataset and upload belongs to exactly one entity.
ALTER TABLE app.dataset ADD COLUMN legal_entity_id uuid NOT NULL;
ALTER TABLE app.upload ADD COLUMN legal_entity_id uuid NOT NULL;

ALTER TABLE app.dataset
  ADD CONSTRAINT dataset_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE;
ALTER TABLE app.upload
  ADD CONSTRAINT upload_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE;

-- Leading organization_id keeps the tenant predicate on an index; the entity filter is the second column.
CREATE INDEX IF NOT EXISTS dataset_legal_entity_id_idx
  ON app.dataset(organization_id, legal_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_legal_entity_id_idx
  ON app.upload(organization_id, legal_entity_id, created_at DESC);

-- The role travels only inside the tenant transaction, exactly like the organization and the subject.
-- SECURITY INVOKER and STABLE: these read the transaction setting and nothing else, so no definer power is needed.
CREATE OR REPLACE FUNCTION app.role_can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT coalesce(current_setting('bap.role', true), '') IN ('owner', 'admin')
$$;

CREATE OR REPLACE FUNCTION app.role_is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT coalesce(current_setting('bap.role', true), '') = 'owner'
$$;

ALTER FUNCTION app.role_can_write() OWNER TO bap_owner;
ALTER FUNCTION app.role_is_owner() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.role_can_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.role_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.role_can_write() TO bap_api;
GRANT EXECUTE ON FUNCTION app.role_is_owner() TO bap_api;

-- Writing follows visibility and the caller's role: per dataset grants are gone, so authorship confers nothing.
CREATE OR REPLACE FUNCTION app.dataset_is_writable(target_dataset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT app.role_can_write()
    AND EXISTS (
      SELECT 1 FROM app.dataset AS writable WHERE writable.id = target_dataset_id
    )
$$;

ALTER TABLE app.legal_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legal_entity FORCE ROW LEVEL SECURITY;
ALTER TABLE app.member_entity_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member_entity_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE app.legal_entity_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legal_entity_access FORCE ROW LEVEL SECURITY;

-- Reading an entity is a member level action; creating and editing one needs owner or admin.
CREATE POLICY legal_entity_select ON app.legal_entity FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY legal_entity_insert ON app.legal_entity FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY legal_entity_update ON app.legal_entity FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

-- Deleting an entity destroys its datasets and uploads by cascade, so it stays with the owner.
CREATE POLICY legal_entity_delete ON app.legal_entity FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  );

-- Who may see which entity is a membership decision, so every scope and access write needs the owner.
CREATE POLICY member_entity_scope_select ON app.member_entity_scope FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY member_entity_scope_insert ON app.member_entity_scope FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND updated_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY member_entity_scope_update ON app.member_entity_scope FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND updated_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY member_entity_scope_delete ON app.member_entity_scope FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY legal_entity_access_select ON app.legal_entity_access FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY legal_entity_access_insert ON app.legal_entity_access FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY legal_entity_access_update ON app.legal_entity_access FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY legal_entity_access_delete ON app.legal_entity_access FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  );

-- Reading is organization wide now: the creator and grant conditions leave the dataset SELECT policy.
-- Entity scope is deliberately absent here; the application resolver applies it, as ADR 0011 decided.
DROP POLICY dataset_select ON app.dataset;
DROP POLICY dataset_insert ON app.dataset;
DROP POLICY dataset_update ON app.dataset;
DROP POLICY dataset_delete ON app.dataset;

CREATE POLICY dataset_select ON app.dataset FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY dataset_insert ON app.dataset FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY dataset_update ON app.dataset FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY dataset_delete ON app.dataset FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

-- app.dataset_column, app.dataset_row and app.dataset_embedding keep their per command policies unchanged:
-- both helpers are redefined above, so those tables inherit organization wide reads and the role gated writes.

-- Uploads were one ALL policy, which would have let the read clause govern DELETE once reading widened.
DROP POLICY upload_isolation ON app.upload;

CREATE POLICY upload_select ON app.upload FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY upload_insert ON app.upload FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY upload_update ON app.upload FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY upload_delete ON app.upload FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

-- app.data_grants disappears with per dataset sharing, and the three new tables take its place in the erasure.
-- A scope row of the erased subject is deleted outright: the membership it described is gone with the identity.
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
    SELECT 1 FROM app.dataset WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.member_entity_scope
    WHERE user_id = subject_user_id OR updated_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity_access
    WHERE user_id = subject_user_id OR created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

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

  RETURN tombstone;
END;
$$;

DROP POLICY data_grants_isolation ON app.data_grants;
REVOKE ALL ON app.data_grants FROM bap_api, bap_reporting, bap_backup;
REVOKE ALL (user_id) ON app.data_grants FROM bap_eraser;
DROP TABLE app.data_grants;

GRANT USAGE ON SCHEMA app TO bap_api, bap_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.legal_entity, app.member_entity_scope, app.legal_entity_access TO bap_api;
GRANT SELECT ON app.legal_entity, app.member_entity_scope, app.legal_entity_access TO bap_reporting;

-- Default privileges under bap_owner already cover these, but the whole database dump must not depend on them.
GRANT SELECT ON app.legal_entity, app.member_entity_scope, app.legal_entity_access TO bap_backup;

-- The eraser keeps column-scoped grants only, plus the DELETE it needs for the subject's own scope rows.
-- DELETE has no column form in PostgreSQL, so these two tables are the eraser's only table-wide privilege.
GRANT SELECT (created_by), UPDATE (created_by) ON app.legal_entity TO bap_eraser;
GRANT SELECT (user_id, updated_by), UPDATE (updated_by) ON app.member_entity_scope TO bap_eraser;
GRANT SELECT (user_id, created_by), UPDATE (created_by) ON app.legal_entity_access TO bap_eraser;
GRANT DELETE ON app.member_entity_scope, app.legal_entity_access TO bap_eraser;
