ALTER TABLE app.payroll_run ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE app.payroll_run ADD COLUMN status text NOT NULL DEFAULT 'draft';
ALTER TABLE app.payroll_run ADD COLUMN origin text NOT NULL DEFAULT 'calculated';
ALTER TABLE app.payroll_run ADD COLUMN idempotency_key uuid;
ALTER TABLE app.payroll_run ADD COLUMN validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app.payroll_run ADD COLUMN approved_by text;
ALTER TABLE app.payroll_run ADD COLUMN approved_at timestamptz;
ALTER TABLE app.payroll_run ADD COLUMN finalized_by text;
ALTER TABLE app.payroll_run ADD COLUMN finalized_at timestamptz;
ALTER TABLE app.payroll_run ADD COLUMN paid_by text;
ALTER TABLE app.payroll_run ADD COLUMN paid_at timestamptz;
ALTER TABLE app.payroll_run ADD COLUMN payment_reference varchar(200);
ALTER TABLE app.payroll_run ADD COLUMN rule_set_id uuid;
ALTER TABLE app.payroll_run ADD CONSTRAINT payroll_run_status_check CHECK (status IN ('draft', 'validating', 'ready_for_approval', 'approved', 'finalized', 'paid', 'superseded'));
ALTER TABLE app.payroll_run ADD CONSTRAINT payroll_run_origin_check CHECK (origin IN ('imported', 'calculated'));
ALTER TABLE app.payroll_run ADD CONSTRAINT payroll_run_document_finalized_check CHECK (status NOT IN ('finalized', 'paid', 'superseded') OR document_id IS NOT NULL);
ALTER TABLE app.payroll_run ADD CONSTRAINT payroll_run_idempotency_key UNIQUE (organization_id, idempotency_key);

ALTER TABLE app.payroll_run NO FORCE ROW LEVEL SECURITY;
UPDATE app.payroll_run
SET status = 'finalized', origin = 'imported', finalized_by = created_by, finalized_at = created_at;
ALTER TABLE app.payroll_run FORCE ROW LEVEL SECURITY;

CREATE TABLE app.payroll_run_state_transition (
  from_status text NOT NULL, to_status text NOT NULL,
  CONSTRAINT payroll_run_state_transition_from_status_check CHECK (from_status IN ('draft', 'validating', 'ready_for_approval', 'approved', 'finalized', 'paid')),
  CONSTRAINT payroll_run_state_transition_to_status_check CHECK (to_status IN ('draft', 'validating', 'ready_for_approval', 'approved', 'finalized', 'paid', 'superseded')),
  CONSTRAINT payroll_run_state_transition_key UNIQUE (from_status, to_status)
);
INSERT INTO app.payroll_run_state_transition (from_status, to_status) VALUES
  ('draft', 'validating'), ('validating', 'draft'), ('validating', 'ready_for_approval'),
  ('ready_for_approval', 'draft'), ('ready_for_approval', 'approved'),
  ('approved', 'finalized'), ('finalized', 'paid'), ('finalized', 'superseded'), ('paid', 'superseded');
GRANT SELECT ON app.payroll_run_state_transition TO bap_api;

