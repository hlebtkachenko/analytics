CREATE TABLE app.payroll_command_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  payroll_run_id uuid NOT NULL,
  command text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  result_payroll_run_id uuid,
  reason varchar(500),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_command_receipt_command_check CHECK (command IN ('validate','submit','approve','reject','finalize','record_payment','correct')),
  CONSTRAINT payroll_command_receipt_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT payroll_command_receipt_reason_check CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  CONSTRAINT payroll_command_receipt_run_fkey FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_command_receipt_result_run_fkey FOREIGN KEY (result_payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_command_receipt_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT payroll_command_receipt_idempotency_key UNIQUE (organization_id, idempotency_key)
);
ALTER TABLE app.payroll_run ADD COLUMN idempotency_request_hash char(64);
ALTER TABLE app.payroll_run ADD CONSTRAINT payroll_run_idempotency_request_hash_check CHECK (idempotency_request_hash IS NULL OR idempotency_request_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX payroll_command_receipt_run_idx ON app.payroll_command_receipt(organization_id, payroll_run_id, created_at);

ALTER TABLE app.payroll_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_command_receipt_select ON app.payroll_command_receipt FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY payroll_command_receipt_insert ON app.payroll_command_receipt FOR INSERT
  WITH CHECK (organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());

ALTER POLICY payroll_account_mapping_select ON app.payroll_account_mapping
  USING (organization_id = current_setting('bap.organization_id', true) OR current_user = 'bap_owner');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.payroll_account_mapping WHERE account_code !~ '^[0-9]{3}$') THEN
    RAISE EXCEPTION 'payroll_account_mapping.account_code must already contain exactly three digits';
  END IF;
END;
$$;
ALTER TABLE app.payroll_account_mapping
  ALTER COLUMN account_code TYPE char(3) USING account_code::char(3);
ALTER TABLE app.payroll_account_mapping
  DROP CONSTRAINT payroll_account_mapping_account_code_check;
ALTER TABLE app.payroll_account_mapping
  ADD CONSTRAINT payroll_account_mapping_account_code_check CHECK (account_code ~ '^[0-9]{3}$');
ALTER TABLE app.payroll_account_mapping
  ADD CONSTRAINT payroll_account_mapping_account_fkey FOREIGN KEY (account_code)
    REFERENCES app.directive_account(code);

CREATE POLICY hr_access_assignment_payroll_manager_lookup ON app.hr_access_assignment FOR SELECT TO bap_owner USING (true);

CREATE OR REPLACE FUNCTION app.has_other_payroll_manager(target_organization_id text, target_legal_entity_id uuid, excluded_user_id text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = app, auth, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.member m
    JOIN auth."user" u ON u.id = m.user_id AND u.email_verified = true
    WHERE m.organization_id = target_organization_id
      AND m.user_id <> excluded_user_id
      AND (
        'owner' = ANY(string_to_array(m.role, ','))
        OR (
          EXISTS (SELECT 1 FROM app.hr_access_assignment a
            WHERE a.organization_id = target_organization_id AND a.legal_entity_id = target_legal_entity_id
              AND a.user_id = m.user_id AND a.access_role = 'payroll_specialist')
          AND (
            NOT EXISTS (SELECT 1 FROM app.member_entity_scope s WHERE s.organization_id = target_organization_id AND s.user_id = m.user_id)
            OR EXISTS (SELECT 1 FROM app.member_entity_scope s WHERE s.organization_id = target_organization_id AND s.user_id = m.user_id AND s.mode = 'all')
            OR EXISTS (SELECT 1 FROM app.legal_entity_access e WHERE e.organization_id = target_organization_id AND e.user_id = m.user_id AND e.legal_entity_id = target_legal_entity_id)
          )
        )
      )
  );
$$;
ALTER FUNCTION app.has_other_payroll_manager(text, uuid, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.has_other_payroll_manager(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_other_payroll_manager(text, uuid, text) TO bap_api;

GRANT SELECT, INSERT ON app.payroll_command_receipt TO bap_api;
GRANT SELECT ON app.payroll_command_receipt TO bap_reporting, bap_backup;
GRANT SELECT (created_by), UPDATE (created_by) ON app.payroll_command_receipt TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN RAISE EXCEPTION 'User erasure requires an explicit subject'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id UNION ALL SELECT 1 FROM app.dataset WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.member_entity_scope WHERE user_id = subject_user_id OR updated_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity_access WHERE user_id = subject_user_id OR created_by = subject_user_id UNION ALL SELECT 1 FROM app.document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.partner WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.document_link WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id OR approved_by = subject_user_id OR finalized_by = subject_user_id OR paid_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id UNION ALL SELECT 1 FROM app.hr_access_assignment WHERE created_by = subject_user_id OR user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_component_definition WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_compensation_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_liability WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_approval WHERE created_by = subject_user_id OR actor_user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_account_mapping WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_import WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_command_receipt WHERE created_by = subject_user_id
  ) THEN RETURN NULL; END IF;
  tombstone := 'erased_' || gen_random_uuid()::text;
  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id; DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id; DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id; UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id; UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_run SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET finalized_by = tombstone WHERE finalized_by = subject_user_id; UPDATE app.payroll_run SET paid_by = tombstone WHERE paid_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id; UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  UPDATE app.hr_access_assignment SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_access_assignment SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.payroll_component_definition SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_compensation_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_liability SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET actor_user_id = tombstone WHERE actor_user_id = subject_user_id; UPDATE app.payroll_account_mapping SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_import SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_command_receipt SET created_by = tombstone WHERE created_by = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
