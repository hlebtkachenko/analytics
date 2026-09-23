DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.organization WHERE slug = 'my-hr') THEN RAISE EXCEPTION 'Reserved organization slug is already in use' USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_slug_reserved_check'; END IF;
END $$;
ALTER TABLE auth.organization DROP CONSTRAINT organization_slug_reserved_check;
ALTER TABLE auth.organization ADD CONSTRAINT organization_slug_reserved_check CHECK (slug NOT IN ('access','api','datasets','design-system','health','invitation','metrics','ready','sign-in','sign-up','forgot-password','reset-password','activate','welcome','account','organizations','documents','employees','payroll','hr-settings','time','my-hr'));

ALTER TABLE app.employee ADD CONSTRAINT employee_id_entity_organization_key UNIQUE (id, legal_entity_id, organization_id);

CREATE TABLE app.employee_user_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  legal_entity_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_user_binding_status_check CHECK (status IN ('pending', 'active', 'revoked')),
  CONSTRAINT employee_user_binding_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_user_binding_employee_fkey FOREIGN KEY (employee_id, legal_entity_id, organization_id) REFERENCES app.employee(id, legal_entity_id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_user_binding_employee_key UNIQUE (employee_id),
  CONSTRAINT employee_user_binding_organization_user_key UNIQUE (organization_id, user_id),
  CONSTRAINT employee_user_binding_id_organization_key UNIQUE (id, organization_id)
);

CREATE FUNCTION app.check_employee_user_binding_status() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'bap_eraser' THEN RETURN NEW; END IF;
  IF (OLD.status = 'pending' AND NEW.status = 'active' AND NEW.verified_at IS NOT NULL) OR (OLD.status IN ('pending', 'active') AND NEW.status = 'revoked') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' AND NEW.verified_at IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid employee binding state transition' USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_user_binding_status_check';
END;
$$;
CREATE TRIGGER employee_user_binding_status_check BEFORE INSERT OR UPDATE ON app.employee_user_binding FOR EACH ROW EXECUTE FUNCTION app.check_employee_user_binding_status();

ALTER TABLE app.employee_user_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.employee_user_binding FORCE ROW LEVEL SECURITY;
CREATE INDEX employee_user_binding_entity_status_idx ON app.employee_user_binding(organization_id, legal_entity_id, status, employee_id, id);
CREATE POLICY employee_user_binding_select ON app.employee_user_binding FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY employee_user_binding_insert ON app.employee_user_binding FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
CREATE POLICY employee_user_binding_update ON app.employee_user_binding FOR UPDATE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
GRANT SELECT, INSERT ON app.employee_user_binding TO bap_api;
GRANT UPDATE (status, verified_at, updated_at) ON app.employee_user_binding TO bap_api;
GRANT SELECT ON app.employee_user_binding TO bap_reporting, bap_backup;
GRANT SELECT (created_by, user_id), UPDATE (created_by, user_id) ON app.employee_user_binding TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN RAISE EXCEPTION 'User erasure requires an explicit subject'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id UNION ALL SELECT 1 FROM app.dataset WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.member_entity_scope WHERE user_id = subject_user_id OR updated_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity_access WHERE user_id = subject_user_id OR created_by = subject_user_id UNION ALL SELECT 1 FROM app.document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.partner WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.document_link WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id OR approved_by = subject_user_id OR finalized_by = subject_user_id OR paid_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id UNION ALL SELECT 1 FROM app.hr_access_assignment WHERE created_by = subject_user_id OR user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_component_definition WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_compensation_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_liability WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_approval WHERE created_by = subject_user_id OR actor_user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_account_mapping WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_import WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_command_receipt WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.work_schedule WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.work_shift WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.timesheet WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.time_entry WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_type WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_request WHERE created_by = subject_user_id OR decided_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_ledger WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.absence WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_user_binding WHERE created_by = subject_user_id OR user_id = subject_user_id
  ) THEN RETURN NULL; END IF;
  tombstone := 'erased_' || gen_random_uuid()::text;
  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id; DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id; DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id; UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id; UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_run SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET finalized_by = tombstone WHERE finalized_by = subject_user_id; UPDATE app.payroll_run SET paid_by = tombstone WHERE paid_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id; UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  UPDATE app.hr_access_assignment SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_access_assignment SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.payroll_component_definition SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_compensation_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_liability SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET actor_user_id = tombstone WHERE actor_user_id = subject_user_id; UPDATE app.payroll_account_mapping SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_import SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_command_receipt SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.work_schedule SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.work_shift SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.timesheet SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.timesheet SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.time_entry SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_type SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_request SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_request SET decided_by = tombstone WHERE decided_by = subject_user_id; UPDATE app.leave_ledger SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.absence SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_user_binding SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_user_binding SET user_id = tombstone WHERE user_id = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
