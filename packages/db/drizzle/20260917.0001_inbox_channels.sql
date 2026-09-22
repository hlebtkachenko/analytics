-- Inbox channels (ADR 0016): the channel principal, the channel register, the intake credential and its definer surface.
-- A channel runs as bap.role = 'channel' and bap.user_id = 'channel_<uuid>' with no auth."user" row and no new database role.
-- Non-inbox SELECT policies amended with AND NOT app.role_is_channel(): legal_entity, member_entity_scope,
-- legal_entity_access, dataset, dataset_column, dataset_row, dataset_embedding, upload, partner, document,
-- document_attribute, invoice, invoice_line, economic_event, economic_event_line, document_link, data_issue.
-- audit_log_isolation is split per command so a channel cannot read the log while app.record_audit keeps inserting.
-- blob, document_file and every inbox table stay readable by a channel; blob_update does not opt in.

-- pgcrypto is a trusted extension, so bap_owner installs it with its CREATE privilege on the database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- SECURITY INVOKER and STABLE like its siblings: it reads the transaction setting and nothing else.
CREATE OR REPLACE FUNCTION app.role_is_channel()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT coalesce(current_setting('bap.role', true), '') = 'channel'
$$;

ALTER FUNCTION app.role_is_channel() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.role_is_channel() FROM PUBLIC;
-- The reporting role evaluates SELECT policies that name this function, so it needs EXECUTE too.
GRANT EXECUTE ON FUNCTION app.role_is_channel() TO bap_api, bap_reporting;

