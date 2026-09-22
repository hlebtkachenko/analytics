-- Inbox intake: durable per organization blobs, one intake envelope per arrival, its files, extractions and events.
-- Organization stays the only row level security boundary; every child pins its parent by a composite foreign key.
-- Items are organization level on purpose: legal_entity_id is null until a channel or a person binds it.

-- Content addressed per organization: the same bytes uploaded twice by one tenant are one row, by two tenants two rows.
CREATE TABLE IF NOT EXISTS app.blob (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  -- Sniffed from the bytes by the API, never copied from the client, so the inline route can trust it.
  media_type text NOT NULL,
  -- Derived from the tenant id and the hash, never from a filename, so no upload can steer a path.
  storage_key text NOT NULL,
  original_filename text,
  scan_status text NOT NULL DEFAULT 'not_scanned',
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blob_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT blob_byte_size_check CHECK (byte_size > 0),
  CONSTRAINT blob_media_type_check
    CHECK (media_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'),
  CONSTRAINT blob_storage_key_check CHECK (length(storage_key) BETWEEN 1 AND 512),
  CONSTRAINT blob_original_filename_check
    CHECK (original_filename IS NULL OR length(original_filename) BETWEEN 1 AND 255),
  CONSTRAINT blob_scan_status_check
    CHECK (scan_status IN ('not_scanned', 'clean', 'infected', 'failed')),
  CONSTRAINT blob_organization_sha256_key UNIQUE (organization_id, sha256),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT blob_id_organization_key UNIQUE (id, organization_id)
);

-- The quota check sums byte_size per organization, so the tenant predicate leads.
CREATE INDEX IF NOT EXISTS blob_organization_idx ON app.blob(organization_id, created_at DESC);

-- One envelope per arrival: what came in, how sure the platform is about it, and where it went.
CREATE TABLE IF NOT EXISTS app.inbox_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  legal_entity_id uuid,
  -- Closed vocabularies: a new channel or payload shape is a product decision, so it takes a migration.
  channel_kind text NOT NULL,
  payload_kind text NOT NULL,
  -- The channel's own identifier for the arrival, so a re-delivered email or poll cannot create a second item.
  external_id text,
  -- Unused until Split: a child item points at the item it was cut from.
  parent_item_id uuid,
  status text NOT NULL DEFAULT 'received',
  detected_type text,
  -- Always recorded when a provider ran, including 1.000 for a structured parse.
  confidence numeric(4, 3),
  hint_text text,
  hint_legal_entity_id uuid,
  hint_kind text,
  hint_partner_id uuid,
  hint_link_document_id uuid,
  duplicate_of_item_id uuid,
  -- Typed destinations, never a polymorphic pointer: the database keeps enforcing one live row of one organization.
  document_id uuid,
  dataset_id uuid,
  partner_id uuid,
  decided_by_kind text,
  decided_by_user_id text,
  -- No foreign key until app.inbox_rule exists.
  decided_by_rule_id uuid,
  routed_at timestamptz,
  assignee_id text,
  snoozed_until timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_item_channel_kind_check CHECK (channel_kind IN (
    'upload', 'email', 'api', 'mcp', 'money_s3', 'pohoda', 'isdoc', 'bank_file', 'bank_api',
    'fakturoid', 'idoklad', 'isds', 'drive'
  )),
  CONSTRAINT inbox_item_payload_kind_check
    CHECK (payload_kind IN ('file', 'email', 'structured', 'text')),
  CONSTRAINT inbox_item_external_id_check
    CHECK (external_id IS NULL OR length(external_id) BETWEEN 1 AND 255),
  CONSTRAINT inbox_item_status_check CHECK (status IN (
    'received', 'processing', 'needs_review', 'routed', 'discarded', 'failed'
  )),
  CONSTRAINT inbox_item_detected_type_check
    CHECK (detected_type IS NULL OR detected_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_item_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT inbox_item_hint_text_check CHECK (hint_text IS NULL OR length(hint_text) <= 2000),
  CONSTRAINT inbox_item_hint_kind_check
    CHECK (hint_kind IS NULL OR hint_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_item_decided_by_kind_check CHECK (
    decided_by_kind IS NULL
    OR decided_by_kind IN ('hint', 'rule', 'target_default', 'provider', 'user')
  ),
  -- Provenance is typed: a person's decision names the person, a rule's decision names the rule.
  CONSTRAINT inbox_item_decided_by_user_check
    CHECK (decided_by_kind IS DISTINCT FROM 'user' OR decided_by_user_id IS NOT NULL),
  CONSTRAINT inbox_item_decided_by_rule_check
    CHECK (decided_by_kind IS DISTINCT FROM 'rule' OR decided_by_rule_id IS NOT NULL),
  CONSTRAINT inbox_item_one_destination_check CHECK (
    (document_id IS NOT NULL)::integer
    + (dataset_id IS NOT NULL)::integer
    + (partner_id IS NOT NULL)::integer <= 1
  ),
  -- A routed item always names where it went.
  CONSTRAINT inbox_item_routed_check CHECK (
    status <> 'routed'
    OR (document_id IS NOT NULL OR dataset_id IS NOT NULL OR partner_id IS NOT NULL)
  ),
  CONSTRAINT inbox_item_not_self_duplicate_check
    CHECK (duplicate_of_item_id IS NULL OR duplicate_of_item_id <> id),
  CONSTRAINT inbox_item_not_self_parent_check
    CHECK (parent_item_id IS NULL OR parent_item_id <> id),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT inbox_item_id_organization_key UNIQUE (id, organization_id),
  -- An item outlives its entity, its hints and its duplicate: only the pointer is cleared.
  CONSTRAINT inbox_item_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (legal_entity_id),
  CONSTRAINT inbox_item_parent_fkey FOREIGN KEY (parent_item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE SET NULL (parent_item_id),
  CONSTRAINT inbox_item_hint_legal_entity_fkey FOREIGN KEY (hint_legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (hint_legal_entity_id),
  CONSTRAINT inbox_item_hint_partner_fkey FOREIGN KEY (hint_partner_id, organization_id)
    REFERENCES app.partner(id, organization_id) ON DELETE SET NULL (hint_partner_id),
  CONSTRAINT inbox_item_hint_link_document_fkey FOREIGN KEY (hint_link_document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE SET NULL (hint_link_document_id),
  CONSTRAINT inbox_item_duplicate_of_fkey FOREIGN KEY (duplicate_of_item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE SET NULL (duplicate_of_item_id),
  -- Restrict on purpose: a routed destination is deleted only by the path that un-routes the item first.
  CONSTRAINT inbox_item_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT inbox_item_dataset_fkey FOREIGN KEY (dataset_id, organization_id)
    REFERENCES app.dataset(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT inbox_item_partner_fkey FOREIGN KEY (partner_id, organization_id)
    REFERENCES app.partner(id, organization_id) ON DELETE RESTRICT
);

-- The list page filters by status and orders by arrival descending with id as the tiebreaker.
CREATE INDEX IF NOT EXISTS inbox_item_list_idx
  ON app.inbox_item(organization_id, status, received_at DESC, id DESC);

-- Partial, because a manual upload has no external identifier and many of them must coexist.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_item_external_id_key
  ON app.inbox_item(organization_id, channel_kind, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_item_legal_entity_idx
  ON app.inbox_item(organization_id, legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

-- Every nullable reference is cleared or restricted by its foreign key, which scans without an index.
CREATE INDEX IF NOT EXISTS inbox_item_document_idx
  ON app.inbox_item(document_id)
  WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_dataset_idx
  ON app.inbox_item(dataset_id)
  WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_partner_idx
  ON app.inbox_item(partner_id)
  WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_duplicate_of_idx
  ON app.inbox_item(duplicate_of_item_id)
  WHERE duplicate_of_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_parent_idx
  ON app.inbox_item(parent_item_id)
  WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_hint_legal_entity_idx
  ON app.inbox_item(hint_legal_entity_id)
  WHERE hint_legal_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_hint_partner_idx
  ON app.inbox_item(hint_partner_id)
  WHERE hint_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_item_hint_link_document_idx
  ON app.inbox_item(hint_link_document_id)
  WHERE hint_link_document_id IS NOT NULL;

-- The files behind an item, in order; a page range narrows a multi document scan to the pages that belong here.
CREATE TABLE IF NOT EXISTS app.inbox_item_file (
  item_id uuid NOT NULL,
  organization_id text NOT NULL,
  blob_id uuid NOT NULL,
  position integer NOT NULL,
  page_from integer,
  page_to integer,
  CONSTRAINT inbox_item_file_pkey PRIMARY KEY (item_id, position),
  CONSTRAINT inbox_item_file_position_check CHECK (position >= 1),
  CONSTRAINT inbox_item_file_page_from_check CHECK (page_from IS NULL OR page_from >= 1),
  CONSTRAINT inbox_item_file_page_to_check CHECK (page_to IS NULL OR page_to >= 1),
  CONSTRAINT inbox_item_file_page_range_check
    CHECK (page_from IS NULL OR page_to IS NULL OR page_from <= page_to),
  CONSTRAINT inbox_item_file_item_fkey FOREIGN KEY (item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE CASCADE,
  -- Bytes are never lost under a reference: the blob goes only after its last file row.
  CONSTRAINT inbox_item_file_blob_fkey FOREIGN KEY (blob_id, organization_id)
    REFERENCES app.blob(id, organization_id) ON DELETE RESTRICT
);

-- The primary key leads with item_id, so the tenant predicate needs an index of its own.
CREATE INDEX IF NOT EXISTS inbox_item_file_organization_idx
  ON app.inbox_item_file(organization_id, item_id);
CREATE INDEX IF NOT EXISTS inbox_item_file_blob_idx ON app.inbox_item_file(blob_id);

-- One row per provider run: the draft, its per field confidences, the ordered reasons and the issues found.
CREATE TABLE IF NOT EXISTS app.inbox_item_extraction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  item_id uuid NOT NULL,
  provider text NOT NULL,
  provider_version text NOT NULL,
  detected_type text,
  confidence numeric(4, 3) NOT NULL,
  legal_entity_id uuid,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_confidences jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_item_extraction_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_item_extraction_provider_version_check
    CHECK (length(provider_version) BETWEEN 1 AND 64),
  CONSTRAINT inbox_item_extraction_detected_type_check
    CHECK (detected_type IS NULL OR detected_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_item_extraction_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  -- Shapes are fixed even though the keys are provider specific: objects for maps, arrays for lists.
  CONSTRAINT inbox_item_extraction_draft_check CHECK (jsonb_typeof(draft) = 'object'),
  CONSTRAINT inbox_item_extraction_field_confidences_check
    CHECK (jsonb_typeof(field_confidences) = 'object'),
  CONSTRAINT inbox_item_extraction_reasons_check CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT inbox_item_extraction_issues_check CHECK (jsonb_typeof(issues) = 'array'),
  CONSTRAINT inbox_item_extraction_item_fkey FOREIGN KEY (item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT inbox_item_extraction_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (legal_entity_id)
);

-- Reading an item reads its newest extraction first, under the tenant predicate.
CREATE INDEX IF NOT EXISTS inbox_item_extraction_item_idx
  ON app.inbox_item_extraction(organization_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_item_extraction_legal_entity_idx
  ON app.inbox_item_extraction(legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

-- Append only history of what happened to an item; ids, kinds and reasons only, never content.
CREATE TABLE IF NOT EXISTS app.inbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  item_id uuid NOT NULL,
  kind text NOT NULL,
  reason text,
  actor_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_event_kind_check CHECK (kind IN (
    'received', 'scanned', 'classified', 'extracted', 'rule_matched', 'routed', 'unrouted',
    'reopened', 'discarded', 'restored', 'assigned', 'hint_added', 'failed'
  )),
  -- Discard reasons first, then the unprocessable reasons a provider can raise.
  CONSTRAINT inbox_event_reason_check CHECK (reason IS NULL OR reason IN (
    'irrelevant', 'duplicate', 'not_ours', 'spam',
    'unsupported_type', 'password_protected', 'encrypted', 'empty', 'unreadable',
    'decorative_image', 'too_large', 'policy_rejected'
  )),
  CONSTRAINT inbox_event_item_fkey FOREIGN KEY (item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE CASCADE
);

-- The timeline reads one item's events in order, under the tenant predicate.
CREATE INDEX IF NOT EXISTS inbox_event_item_idx
  ON app.inbox_event(organization_id, item_id, created_at);

-- The originals behind a registered document, in order, so the register can always show the paper.
CREATE TABLE IF NOT EXISTS app.document_file (
  document_id uuid NOT NULL,
  organization_id text NOT NULL,
  blob_id uuid NOT NULL,
  position integer NOT NULL,
  page_from integer,
  page_to integer,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_file_pkey PRIMARY KEY (document_id, position),
  CONSTRAINT document_file_position_check CHECK (position >= 1),
  CONSTRAINT document_file_page_from_check CHECK (page_from IS NULL OR page_from >= 1),
  CONSTRAINT document_file_page_to_check CHECK (page_to IS NULL OR page_to >= 1),
  CONSTRAINT document_file_page_range_check
    CHECK (page_from IS NULL OR page_to IS NULL OR page_from <= page_to),
  CONSTRAINT document_file_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT document_file_blob_fkey FOREIGN KEY (blob_id, organization_id)
    REFERENCES app.blob(id, organization_id) ON DELETE RESTRICT
);

-- The primary key leads with document_id, so the tenant predicate needs an index of its own.
CREATE INDEX IF NOT EXISTS document_file_organization_idx
  ON app.document_file(organization_id, document_id);
CREATE INDEX IF NOT EXISTS document_file_blob_idx ON app.document_file(blob_id);

-- The register points back at the item it was routed from; the item's own pointer is what restricts deletion.
ALTER TABLE app.document
  ADD COLUMN IF NOT EXISTS inbox_item_id uuid,
  ADD CONSTRAINT document_inbox_item_fkey FOREIGN KEY (inbox_item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE SET NULL (inbox_item_id);

CREATE INDEX IF NOT EXISTS document_inbox_item_idx
  ON app.document(inbox_item_id)
  WHERE inbox_item_id IS NOT NULL;

-- upload_id never had a writer and content_hash belongs to the bytes, which app.blob now owns.
ALTER TABLE app.document DROP CONSTRAINT IF EXISTS document_upload_fkey;
ALTER TABLE app.document DROP CONSTRAINT IF EXISTS document_content_hash_check;
DROP INDEX IF EXISTS app.document_upload_idx;
ALTER TABLE app.document
  DROP COLUMN IF EXISTS upload_id,
  DROP COLUMN IF EXISTS content_hash;

-- An advance request derives nothing: it is a payment demand, not a supply, so it lives on attributes only.
ALTER TABLE app.document DROP CONSTRAINT IF EXISTS document_kind_check;
ALTER TABLE app.document
  ADD CONSTRAINT document_kind_check CHECK (kind IN (
    'issued_invoice', 'received_invoice', 'credit_note', 'receipt', 'bank_statement',
    'contract', 'agreement', 'hr_document', 'payroll', 'tax_filing', 'advance_request', 'other'
  ));

-- advance_of points an advance request at the invoice that later deducts it.
ALTER TABLE app.document_link DROP CONSTRAINT IF EXISTS document_link_kind_check;
ALTER TABLE app.document_link
  ADD CONSTRAINT document_link_kind_check
    CHECK (kind IN ('settles', 'fulfills', 'corrects', 'supersedes', 'relates', 'advance_of'));

ALTER TABLE app.blob ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.blob FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item_file FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item_extraction ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_item_extraction FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_event FORCE ROW LEVEL SECURITY;
ALTER TABLE app.document_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_file FORCE ROW LEVEL SECURITY;

-- Split per command on purpose: one ALL policy would let its read clause govern DELETE and the row selection of UPDATE.
-- Reading is a member level action; every write needs owner or admin, exactly like the documents tables.
CREATE POLICY blob_select ON app.blob FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY blob_insert ON app.blob FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY blob_update ON app.blob FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY blob_delete ON app.blob FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_select ON app.inbox_item FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY inbox_item_insert ON app.inbox_item FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_update ON app.inbox_item FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_delete ON app.inbox_item FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_file_select ON app.inbox_item_file FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY inbox_item_file_insert ON app.inbox_item_file FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_file_update ON app.inbox_item_file FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_file_delete ON app.inbox_item_file FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_extraction_select ON app.inbox_item_extraction FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY inbox_item_extraction_insert ON app.inbox_item_extraction FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_extraction_update ON app.inbox_item_extraction FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_item_extraction_delete ON app.inbox_item_extraction FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_event_select ON app.inbox_event FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY inbox_event_insert ON app.inbox_event FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_event_update ON app.inbox_event FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_event_delete ON app.inbox_event FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_file_select ON app.document_file FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY document_file_insert ON app.document_file FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_file_update ON app.document_file FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_file_delete ON app.document_file FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.blob,
  app.inbox_item,
  app.inbox_item_file,
  app.inbox_item_extraction,
  app.inbox_event,
  app.document_file
TO bap_api;

GRANT SELECT ON
  app.blob,
  app.inbox_item,
  app.inbox_item_file,
  app.inbox_item_extraction,
  app.inbox_event,
  app.document_file
TO bap_reporting;

-- Default privileges under bap_owner already cover these, but the whole database dump must not depend on them.
GRANT SELECT ON
  app.blob,
  app.inbox_item,
  app.inbox_item_file,
  app.inbox_item_extraction,
  app.inbox_event,
  app.document_file
TO bap_backup;

-- The eraser keeps column-scoped grants only: every subject-bearing column the inbox adds.
GRANT SELECT (created_by), UPDATE (created_by) ON app.blob TO bap_eraser;
GRANT SELECT (created_by, assignee_id, decided_by_user_id),
  UPDATE (created_by, assignee_id, decided_by_user_id) ON app.inbox_item TO bap_eraser;
GRANT SELECT (created_by), UPDATE (created_by) ON app.inbox_item_extraction TO bap_eraser;
GRANT SELECT (actor_user_id), UPDATE (actor_user_id) ON app.inbox_event TO bap_eraser;
GRANT SELECT (created_by), UPDATE (created_by) ON app.document_file TO bap_eraser;

-- Blobs, items, extractions, events and document files join the erasure: rows survive, attributed to the tombstone.
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

  RETURN tombstone;
END;
$$;

-- Reserve the top-level inbox route before it is published.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.organization
    WHERE slug = 'inbox'
  ) THEN
    RAISE EXCEPTION 'Reserved organization slug is already in use'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'organization_slug_reserved_check';
  END IF;
END;
$$;

ALTER TABLE auth.organization
  DROP CONSTRAINT organization_slug_reserved_check;

ALTER TABLE auth.organization
  ADD CONSTRAINT organization_slug_reserved_check
    CHECK (
      slug NOT IN (
        'access',
        'api',
        'datasets',
        'design-system',
        'health',
        'invitation',
        'metrics',
        'ready',
        'sign-in',
        'sign-up',
        'forgot-password',
        'reset-password',
        'activate',
        'welcome',
        'account',
        'organizations',
        'documents',
        'inbox'
      )
    );
