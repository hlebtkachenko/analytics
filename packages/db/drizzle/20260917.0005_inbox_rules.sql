-- Inbox rules (Phase 1b-rules): per organization routing rules, the corrections a route records,
-- the foreign key inbox_item.decided_by_rule_id waited for, three definers and the system subject guard.
-- The rule author is the principal: a rule runs only while its author is a verified owner or admin.

-- One routing rule: closed condition columns, closed action columns, no jsonb; soft deleted, never removed.
CREATE TABLE IF NOT EXISTS app.inbox_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Null exactly when soft deleted, so a deleted rule frees its slot.
  priority integer,
  channel_id uuid,
  -- Lowercase, @domain or a full address; the matcher compares the sender or its suffix from the @.
  sender_pattern text,
  keyword text,
  detected_type text,
  set_legal_entity_id uuid,
  set_document_kind text,
  set_partner_id uuid,
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  set_assignee_id text,
  discard_reason text,
  auto_route boolean NOT NULL DEFAULT false,
  -- The principal every match and every automatic route runs as; only adoption changes it.
  created_by text NOT NULL DEFAULT current_setting('bap.user_id', true),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT inbox_rule_name_check CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT inbox_rule_priority_deleted_check CHECK ((deleted_at IS NULL) = (priority IS NOT NULL)),
  CONSTRAINT inbox_rule_sender_pattern_check CHECK (
    sender_pattern IS NULL
    OR (
      sender_pattern ~ '^(@|[^@[:space:]]+@)[^@[:space:]]+$'
      AND sender_pattern = lower(sender_pattern)
      AND length(sender_pattern) <= 320
    )
  ),
  CONSTRAINT inbox_rule_keyword_check CHECK (keyword IS NULL OR length(keyword) BETWEEN 1 AND 120),
  CONSTRAINT inbox_rule_detected_type_check
    CHECK (detected_type IS NULL OR detected_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT inbox_rule_condition_check CHECK (
    channel_id IS NOT NULL
    OR sender_pattern IS NOT NULL
    OR keyword IS NOT NULL
    OR detected_type IS NOT NULL
  ),
  CONSTRAINT inbox_rule_set_document_kind_check CHECK (set_document_kind IS NULL OR set_document_kind IN (
    'issued_invoice', 'received_invoice', 'credit_note', 'advance_request', 'receipt', 'bank_statement',
    'contract', 'agreement', 'hr_document', 'payroll', 'tax_filing', 'other'
  )),
  CONSTRAINT inbox_rule_discard_reason_check
    CHECK (discard_reason IS NULL OR discard_reason IN ('irrelevant', 'duplicate', 'not_ours', 'spam')),
  -- A live rule has at least one action; a soft deleted one is inert and may have lost its last action to erasure.
  CONSTRAINT inbox_rule_action_check CHECK (
    deleted_at IS NOT NULL
    OR set_legal_entity_id IS NOT NULL
    OR set_document_kind IS NOT NULL
    OR set_partner_id IS NOT NULL
    OR set_assignee_id IS NOT NULL
    OR discard_reason IS NOT NULL
    OR auto_route
  ),
  -- A discarded item has no fields to set, so a discard rule carries no other action.
  CONSTRAINT inbox_rule_discard_exclusive_check CHECK (
    discard_reason IS NULL
    OR (
      set_legal_entity_id IS NULL
      AND set_document_kind IS NULL
      AND set_partner_id IS NULL
      AND set_assignee_id IS NULL
      AND NOT auto_route
    )
  ),
  -- Deferred, so a reorder swaps priorities in one statement.
  CONSTRAINT inbox_rule_organization_priority_key
    UNIQUE (organization_id, priority) DEFERRABLE INITIALLY DEFERRED,
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT inbox_rule_id_organization_key UNIQUE (id, organization_id),
  -- Restrict on purpose: a rule names what it points at, so the pointer is cleared before the target goes.
  CONSTRAINT inbox_rule_channel_fkey FOREIGN KEY (channel_id, organization_id)
    REFERENCES app.inbox_channel(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT inbox_rule_set_legal_entity_fkey FOREIGN KEY (set_legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT inbox_rule_set_partner_fkey FOREIGN KEY (set_partner_id, organization_id)
    REFERENCES app.partner(id, organization_id) ON DELETE RESTRICT
);

-- The matcher reads the live rules of one organization in priority order.
CREATE INDEX IF NOT EXISTS inbox_rule_organization_priority_idx
  ON app.inbox_rule(organization_id, priority)
  WHERE deleted_at IS NULL AND enabled;

-- Every nullable reference is restricted by its foreign key, which scans without an index.
CREATE INDEX IF NOT EXISTS inbox_rule_channel_idx
  ON app.inbox_rule(channel_id)
  WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_rule_set_legal_entity_idx
  ON app.inbox_rule(set_legal_entity_id)
  WHERE set_legal_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_rule_set_partner_idx
  ON app.inbox_rule(set_partner_id)
  WHERE set_partner_id IS NOT NULL;

COMMENT ON TABLE app.inbox_rule IS
  'One routing rule of an organization: closed conditions, closed actions, run as its author; soft deleted only.';
COMMENT ON COLUMN app.inbox_rule.priority IS
  'The evaluation order, unique per organization while live; null exactly when the rule is soft deleted.';
COMMENT ON COLUMN app.inbox_rule.sender_pattern IS
  'A lowercase @domain suffix or full address the sender must match.';
COMMENT ON COLUMN app.inbox_rule.set_assignee_id IS
  'The person a matched item is assigned to; a subject id, never a name.';
COMMENT ON COLUMN app.inbox_rule.discard_reason IS
  'Set on a discard rule, which is terminal and carries no other action.';
COMMENT ON COLUMN app.inbox_rule.created_by IS
  'The author the rule runs as; changed only by adoption to the session user or by erasure.';

-- Adoption is an explicit act of the adopter: created_by moves only to the session user, or to a tombstone under erasure.
CREATE OR REPLACE FUNCTION app.guard_inbox_rule_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
    AND NEW.created_by IS DISTINCT FROM current_setting('bap.user_id', true)
    AND current_user <> 'bap_eraser'
  THEN
    RAISE EXCEPTION 'An inbox rule is adopted only by the session user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION app.guard_inbox_rule_created_by() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.guard_inbox_rule_created_by() FROM PUBLIC;

CREATE OR REPLACE TRIGGER inbox_rule_guard_created_by
BEFORE UPDATE OF created_by ON app.inbox_rule
FOR EACH ROW
EXECUTE FUNCTION app.guard_inbox_rule_created_by();

-- The pointer 20260916.0001 left dangling: a rule that decided an item is never hard-deleted.
ALTER TABLE app.inbox_item
  ADD CONSTRAINT inbox_item_decided_by_rule_fkey FOREIGN KEY (decided_by_rule_id, organization_id)
    REFERENCES app.inbox_rule(id, organization_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS inbox_item_decided_by_rule_idx
  ON app.inbox_item(decided_by_rule_id)
  WHERE decided_by_rule_id IS NOT NULL;

-- One row per draft field a person changed away from what the platform suggested; a fact about one route.
CREATE TABLE IF NOT EXISTS app.inbox_correction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  inbox_item_id uuid NOT NULL,
  field text NOT NULL,
  suggested_value text,
  final_value text,
  -- Where the suggestion came from, in precedence order: hint, rule, target default, provider.
  source text NOT NULL,
  reason text,
  created_by text NOT NULL DEFAULT current_setting('bap.user_id', true),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_correction_field_check CHECK (field IN (
    'kind', 'legal_entity_id', 'partner_id', 'document_date', 'title', 'reference', 'currency_code'
  )),
  CONSTRAINT inbox_correction_source_check
    CHECK (source IN ('hint', 'rule', 'target_default', 'provider')),
  CONSTRAINT inbox_correction_reason_check CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  CONSTRAINT inbox_correction_item_fkey FOREIGN KEY (inbox_item_id, organization_id)
    REFERENCES app.inbox_item(id, organization_id) ON DELETE CASCADE
);

-- The item detail reads its corrections under the tenant predicate.
CREATE INDEX IF NOT EXISTS inbox_correction_item_idx
  ON app.inbox_correction(organization_id, inbox_item_id);

COMMENT ON TABLE app.inbox_correction IS
  'A draft field a person changed away from the suggested value when routing one item; never updated or deleted.';
COMMENT ON COLUMN app.inbox_correction.source IS
  'The origin of the suggested value: hint, rule, target_default or provider.';
COMMENT ON COLUMN app.inbox_correction.reason IS
  'One line the person gave for the change, at most 500 characters.';

ALTER TABLE app.inbox_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_rule FORCE ROW LEVEL SECURITY;

-- A member reads the rules of the organization; a channel never does, it reads the matcher's columns through the definer.
CREATE POLICY inbox_rule_select ON app.inbox_rule FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

-- Owner or admin writes, as themselves; there is no DELETE policy and no DELETE grant, so the only delete is deleted_at.
CREATE POLICY inbox_rule_insert ON app.inbox_rule FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY inbox_rule_update ON app.inbox_rule FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

-- FORCE row level security applies to the definer too: list_inbox_rules runs as bap_owner.
CREATE POLICY inbox_rule_maintenance_select ON app.inbox_rule FOR SELECT
  TO bap_owner USING (true);

GRANT SELECT, INSERT, UPDATE ON app.inbox_rule TO bap_api;
GRANT SELECT ON app.inbox_rule TO bap_reporting;
GRANT SELECT ON app.inbox_rule TO bap_backup;

-- The eraser keeps column-scoped grants only; the action columns are read to retire a rule left without an action.
GRANT SELECT (created_by, set_assignee_id, set_legal_entity_id, set_document_kind, set_partner_id, auto_route, deleted_at),
  UPDATE (created_by, set_assignee_id, enabled, priority, deleted_at) ON app.inbox_rule TO bap_eraser;

ALTER TABLE app.inbox_correction ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inbox_correction FORCE ROW LEVEL SECURITY;

CREATE POLICY inbox_correction_select ON app.inbox_correction FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND NOT app.role_is_channel()
  );

-- A correction is a fact about one route: written once by the person who routed, never updated or deleted.
CREATE POLICY inbox_correction_insert ON app.inbox_correction FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

GRANT SELECT, INSERT ON app.inbox_correction TO bap_api;
GRANT SELECT ON app.inbox_correction TO bap_reporting;
GRANT SELECT ON app.inbox_correction TO bap_backup;
GRANT SELECT (created_by), UPDATE (created_by) ON app.inbox_correction TO bap_eraser;

-- The automation's reason: the rule author is no longer a verified owner or admin, so the route was skipped.
ALTER TABLE app.inbox_event DROP CONSTRAINT IF EXISTS inbox_event_reason_check;
ALTER TABLE app.inbox_event
  ADD CONSTRAINT inbox_event_reason_check CHECK (reason IS NULL OR reason IN (
    'irrelevant', 'duplicate', 'not_ours', 'spam',
    'unsupported_type', 'password_protected', 'encrypted', 'empty', 'unreadable',
    'decorative_image', 'too_large', 'policy_rejected', 'stalled', 'rule_author_unavailable'
  ));

-- The one read path of the matcher: the live rules of the current organization whose author is still a verified
-- owner or admin member, the predicate of auth.resolve_membership. Conditions, actions, id and priority only.
CREATE OR REPLACE FUNCTION app.list_inbox_rules()
RETURNS TABLE (
  id uuid,
  priority integer,
  channel_id uuid,
  sender_pattern text,
  keyword text,
  detected_type text,
  set_legal_entity_id uuid,
  set_document_kind text,
  set_partner_id uuid,
  set_assignee_id text,
  discard_reason text,
  auto_route boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  -- Tenant identity is derived from the transaction context and never from an argument.
  context_organization_id text := current_setting('bap.organization_id', true);
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Inbox rules require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      rule.id,
      rule.priority,
      rule.channel_id,
      rule.sender_pattern,
      rule.keyword,
      rule.detected_type,
      rule.set_legal_entity_id,
      rule.set_document_kind,
      rule.set_partner_id,
      rule.set_assignee_id,
      rule.discard_reason,
      rule.auto_route
    FROM app.inbox_rule AS rule
    WHERE rule.organization_id = context_organization_id
      AND rule.enabled
      AND rule.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM auth.member AS m
        INNER JOIN auth."user" AS u ON u.id = m.user_id
        WHERE m.user_id = rule.created_by
          AND m.organization_id = rule.organization_id
          AND u.email_verified = true
          AND m.role IN ('owner', 'admin')
      )
    ORDER BY rule.priority;
END;
$$;

ALTER FUNCTION app.list_inbox_rules() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.list_inbox_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_inbox_rules() TO bap_api;

-- FORCE row level security applies to the definer too: list_inbox_routing_targets runs as bap_owner.
CREATE POLICY inbox_routing_target_maintenance_select ON app.inbox_routing_target FOR SELECT
  TO bap_owner USING (true);

-- The one read path of the routing targets: the organization's own rows for every principal, the channel included,
-- so an email child or an API intake decides the auto-route against the same targets a member sees.
-- updated_by is the account the target default routes as; it is a subject id, never tenant content.
CREATE OR REPLACE FUNCTION app.list_inbox_routing_targets()
RETURNS TABLE (
  detected_type text,
  destination text,
  document_kind text,
  default_legal_entity_id uuid,
  partner_policy text,
  auto text,
  auto_threshold numeric,
  default_assignee_id text,
  required_fields text[],
  updated_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  -- Tenant identity is derived from the transaction context and never from an argument.
  context_organization_id text := current_setting('bap.organization_id', true);
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Inbox routing targets require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      target.detected_type,
      target.destination,
      target.document_kind,
      target.default_legal_entity_id,
      target.partner_policy,
      target.auto,
      target.auto_threshold,
      target.default_assignee_id,
      target.required_fields,
      target.updated_by
    FROM app.inbox_routing_target AS target
    WHERE target.organization_id = context_organization_id
    ORDER BY target.detected_type;
END;
$$;

ALTER FUNCTION app.list_inbox_routing_targets() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.list_inbox_routing_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_inbox_routing_targets() TO bap_api;

-- The only write the read-only automation subject has: one failed event with no actor on an item still in review.
-- The function body is the tenant boundary; inbox_event_maintenance_insert already admits bap_owner.
CREATE OR REPLACE FUNCTION app.record_inbox_automation_skip(item_id uuid, reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
  recorded_id uuid := gen_random_uuid();
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Inbox automation skips require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF record_inbox_automation_skip.reason IS DISTINCT FROM 'rule_author_unavailable' THEN
    RAISE EXCEPTION 'Inbox automation skips carry the reason rule_author_unavailable only';
  END IF;

  INSERT INTO app.inbox_event (id, organization_id, item_id, kind, reason, actor_user_id)
  SELECT recorded_id, item.organization_id, item.id, 'failed', record_inbox_automation_skip.reason, NULL
  FROM app.inbox_item AS item
  WHERE item.id = record_inbox_automation_skip.item_id
    AND item.organization_id = context_organization_id
    AND item.status = 'needs_review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inbox automation skips name an item in review of the current organization';
  END IF;

  RETURN recorded_id;
END;
$$;

ALTER FUNCTION app.record_inbox_automation_skip(uuid, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.record_inbox_automation_skip(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_inbox_automation_skip(uuid, text) TO bap_api;

-- The system subject namespace stays disjoint from identities: no person can ever be system_automation.
ALTER TABLE auth."user"
  ADD CONSTRAINT user_id_not_system_check CHECK (id NOT LIKE 'system\_%');

-- The rule author, the rule assignee and the correction author join the erasure (ADR 0008).
-- A rule assignee is a forward-looking pointer, so it is nulled rather than tombstoned, and a rule whose only action
-- was that assignment is retired, because a live rule needs an action. A system subject is never erased.
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

  IF subject_user_id LIKE 'system\_%' THEN
    RAISE EXCEPTION 'User erasure never names a system subject';
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
    UNION ALL
    SELECT 1 FROM app.inbox_rule
    WHERE created_by = subject_user_id OR set_assignee_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_correction WHERE created_by = subject_user_id
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

  UPDATE app.inbox_rule
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  -- Soft deleted like every rule delete: the slot is freed and the row stays for the items it decided.
  UPDATE app.inbox_rule
  SET set_assignee_id = NULL, enabled = false, priority = NULL, deleted_at = now()
  WHERE set_assignee_id = subject_user_id
    AND deleted_at IS NULL
    AND set_legal_entity_id IS NULL
    AND set_document_kind IS NULL
    AND set_partner_id IS NULL
    AND NOT auto_route;

  UPDATE app.inbox_rule
  SET set_assignee_id = NULL
  WHERE set_assignee_id = subject_user_id;

  UPDATE app.inbox_correction
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;