-- One row per push or pull source of an organization; soft deleted, never removed while items point at it.
CREATE TABLE IF NOT EXISTS app.inbox_channel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  -- The channel_kind vocabulary of app.inbox_item, narrowed to the kinds that have a principal.
  kind text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  legal_entity_id uuid,
  hint_kind text,
  -- Non-secret settings only; every secret lives in auth.inbox_channel_credential as a hash.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Null until Phase 1a-email; stored plain because the owner must read it to give it out.
  email_address text,
  last_run_at timestamptz,
  -- A code, never a message.
  last_error text,
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  created_by text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_channel_kind_check CHECK (kind IN ('email', 'api')),
  CONSTRAINT inbox_channel_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT inbox_channel_hint_kind_check
    CHECK (hint_kind IS NULL OR hint_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_channel_config_check CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT inbox_channel_email_address_check
    CHECK (email_address IS NULL OR length(email_address) BETWEEN 3 AND 254),
  CONSTRAINT inbox_channel_last_error_check
    CHECK (last_error IS NULL OR last_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- A soft deleted channel is always disabled.
  CONSTRAINT inbox_channel_deleted_disabled_check CHECK (deleted_at IS NULL OR NOT enabled),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT inbox_channel_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT inbox_channel_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (legal_entity_id)
);

-- The settings page lists one kind at a time under the tenant predicate.
CREATE INDEX IF NOT EXISTS inbox_channel_organization_idx ON app.inbox_channel(organization_id, kind);
CREATE INDEX IF NOT EXISTS inbox_channel_legal_entity_idx
  ON app.inbox_channel(legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

-- An item names the channel it came through; a manual upload has none and every other kind must.
ALTER TABLE app.inbox_item
  ADD COLUMN IF NOT EXISTS channel_id uuid,
  -- The credential display prefix or, later, a sender address: who pushed, never what was pushed.
  ADD COLUMN IF NOT EXISTS origin text,
  -- Restrict on purpose: a channel is soft deleted while items still point at it.
  ADD CONSTRAINT inbox_item_channel_fkey FOREIGN KEY (channel_id, organization_id)
    REFERENCES app.inbox_channel(id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT inbox_item_origin_check
    CHECK (origin IS NULL OR length(origin) BETWEEN 1 AND 255),
  ADD CONSTRAINT inbox_item_channel_check CHECK ((channel_kind = 'upload') = (channel_id IS NULL));

CREATE INDEX IF NOT EXISTS inbox_item_channel_idx
  ON app.inbox_item(channel_id)
  WHERE channel_id IS NOT NULL;

-- Replay is scoped per channel, not per kind: two channels of one organization may share an external id.
DROP INDEX IF EXISTS app.inbox_item_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_item_channel_external_id_key
  ON app.inbox_item(organization_id, channel_id, external_id)
  WHERE external_id IS NOT NULL AND channel_id IS NOT NULL;

-- The secret of a channel: a hash and a display prefix, never the plain value.
CREATE TABLE IF NOT EXISTS auth.inbox_channel_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  channel_id uuid NOT NULL,
  kind text NOT NULL,
  secret_sha256 text NOT NULL,
  display_prefix text NOT NULL,
  -- Cleared with the identity, exactly like auth.organization.created_by.
  created_by text REFERENCES auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT inbox_channel_credential_kind_check CHECK (kind IN ('api_token', 'email_address')),
  CONSTRAINT inbox_channel_credential_secret_sha256_check CHECK (secret_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT inbox_channel_credential_secret_sha256_key UNIQUE (secret_sha256),
  CONSTRAINT inbox_channel_credential_display_prefix_check CHECK (display_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  -- The composite key makes the denormalized organization_id provably equal to the channel's.
  CONSTRAINT inbox_channel_credential_channel_fkey FOREIGN KEY (channel_id, organization_id)
    REFERENCES app.inbox_channel(id, organization_id) ON DELETE CASCADE
);

-- Auth tables inherit Better Auth DML, so this table needs an explicit exception; only the definers below reach it.
REVOKE ALL ON auth.inbox_channel_credential FROM bap_auth, bap_api;
GRANT SELECT ON auth.inbox_channel_credential TO bap_backup;

-- The active credential count per channel and the resolver's channel join.
CREATE INDEX IF NOT EXISTS inbox_channel_credential_channel_idx
  ON auth.inbox_channel_credential(channel_id)
  WHERE revoked_at IS NULL;

-- Tenant identity comes from the transaction context, never from an argument, so a caller cannot name another tenant.
-- Returns the plain secret exactly once; the row keeps sha256 and an 8 character display prefix.
CREATE OR REPLACE FUNCTION auth.issue_channel_credential(channel_id uuid, kind text)
RETURNS TABLE (credential_id uuid, secret text, display_prefix text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
  context_user_id text := current_setting('bap.user_id', true);
  plain_secret text;
  active_total integer;
BEGIN
  IF coalesce(current_setting('bap.role', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'Channel credentials are issued by an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(context_organization_id, '') = '' OR coalesce(context_user_id, '') = '' THEN
    RAISE EXCEPTION 'Channel credentials require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF issue_channel_credential.kind IS NULL
    OR issue_channel_credential.kind NOT IN ('api_token', 'email_address') THEN
    RAISE EXCEPTION 'Unknown channel credential kind'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'inbox_channel_credential_kind_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.inbox_channel AS channel
    WHERE channel.id = issue_channel_credential.channel_id
      AND channel.organization_id = context_organization_id
      AND channel.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Channel was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Serializes issuance per channel so two concurrent calls cannot both see one active credential.
  PERFORM pg_advisory_xact_lock(hashtext(issue_channel_credential.channel_id::text));

  SELECT count(*)::integer
  INTO active_total
  FROM auth.inbox_channel_credential AS credential
  WHERE credential.channel_id = issue_channel_credential.channel_id
    AND credential.revoked_at IS NULL;

  -- Two active credentials let a rotation overlap; a third is refused.
  IF active_total >= 2 THEN
    RAISE EXCEPTION 'A channel holds at most two active credentials'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'inbox_channel_credential_active_limit';
  END IF;

  plain_secret := 'bap_intake_'
    || translate(rtrim(encode(public.gen_random_bytes(32), 'base64'), '='), '+/', '-_');

  INSERT INTO auth.inbox_channel_credential (
    organization_id, channel_id, kind, secret_sha256, display_prefix, created_by
  )
  VALUES (
    context_organization_id,
    issue_channel_credential.channel_id,
    issue_channel_credential.kind,
    encode(sha256(convert_to(plain_secret, 'UTF8')), 'hex'),
    substr(plain_secret, length('bap_intake_') + 1, 8),
    context_user_id
  )
  RETURNING
    inbox_channel_credential.id,
    plain_secret,
    inbox_channel_credential.display_prefix
  INTO credential_id, secret, display_prefix;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION auth.issue_channel_credential(uuid, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.issue_channel_credential(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.issue_channel_credential(uuid, text) TO bap_api;

-- True when a live credential of the caller's organization was revoked by this call, false otherwise.
CREATE OR REPLACE FUNCTION auth.revoke_channel_credential(credential_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
BEGIN
  IF coalesce(current_setting('bap.role', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'Channel credentials are revoked by an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Channel credentials require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE auth.inbox_channel_credential AS credential
  SET revoked_at = now()
  WHERE credential.id = revoke_channel_credential.credential_id
    AND credential.organization_id = context_organization_id
    AND credential.revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

ALTER FUNCTION auth.revoke_channel_credential(uuid) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.revoke_channel_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.revoke_channel_credential(uuid) TO bap_api;

-- The web hashes the bearer and asks for the binding; nothing is cached, so revoke and disable act on the next request.
CREATE OR REPLACE FUNCTION auth.resolve_channel_credential(secret_sha256 text)
RETURNS TABLE (organization_id text, channel_id uuid, kind text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
BEGIN
  RETURN QUERY
  UPDATE auth.inbox_channel_credential AS credential
  SET last_used_at = now()
  FROM app.inbox_channel AS channel
  WHERE credential.secret_sha256 = resolve_channel_credential.secret_sha256
    AND credential.revoked_at IS NULL
    AND channel.id = credential.channel_id
    AND channel.organization_id = credential.organization_id
    AND channel.enabled
    AND channel.deleted_at IS NULL
  RETURNING credential.organization_id, credential.channel_id, credential.kind;
END;
$$;

ALTER FUNCTION auth.resolve_channel_credential(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.resolve_channel_credential(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.resolve_channel_credential(text) TO bap_auth;

ALTER TABLE app.inbox_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_channel FORCE ROW LEVEL SECURITY;

-- A member reads every channel of the organization; a channel reads exactly its own row.
CREATE POLICY inbox_channel_select ON app.inbox_channel FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND (
      NOT app.role_is_channel()
      OR 'channel_' || id::text = current_setting('bap.user_id', true)
    )
  );

-- Creating and deleting a channel is an owner decision; editing needs owner or admin.
CREATE POLICY inbox_channel_insert ON app.inbox_channel FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_is_owner()
  );

CREATE POLICY inbox_channel_update ON app.inbox_channel FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_channel_delete ON app.inbox_channel FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_owner()
  );

-- FORCE row level security applies to the definer too: the credential resolver runs outside any tenant transaction.
CREATE POLICY inbox_channel_maintenance_select ON app.inbox_channel FOR SELECT
  TO bap_owner USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.inbox_channel TO bap_api;
GRANT SELECT ON app.inbox_channel TO bap_reporting;

-- Default privileges under bap_owner already cover this, but the whole database dump must not depend on them.
GRANT SELECT ON app.inbox_channel TO bap_backup;

-- The eraser keeps column-scoped grants only.
GRANT SELECT (created_by), UPDATE (created_by) ON app.inbox_channel TO bap_eraser;

-- The five inbox INSERT policies admit a channel; the created_by check stays outside the parentheses.
ALTER POLICY blob_insert ON app.blob
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND (app.role_can_write() OR app.role_is_channel())
  );

ALTER POLICY inbox_item_insert ON app.inbox_item
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND (app.role_can_write() OR app.role_is_channel())
  );

ALTER POLICY inbox_item_file_insert ON app.inbox_item_file
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND (app.role_can_write() OR app.role_is_channel())
  );

ALTER POLICY inbox_item_extraction_insert ON app.inbox_item_extraction
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND (app.role_can_write() OR app.role_is_channel())
  );

ALTER POLICY inbox_event_insert ON app.inbox_event
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND (app.role_can_write() OR app.role_is_channel())
  );

-- A channel moves an item through received, processing, needs_review and failed; it never routes or overrides a person.
CREATE POLICY inbox_item_channel_update ON app.inbox_item FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_channel()
    AND status <> 'routed'
    AND decided_by_kind IS DISTINCT FROM 'user'
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_is_channel()
    AND status <> 'routed'
    AND decided_by_kind IS DISTINCT FROM 'user'
    AND document_id IS NULL
    AND dataset_id IS NULL
    AND partner_id IS NULL
  );

-- Every non-inbox tenant read excludes the channel; foreign key checks bypass row level security, so pins still validate.
ALTER POLICY legal_entity_select ON app.legal_entity
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY member_entity_scope_select ON app.member_entity_scope
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY legal_entity_access_select ON app.legal_entity_access
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY dataset_select ON app.dataset
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY dataset_column_select ON app.dataset_column
  USING (app.dataset_is_readable(dataset_id) AND NOT app.role_is_channel());

ALTER POLICY dataset_row_select ON app.dataset_row
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_readable(dataset_id)
    AND NOT app.role_is_channel()
  );

ALTER POLICY dataset_embedding_select ON app.dataset_embedding
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_readable(dataset_id)
    AND NOT app.role_is_channel()
  );

ALTER POLICY upload_select ON app.upload
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY partner_select ON app.partner
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY document_select ON app.document
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY document_attribute_select ON app.document_attribute
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY invoice_select ON app.invoice
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY invoice_line_select ON app.invoice_line
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY economic_event_select ON app.economic_event
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY economic_event_line_select ON app.economic_event_line
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY document_link_select ON app.document_link
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

ALTER POLICY data_issue_select ON app.data_issue
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

-- ALTER POLICY cannot change the command, so the ALL policy is split per command like every other tenant table.
-- The write clauses are unchanged, so app.record_audit keeps inserting under forced row level security.
DROP POLICY audit_log_isolation ON app.audit_log;

CREATE POLICY audit_log_select ON app.audit_log FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

CREATE POLICY audit_log_insert ON app.audit_log FOR INSERT
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY audit_log_update ON app.audit_log FOR UPDATE
  USING (organization_id = current_setting('bap.organization_id', true))
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY audit_log_delete ON app.audit_log FOR DELETE
  USING (organization_id = current_setting('bap.organization_id', true));

-- INSERT ... RETURNING reads the new row through the SELECT policy, which now excludes the channel,
-- so the writer picks the id first and returns it without reading the row back. Otherwise unchanged.
CREATE OR REPLACE FUNCTION app.record_audit(
  audit_action text,
  audit_resource_type text,
  audit_resource_id text DEFAULT NULL,
  audit_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  -- Tenant identity is derived from the transaction context and never from an argument.
  -- An argument passed organization id would be a cross tenant write primitive.
  context_organization_id text := current_setting('bap.organization_id', true);
  context_user_id text := current_setting('bap.user_id', true);
  recorded_id uuid := gen_random_uuid();
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Audit entries require tenant context';
  END IF;

  IF coalesce(context_user_id, '') = '' THEN
    RAISE EXCEPTION 'Audit entries require user context';
  END IF;

  INSERT INTO app.audit_log (id, organization_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (
    recorded_id,
    context_organization_id,
    context_user_id,
    audit_action,
    audit_resource_type,
    audit_resource_id,
    coalesce(audit_metadata, '{}'::jsonb)
  );

  RETURN recorded_id;
END;
$$;

-- The channel subject namespace stays disjoint from identities: no person can ever be a channel.
ALTER TABLE auth."user"
  ADD CONSTRAINT user_id_not_channel_check CHECK (id NOT LIKE 'channel\_%');

-- Channels join the erasure only as authors of channel rows; a channel subject itself is never tombstoned.
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

  RETURN tombstone;
END;
$$;
