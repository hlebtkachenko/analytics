-- Inbox runtime (Phase 1b-runtime): per organization routing targets, the inbox setting row,
-- the stalled event reason and three maintenance definers for the organization-less worker tick.
-- No routing target is seeded: a missing row means the platform default of routing-targets.ts.

-- One row per detected type an organization overrides; the platform constant covers every other type.
CREATE TABLE IF NOT EXISTS app.inbox_routing_target (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  detected_type text NOT NULL,
  destination text NOT NULL,
  -- Named exactly when the destination is the documents register.
  document_kind text,
  default_legal_entity_id uuid,
  partner_policy text NOT NULL DEFAULT 'match_only',
  auto text NOT NULL DEFAULT 'never',
  auto_threshold numeric(3, 2),
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  default_assignee_id text,
  required_fields text[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL DEFAULT current_setting('bap.user_id', true),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Refreshed on every PUT: the rules auto-route runs as the account that saved the row.
  updated_by text NOT NULL DEFAULT current_setting('bap.user_id', true),
  CONSTRAINT inbox_routing_target_detected_type_check
    CHECK (detected_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_routing_target_destination_check
    CHECK (destination IN ('documents', 'datasets', 'discard')),
  CONSTRAINT inbox_routing_target_document_kind_check
    CHECK ((destination = 'documents') = (document_kind IS NOT NULL)),
  -- Only the value this phase consumes; the partner route widens it later.
  CONSTRAINT inbox_routing_target_partner_policy_check CHECK (partner_policy IN ('match_only')),
  CONSTRAINT inbox_routing_target_auto_check CHECK (auto IN ('never', 'above_threshold', 'always')),
  CONSTRAINT inbox_routing_target_auto_threshold_check
    CHECK (auto_threshold IS NULL OR (auto_threshold >= 0 AND auto_threshold <= 1)),
  CONSTRAINT inbox_routing_target_auto_threshold_required_check
    CHECK (auto <> 'above_threshold' OR auto_threshold IS NOT NULL),
  CONSTRAINT inbox_routing_target_required_fields_check
    CHECK (array_position(required_fields, NULL) IS NULL AND cardinality(required_fields) <= 32),
  CONSTRAINT inbox_routing_target_organization_detected_type_key UNIQUE (organization_id, detected_type),
  CONSTRAINT inbox_routing_target_default_legal_entity_fkey
    FOREIGN KEY (default_legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (default_legal_entity_id)
);

CREATE INDEX IF NOT EXISTS inbox_routing_target_default_legal_entity_idx
  ON app.inbox_routing_target(default_legal_entity_id)
  WHERE default_legal_entity_id IS NOT NULL;

COMMENT ON TABLE app.inbox_routing_target IS
  'An organization override of the platform routing default for one detected type; absent means the platform default.';
COMMENT ON COLUMN app.inbox_routing_target.document_kind IS
  'The register kind an item of this type becomes; set exactly when destination is documents.';
COMMENT ON COLUMN app.inbox_routing_target.auto IS
  'Stored now, consumed by the rules auto-route: never, above_threshold or always.';
COMMENT ON COLUMN app.inbox_routing_target.auto_threshold IS
  'The confidence an automatic route needs, required when auto is above_threshold.';
COMMENT ON COLUMN app.inbox_routing_target.default_assignee_id IS
  'The person new items of this type are assigned to; a subject id, never a name.';
COMMENT ON COLUMN app.inbox_routing_target.required_fields IS
  'Draft field names a person must fill before routing; at most 32, never null.';
COMMENT ON COLUMN app.inbox_routing_target.updated_by IS
  'The account that last saved the row; the rules auto-route runs as this account.';

ALTER TABLE app.inbox_routing_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_routing_target FORCE ROW LEVEL SECURITY;

-- A member reads the targets of the organization; a channel never does, like every non-inbox table.
CREATE POLICY inbox_routing_target_select ON app.inbox_routing_target FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

-- Owner or admin writes; the owner-only rule is the API permission, not the policy.
CREATE POLICY inbox_routing_target_insert ON app.inbox_routing_target FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_routing_target_update ON app.inbox_routing_target FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_routing_target_delete ON app.inbox_routing_target FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON app.inbox_routing_target TO bap_api;
GRANT SELECT ON app.inbox_routing_target TO bap_reporting;
GRANT SELECT ON app.inbox_routing_target TO bap_backup;

-- The eraser keeps column-scoped grants only.
GRANT SELECT (default_assignee_id, created_by, updated_by),
  UPDATE (default_assignee_id, created_by, updated_by) ON app.inbox_routing_target TO bap_eraser;

-- One optional row per organization; it carries one number and no tenant content.
CREATE TABLE IF NOT EXISTS app.organization_inbox_setting (
  -- No foreign key to auth.organization, exactly like every other app table.
  organization_id text PRIMARY KEY,
  -- Null means the platform value; the effective quota is the smaller of the two, so an owner can only tighten.
  blob_quota_bytes bigint,
  created_by text NOT NULL DEFAULT current_setting('bap.user_id', true),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_inbox_setting_blob_quota_bytes_check
    CHECK (blob_quota_bytes IS NULL OR blob_quota_bytes > 0)
);

COMMENT ON TABLE app.organization_inbox_setting IS
  'The per organization inbox setting row; absent or null means the platform value.';
COMMENT ON COLUMN app.organization_inbox_setting.blob_quota_bytes IS
  'The blob quota an owner set, capped by the platform value; null means the platform value.';

ALTER TABLE app.organization_inbox_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_inbox_setting FORCE ROW LEVEL SECURITY;

-- The intake gate runs inside the channel's own transaction, so the channel reads this row too.
CREATE POLICY organization_inbox_setting_select ON app.organization_inbox_setting FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

-- Only an owner sets the quota; the row is reset by nulling the column, never deleted.
CREATE POLICY organization_inbox_setting_insert ON app.organization_inbox_setting FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY organization_inbox_setting_update ON app.organization_inbox_setting FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  );

GRANT SELECT, INSERT, UPDATE ON app.organization_inbox_setting TO bap_api;
GRANT SELECT ON app.organization_inbox_setting TO bap_reporting;
GRANT SELECT ON app.organization_inbox_setting TO bap_backup;
GRANT SELECT (created_by), UPDATE (created_by) ON app.organization_inbox_setting TO bap_eraser;

-- The reaper's reason: a processing item whose handler died before its last attempt finished.
ALTER TABLE app.inbox_event DROP CONSTRAINT IF EXISTS inbox_event_reason_check;
ALTER TABLE app.inbox_event
  ADD CONSTRAINT inbox_event_reason_check CHECK (reason IS NULL OR reason IN (
    'irrelevant', 'duplicate', 'not_ours', 'spam',
    'unsupported_type', 'password_protected', 'encrypted', 'empty', 'unreadable',
    'decorative_image', 'too_large', 'policy_rejected', 'stalled'
  ));

-- FORCE row level security applies to the definers below, which run outside any tenant transaction.
-- These policies admit bap_owner alone; no policy touches inbox_item_file or document_file and blob gains no DELETE.
CREATE POLICY inbox_item_maintenance_select ON app.inbox_item FOR SELECT
  TO bap_owner USING (true);

CREATE POLICY inbox_item_maintenance_update ON app.inbox_item FOR UPDATE
  TO bap_owner USING (true) WITH CHECK (true);

CREATE POLICY inbox_event_maintenance_insert ON app.inbox_event FOR INSERT
  TO bap_owner WITH CHECK (true);

CREATE POLICY blob_maintenance_select ON app.blob FOR SELECT
  TO bap_owner USING (true);

-- The subset of the given hashes that already have a blob row in the organization; the orphan sweep unlinks the rest.
-- Inverse of the record_blob_scan guard: only the organization-less worker tick may call it.
CREATE OR REPLACE FUNCTION app.list_blob_keys(organization_id text, sha256s text[])
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF coalesce(current_setting('bap.organization_id', true), '') <> '' THEN
    RAISE EXCEPTION 'Inbox maintenance runs outside tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT blob.sha256
    FROM app.blob AS blob
    WHERE blob.organization_id = list_blob_keys.organization_id
      AND blob.sha256 = ANY (list_blob_keys.sha256s);
END;
$$;

ALTER FUNCTION app.list_blob_keys(text, text[]) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.list_blob_keys(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_blob_keys(text, text[]) TO bap_api;

-- Fails every processing item untouched for longer than stale and appends one stalled event with no actor.
-- stale is floored to 60 minutes: four attempts plus retry delays never exceed it, so a live handler is never reaped.
CREATE OR REPLACE FUNCTION app.reap_stalled_inbox_items(stale interval, max_rows integer)
RETURNS TABLE (id uuid, organization_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  floored_stale interval := greatest(reap_stalled_inbox_items.stale, interval '60 minutes');
BEGIN
  IF coalesce(current_setting('bap.organization_id', true), '') <> '' THEN
    RAISE EXCEPTION 'Inbox maintenance runs outside tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    WITH candidate AS (
      SELECT item.id, item.organization_id
      FROM app.inbox_item AS item
      WHERE item.status = 'processing'
        AND item.updated_at < now() - floored_stale
      ORDER BY item.updated_at
      LIMIT greatest(reap_stalled_inbox_items.max_rows, 0)
      FOR UPDATE SKIP LOCKED
    ),
    reaped AS (
      UPDATE app.inbox_item AS item
      SET status = 'failed', updated_at = now()
      FROM candidate
      WHERE item.id = candidate.id
      RETURNING item.id, item.organization_id
    ),
    recorded AS (
      INSERT INTO app.inbox_event (organization_id, item_id, kind, reason, actor_user_id)
      SELECT reaped.organization_id, reaped.id, 'failed', 'stalled', NULL
      FROM reaped
    )
    SELECT reaped.id, reaped.organization_id
    FROM reaped;
END;
$$;

ALTER FUNCTION app.reap_stalled_inbox_items(interval, integer) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.reap_stalled_inbox_items(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reap_stalled_inbox_items(interval, integer) TO bap_api;

-- Email parents still received after stale on a live channel: their split enqueue was lost after commit.
-- stale is floored to 10 minutes, far past the post-commit enqueue and the retry delay.
CREATE OR REPLACE FUNCTION app.list_stuck_email_items(stale interval, max_rows integer)
RETURNS TABLE (item_id uuid, channel_id uuid, organization_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  floored_stale interval := greatest(list_stuck_email_items.stale, interval '10 minutes');
BEGIN
  IF coalesce(current_setting('bap.organization_id', true), '') <> '' THEN
    RAISE EXCEPTION 'Inbox maintenance runs outside tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT item.id, item.channel_id, item.organization_id
    FROM app.inbox_item AS item
    INNER JOIN app.inbox_channel AS channel
      ON channel.id = item.channel_id
      AND channel.organization_id = item.organization_id
    WHERE item.payload_kind = 'email'
      AND item.status = 'received'
      AND item.parent_item_id IS NULL
      AND item.received_at < now() - floored_stale
      AND channel.enabled
      AND channel.deleted_at IS NULL
    ORDER BY item.received_at
    LIMIT greatest(list_stuck_email_items.max_rows, 0);
END;
$$;

ALTER FUNCTION app.list_stuck_email_items(interval, integer) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.list_stuck_email_items(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_stuck_email_items(interval, integer) TO bap_api;

-- The routing target author, editor and default assignee and the setting author join the erasure (ADR 0008).
-- A default assignee is a forward-looking pointer, so it is nulled rather than tombstoned.
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

  IF subject_user_id LIKE 'channel\_%' THEN
    RAISE EXCEPTION 'User erasure never names a channel';
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
    UNION ALL
    SELECT 1 FROM app.document WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.partner WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_link WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.blob WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_item
    WHERE created_by = subject_user_id
      OR assignee_id = subject_user_id
      OR decided_by_user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_item_extraction WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_event WHERE actor_user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_file WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_channel WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_routing_target
    WHERE created_by = subject_user_id
      OR updated_by = subject_user_id
      OR default_assignee_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.organization_inbox_setting WHERE created_by = subject_user_id
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

  UPDATE app.document
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.partner
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document_link
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.blob
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_item
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_item
  SET assignee_id = tombstone
  WHERE assignee_id = subject_user_id;

  UPDATE app.inbox_item
  SET decided_by_user_id = tombstone
  WHERE decided_by_user_id = subject_user_id;

  UPDATE app.inbox_item_extraction
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_event
  SET actor_user_id = tombstone
  WHERE actor_user_id = subject_user_id;

  UPDATE app.document_file
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_channel
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_routing_target
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_routing_target
  SET updated_by = tombstone
  WHERE updated_by = subject_user_id;

  UPDATE app.inbox_routing_target
  SET default_assignee_id = NULL
  WHERE default_assignee_id = subject_user_id;

  UPDATE app.organization_inbox_setting
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;
