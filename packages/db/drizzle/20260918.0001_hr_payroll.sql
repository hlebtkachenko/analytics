-- HR facts deliberately exclude sensitive identifiers and payment details.
CREATE TABLE app.employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  employee_number text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
  work_email text, work_phone text, status text NOT NULL DEFAULT 'active', created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_number_check CHECK (employee_number ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT employee_name_check CHECK (first_name = btrim(first_name) AND last_name = btrim(last_name) AND length(first_name) BETWEEN 1 AND 100 AND length(last_name) BETWEEN 1 AND 100),
  CONSTRAINT employee_work_email_length_check CHECK (work_email IS NULL OR length(work_email) <= 254),
  CONSTRAINT employee_work_phone_length_check CHECK (work_phone IS NULL OR length(work_phone) <= 64),
  CONSTRAINT employee_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT employee_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_entity_number_key UNIQUE (legal_entity_id, employee_number),
  CONSTRAINT employee_id_organization_key UNIQUE (id, organization_id)
);
CREATE INDEX employee_entity_idx ON app.employee(organization_id, legal_entity_id, status, last_name, first_name, id);

CREATE TABLE app.employment_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, employee_id uuid NOT NULL,
  kind text NOT NULL, position text NOT NULL, department text, cost_centre text, weekly_hours numeric(5,2) NOT NULL,
  start_date date NOT NULL, end_date date, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_relationship_kind_check CHECK (kind IN ('employment', 'dpp', 'dpc', 'executive')),
  CONSTRAINT employment_relationship_position_check CHECK (length(position) BETWEEN 1 AND 200),
  CONSTRAINT employment_relationship_department_check CHECK (department IS NULL OR length(department) <= 200),
  CONSTRAINT employment_relationship_cost_centre_check CHECK (cost_centre IS NULL OR length(cost_centre) <= 64),
  CONSTRAINT employment_relationship_hours_check CHECK (weekly_hours > 0 AND weekly_hours <= 168),
  CONSTRAINT employment_relationship_dates_check CHECK (end_date IS NULL OR start_date <= end_date),
  CONSTRAINT employment_relationship_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX employment_relationship_employee_idx ON app.employment_relationship(organization_id, employee_id, start_date DESC);

CREATE TABLE app.employee_document (
  organization_id text NOT NULL, employee_id uuid NOT NULL, document_id uuid NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, document_id),
  CONSTRAINT employee_document_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_document_document_fkey FOREIGN KEY (document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE app.payroll_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, document_id uuid NOT NULL,
  payroll_month date NOT NULL, version integer NOT NULL DEFAULT 1, supersedes_payroll_run_id uuid, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_month_check CHECK (payroll_month = date_trunc('month', payroll_month)::date),
  CONSTRAINT payroll_run_version_check CHECK (version >= 1),
  CONSTRAINT payroll_run_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_run_document_fkey FOREIGN KEY (document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_run_supersedes_fkey FOREIGN KEY (supersedes_payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_run_supersedes_not_self_check CHECK (supersedes_payroll_run_id IS NULL OR supersedes_payroll_run_id <> id),
  CONSTRAINT payroll_run_entity_month_version_key UNIQUE (legal_entity_id, payroll_month, version),
  CONSTRAINT payroll_run_id_organization_key UNIQUE (id, organization_id)
);
CREATE INDEX payroll_run_entity_month_idx ON app.payroll_run(organization_id, legal_entity_id, payroll_month DESC, version DESC);

CREATE TABLE app.payroll_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, payroll_run_id uuid NOT NULL, employee_id uuid NOT NULL,
  gross_pay numeric(19,4) NOT NULL, employee_social numeric(19,4) NOT NULL, employee_health numeric(19,4) NOT NULL, income_tax numeric(19,4) NOT NULL, other_deductions numeric(19,4) NOT NULL,
  net_pay numeric(19,4) NOT NULL, employer_social numeric(19,4) NOT NULL, employer_health numeric(19,4) NOT NULL, employer_cost numeric(19,4) NOT NULL,
  CONSTRAINT payroll_result_amounts_check CHECK (gross_pay >= 0 AND employee_social >= 0 AND employee_health >= 0 AND income_tax >= 0 AND other_deductions >= 0 AND net_pay >= 0 AND employer_social >= 0 AND employer_health >= 0 AND employer_cost >= 0),
  CONSTRAINT payroll_result_arithmetic_check CHECK (net_pay = gross_pay - employee_social - employee_health - income_tax - other_deductions AND employer_cost = gross_pay + employer_social + employer_health),
  CONSTRAINT payroll_result_run_fkey FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT payroll_result_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT payroll_result_run_employee_key UNIQUE (payroll_run_id, employee_id)
);
CREATE INDEX payroll_result_run_idx ON app.payroll_result(organization_id, payroll_run_id);

CREATE OR REPLACE FUNCTION app.check_payroll_result_tenant_consistency()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.payroll_run r
    JOIN app.employee e ON e.id = NEW.employee_id AND e.organization_id = NEW.organization_id
    WHERE r.id = NEW.payroll_run_id AND r.organization_id = NEW.organization_id
      AND e.legal_entity_id = r.legal_entity_id
  ) THEN
    RAISE EXCEPTION 'Payroll result employee and run must belong to the same tenant entity'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_result_tenant_consistency_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_result_tenant_consistency_check
  BEFORE INSERT OR UPDATE ON app.payroll_result
  FOR EACH ROW EXECUTE FUNCTION app.check_payroll_result_tenant_consistency();