CREATE TABLE app.hr_access_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  user_id text NOT NULL, access_role text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_access_assignment_access_role_check CHECK (access_role IN ('hr_admin', 'payroll_specialist', 'payroll_approver', 'sensitive_hr', 'hr_auditor')),
  CONSTRAINT hr_access_assignment_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_access_assignment_entity_user_role_key UNIQUE (organization_id, legal_entity_id, user_id, access_role),
  CONSTRAINT hr_access_assignment_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_component_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, kind text NOT NULL, recurrence text NOT NULL, accounting_key varchar(64) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_component_definition_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT payroll_component_definition_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT payroll_component_definition_kind_check CHECK (kind IN ('earning', 'deduction', 'employer_contribution')),
  CONSTRAINT payroll_component_definition_recurrence_check CHECK (recurrence IN ('recurring', 'one_off')),
  CONSTRAINT payroll_component_definition_accounting_key_check CHECK (length(accounting_key) BETWEEN 1 AND 64),
  CONSTRAINT payroll_component_definition_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_component_definition_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT payroll_component_definition_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.employee_compensation_component (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL, component_definition_id uuid NOT NULL,
  valid_from date NOT NULL, valid_to date, amount numeric(19,4) NOT NULL, currency char(3) NOT NULL DEFAULT 'CZK',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_compensation_component_dates_check CHECK (valid_to IS NULL OR valid_from <= valid_to),
  CONSTRAINT employee_compensation_component_amount_check CHECK (amount >= 0),
  CONSTRAINT employee_compensation_component_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT employee_compensation_component_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_compensation_component_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_compensation_component_definition_fkey FOREIGN KEY (component_definition_id, organization_id) REFERENCES app.payroll_component_definition(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employee_compensation_component_relationship_definition_from_key UNIQUE (relationship_id, component_definition_id, valid_from),
  CONSTRAINT employee_compensation_component_id_organization_key UNIQUE (id, organization_id)
);

ALTER TABLE app.payroll_result ADD CONSTRAINT payroll_result_id_organization_key UNIQUE (id, organization_id);
CREATE TABLE app.payroll_result_component (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, payroll_result_id uuid NOT NULL, component_definition_id uuid NOT NULL,
  amount numeric(19,4) NOT NULL, source text NOT NULL, description varchar(200),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_result_component_amount_check CHECK (amount >= 0),
  CONSTRAINT payroll_result_component_source_check CHECK (source IN ('imported', 'calculated', 'adjustment')),
  CONSTRAINT payroll_result_component_description_check CHECK (description IS NULL OR length(description) BETWEEN 1 AND 200),
  CONSTRAINT payroll_result_component_result_fkey FOREIGN KEY (payroll_result_id, organization_id) REFERENCES app.payroll_result(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_result_component_definition_fkey FOREIGN KEY (component_definition_id, organization_id) REFERENCES app.payroll_component_definition(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_result_component_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_liability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, payroll_run_id uuid NOT NULL,
  kind text NOT NULL, creditor_reference varchar(200), amount numeric(19,4) NOT NULL, due_on date NOT NULL, status text NOT NULL DEFAULT 'open', paid_at timestamptz,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_liability_kind_check CHECK (kind IN ('net_wages', 'social', 'health', 'income_tax', 'other')),
  CONSTRAINT payroll_liability_amount_check CHECK (amount >= 0),
  CONSTRAINT payroll_liability_status_check CHECK (status IN ('open', 'paid')),
  CONSTRAINT payroll_liability_run_fkey FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_liability_run_kind_creditor_key UNIQUE NULLS NOT DISTINCT (payroll_run_id, kind, creditor_reference),
  CONSTRAINT payroll_liability_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, payroll_run_id uuid NOT NULL,
  action text NOT NULL, actor_user_id text NOT NULL, reason varchar(500), acted_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_approval_action_check CHECK (action IN ('submitted', 'approved', 'rejected', 'finalized', 'paid')),
  CONSTRAINT payroll_approval_reason_check CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  CONSTRAINT payroll_approval_run_fkey FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_approval_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  accounting_key varchar(64) NOT NULL, account_code varchar(16) NOT NULL, side text NOT NULL, valid_from date NOT NULL, valid_to date,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_account_mapping_accounting_key_check CHECK (length(accounting_key) BETWEEN 1 AND 64),
  CONSTRAINT payroll_account_mapping_account_code_check CHECK (length(account_code) BETWEEN 1 AND 16),
  CONSTRAINT payroll_account_mapping_side_check CHECK (side IN ('debit', 'credit')),
  CONSTRAINT payroll_account_mapping_dates_check CHECK (valid_to IS NULL OR valid_from <= valid_to),
  CONSTRAINT payroll_account_mapping_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_account_mapping_entity_key_from_key UNIQUE (legal_entity_id, accounting_key, valid_from),
  CONSTRAINT payroll_account_mapping_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_result_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, payroll_result_id uuid NOT NULL, document_id uuid NOT NULL, kind text NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_result_document_kind_check CHECK (kind IN ('payslip', 'supporting')),
  CONSTRAINT payroll_result_document_result_fkey FOREIGN KEY (payroll_result_id, organization_id) REFERENCES app.payroll_result(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_result_document_document_fkey FOREIGN KEY (document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_result_document_result_document_key UNIQUE (payroll_result_id, document_id),
  CONSTRAINT payroll_result_document_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.payroll_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, source_document_id uuid NOT NULL, idempotency_key uuid NOT NULL,
  format text NOT NULL, status text NOT NULL DEFAULT 'staged', row_count integer NOT NULL DEFAULT 0, error_count integer NOT NULL DEFAULT 0, error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_import_format_check CHECK (format IN ('csv', 'xlsx')),
  CONSTRAINT payroll_import_status_check CHECK (status IN ('staged', 'validated', 'failed', 'consumed')),
  CONSTRAINT payroll_import_row_count_check CHECK (row_count >= 0),
  CONSTRAINT payroll_import_error_count_check CHECK (error_count >= 0),
  CONSTRAINT payroll_import_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_import_document_fkey FOREIGN KEY (source_document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_import_idempotency_key UNIQUE (organization_id, idempotency_key),
  CONSTRAINT payroll_import_id_organization_key UNIQUE (id, organization_id)
);

CREATE INDEX hr_access_assignment_entity_user_idx ON app.hr_access_assignment(organization_id, legal_entity_id, user_id, id);
CREATE INDEX payroll_component_definition_entity_active_idx ON app.payroll_component_definition(organization_id, legal_entity_id, active, code, id);
CREATE INDEX employee_compensation_component_employee_valid_idx ON app.employee_compensation_component(organization_id, employee_id, valid_from DESC, id);
CREATE INDEX payroll_result_component_result_idx ON app.payroll_result_component(organization_id, payroll_result_id, id);
CREATE INDEX payroll_liability_run_status_due_idx ON app.payroll_liability(organization_id, payroll_run_id, status, due_on, id);
CREATE INDEX payroll_approval_run_acted_idx ON app.payroll_approval(organization_id, payroll_run_id, acted_at, id);
CREATE INDEX payroll_account_mapping_entity_key_valid_idx ON app.payroll_account_mapping(organization_id, legal_entity_id, accounting_key, valid_from DESC, id);
CREATE INDEX payroll_result_document_result_idx ON app.payroll_result_document(organization_id, payroll_result_id, id);
CREATE INDEX payroll_import_entity_status_created_idx ON app.payroll_import(organization_id, legal_entity_id, status, created_at DESC, id);

CREATE OR REPLACE FUNCTION app.check_payroll_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM app.payroll_run_state_transition transition
    WHERE transition.from_status = OLD.status AND transition.to_status = NEW.status
  ) THEN
    RAISE EXCEPTION 'Payroll workflow transition is not permitted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_run_status_transition_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_run_status_transition_check BEFORE UPDATE ON app.payroll_run FOR EACH ROW EXECUTE FUNCTION app.check_payroll_workflow();

CREATE OR REPLACE FUNCTION app.check_payroll_entity_pinning()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE employee_entity uuid; relationship_employee uuid; relationship_entity uuid; reference_entity uuid;
BEGIN
  IF TG_TABLE_NAME = 'employee_compensation_component' THEN
    SELECT legal_entity_id INTO employee_entity FROM app.employee WHERE id = NEW.employee_id AND organization_id = NEW.organization_id;
    SELECT employee_id INTO relationship_employee FROM app.employment_relationship WHERE id = NEW.relationship_id AND organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.payroll_component_definition WHERE id = NEW.component_definition_id AND organization_id = NEW.organization_id;
    IF relationship_employee <> NEW.employee_id OR reference_entity <> employee_entity THEN RAISE EXCEPTION 'Compensation component references must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_compensation_component_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'payroll_result_component' THEN
    SELECT run.legal_entity_id INTO relationship_entity FROM app.payroll_result result JOIN app.payroll_run run ON run.id = result.payroll_run_id AND run.organization_id = result.organization_id WHERE result.id = NEW.payroll_result_id AND result.organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.payroll_component_definition WHERE id = NEW.component_definition_id AND organization_id = NEW.organization_id;
    IF reference_entity <> relationship_entity THEN RAISE EXCEPTION 'Payroll result component definition must belong to the run legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_result_component_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'payroll_result_document' THEN
    SELECT run.legal_entity_id INTO relationship_entity FROM app.payroll_result result JOIN app.payroll_run run ON run.id = result.payroll_run_id AND run.organization_id = result.organization_id WHERE result.id = NEW.payroll_result_id AND result.organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.document WHERE id = NEW.document_id AND organization_id = NEW.organization_id;
    IF reference_entity <> relationship_entity THEN RAISE EXCEPTION 'Payroll result document must belong to the run legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_result_document_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'payroll_import' THEN
    SELECT legal_entity_id INTO reference_entity FROM app.document WHERE id = NEW.source_document_id AND organization_id = NEW.organization_id;
    IF reference_entity <> NEW.legal_entity_id THEN RAISE EXCEPTION 'Payroll import document must belong to its legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_import_entity_pinning_check'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_compensation_component_entity_pinning_check BEFORE INSERT OR UPDATE ON app.employee_compensation_component FOR EACH ROW EXECUTE FUNCTION app.check_payroll_entity_pinning();
CREATE TRIGGER payroll_result_component_entity_pinning_check BEFORE INSERT OR UPDATE ON app.payroll_result_component FOR EACH ROW EXECUTE FUNCTION app.check_payroll_entity_pinning();
CREATE TRIGGER payroll_result_document_entity_pinning_check BEFORE INSERT OR UPDATE ON app.payroll_result_document FOR EACH ROW EXECUTE FUNCTION app.check_payroll_entity_pinning();
CREATE TRIGGER payroll_import_entity_pinning_check BEFORE INSERT OR UPDATE ON app.payroll_import FOR EACH ROW EXECUTE FUNCTION app.check_payroll_entity_pinning();

ALTER TABLE app.hr_access_assignment ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_access_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_component_definition ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_component_definition FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employee_compensation_component ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employee_compensation_component FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_result_component ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_result_component FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_liability ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_liability FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_approval ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_approval FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_account_mapping ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_account_mapping FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_result_document ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_result_document FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_import ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_import FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['hr_access_assignment','payroll_component_definition','employee_compensation_component','payroll_result_component','payroll_liability','payroll_approval','payroll_account_mapping','payroll_result_document','payroll_import'] LOOP
    EXECUTE format('CREATE POLICY %I_select ON app.%I FOR SELECT USING (organization_id = current_setting(''bap.organization_id'', true))', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_insert ON app.%I FOR INSERT WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND created_by = current_setting(''bap.user_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_update ON app.%I FOR UPDATE USING (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_delete ON app.%I FOR DELETE USING (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('GRANT SELECT ON app.%I TO bap_reporting, bap_backup', table_name);
    EXECUTE format('GRANT SELECT (created_by), UPDATE (created_by) ON app.%I TO bap_eraser', table_name);
  END LOOP;
END $$;
DROP POLICY payroll_result_component_update ON app.payroll_result_component; DROP POLICY payroll_result_component_delete ON app.payroll_result_component;
DROP POLICY payroll_liability_delete ON app.payroll_liability;
DROP POLICY payroll_approval_update ON app.payroll_approval; DROP POLICY payroll_approval_delete ON app.payroll_approval;
DROP POLICY payroll_result_document_update ON app.payroll_result_document; DROP POLICY payroll_result_document_delete ON app.payroll_result_document;
REVOKE ALL ON app.hr_access_assignment, app.payroll_component_definition, app.employee_compensation_component, app.payroll_result_component, app.payroll_liability, app.payroll_approval, app.payroll_account_mapping, app.payroll_result_document, app.payroll_import, app.payroll_result, app.payroll_run FROM bap_api;
GRANT SELECT, INSERT, DELETE ON app.hr_access_assignment TO bap_api;
GRANT SELECT, INSERT ON app.payroll_component_definition, app.employee_compensation_component, app.payroll_result_component, app.payroll_approval, app.payroll_result_document TO bap_api;
GRANT SELECT, INSERT ON app.payroll_result TO bap_api;
GRANT SELECT, INSERT ON app.payroll_liability TO bap_api;
GRANT SELECT, INSERT ON app.payroll_account_mapping, app.payroll_import TO bap_api;
GRANT UPDATE (name, active) ON app.payroll_component_definition TO bap_api;
GRANT UPDATE (valid_to) ON app.employee_compensation_component, app.payroll_account_mapping TO bap_api;
GRANT UPDATE (status, paid_at) ON app.payroll_liability TO bap_api;
GRANT UPDATE (status, row_count, error_count, error_report) ON app.payroll_import TO bap_api;
CREATE POLICY payroll_run_update ON app.payroll_run FOR UPDATE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
GRANT SELECT, INSERT ON app.payroll_run TO bap_api;
GRANT UPDATE (status, validation_summary, document_id, approved_by, approved_at, finalized_by, finalized_at, paid_by, paid_at, payment_reference) ON app.payroll_run TO bap_api;
GRANT SELECT (approved_by, finalized_by, paid_by), UPDATE (approved_by, finalized_by, paid_by) ON app.payroll_run TO bap_eraser;
GRANT SELECT (actor_user_id), UPDATE (actor_user_id) ON app.payroll_approval TO bap_eraser;
GRANT SELECT (user_id), UPDATE (user_id) ON app.hr_access_assignment TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN RAISE EXCEPTION 'User erasure requires an explicit subject'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id UNION ALL SELECT 1 FROM app.dataset WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.member_entity_scope WHERE user_id = subject_user_id OR updated_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity_access WHERE user_id = subject_user_id OR created_by = subject_user_id UNION ALL SELECT 1 FROM app.document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.partner WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.document_link WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id OR approved_by = subject_user_id OR finalized_by = subject_user_id OR paid_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id UNION ALL SELECT 1 FROM app.hr_access_assignment WHERE created_by = subject_user_id OR user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_component_definition WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_compensation_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_liability WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_approval WHERE created_by = subject_user_id OR actor_user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_account_mapping WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_import WHERE created_by = subject_user_id
  ) THEN RETURN NULL; END IF;
  tombstone := 'erased_' || gen_random_uuid()::text;
  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id; DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id; DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id; UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id; UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_run SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET finalized_by = tombstone WHERE finalized_by = subject_user_id; UPDATE app.payroll_run SET paid_by = tombstone WHERE paid_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id; UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  UPDATE app.hr_access_assignment SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_access_assignment SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.payroll_component_definition SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_compensation_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_liability SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET actor_user_id = tombstone WHERE actor_user_id = subject_user_id; UPDATE app.payroll_account_mapping SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_import SET created_by = tombstone WHERE created_by = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