ALTER TABLE app.employee ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employee FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employment_relationship ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employment_relationship FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employee_document ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employee_document FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_run ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_run FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payroll_result ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payroll_result FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_select ON app.employee FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY employee_insert ON app.employee FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
CREATE POLICY employee_update ON app.employee FOR UPDATE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY employee_delete ON app.employee FOR DELETE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY employment_relationship_select ON app.employment_relationship FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY employment_relationship_insert ON app.employment_relationship FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
CREATE POLICY employment_relationship_update ON app.employment_relationship FOR UPDATE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY employment_relationship_delete ON app.employment_relationship FOR DELETE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY employee_document_select ON app.employee_document FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY employee_document_insert ON app.employee_document FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
CREATE POLICY employee_document_update ON app.employee_document FOR UPDATE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY employee_document_delete ON app.employee_document FOR DELETE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
CREATE POLICY payroll_run_select ON app.payroll_run FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY payroll_run_insert ON app.payroll_run FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
CREATE POLICY payroll_result_select ON app.payroll_result FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY payroll_result_insert ON app.payroll_result FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
GRANT SELECT, INSERT, UPDATE ON app.employee, app.employment_relationship, app.employee_document TO bap_api;
GRANT SELECT, INSERT ON app.payroll_run, app.payroll_result TO bap_api;
GRANT SELECT ON app.employee, app.employment_relationship, app.employee_document, app.payroll_run, app.payroll_result TO bap_reporting, bap_backup;
GRANT SELECT (created_by), UPDATE (created_by) ON app.employee, app.employment_relationship, app.employee_document, app.payroll_run TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE tombstone text;
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
    SELECT 1 FROM app.employee WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id;
  UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id;
  DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id;
  DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id;
  UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id;
  UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.organization WHERE slug IN ('employees', 'payroll')) THEN
    RAISE EXCEPTION 'Reserved organization slug is already in use'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_slug_reserved_check';
  END IF;
END;
$$;
ALTER TABLE auth.organization DROP CONSTRAINT organization_slug_reserved_check;
ALTER TABLE auth.organization ADD CONSTRAINT organization_slug_reserved_check CHECK (slug NOT IN ('access','api','datasets','design-system','health','invitation','metrics','ready','sign-in','sign-up','forgot-password','reset-password','activate','welcome','account','organizations','documents','employees','payroll'));
