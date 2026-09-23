-- Wave 1 keeps the Wave 0 relationship facts as read-only compatibility data.
ALTER TABLE app.employee DROP CONSTRAINT employee_status_check;
ALTER TABLE app.employee ALTER COLUMN status SET DEFAULT 'preboarding';
ALTER TABLE app.employee ADD CONSTRAINT employee_status_check
  CHECK (status IN ('preboarding', 'active', 'inactive', 'archived', 'cancelled'));
ALTER TABLE app.employment_relationship ADD CONSTRAINT employment_relationship_id_organization_key UNIQUE (id, organization_id);

CREATE TABLE app.hr_department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, parent_id uuid, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_department_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_department_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_department_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_department_parent_fkey FOREIGN KEY (parent_id, organization_id) REFERENCES app.hr_department(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_department_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_department_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_position (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_position_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_position_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_position_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_position_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_position_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_cost_centre (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_cost_centre_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_cost_centre_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_cost_centre_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_cost_centre_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_cost_centre_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_workplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, address_label varchar(300), active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_workplace_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_workplace_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_workplace_address_label_check CHECK (address_label IS NULL OR length(address_label) BETWEEN 1 AND 300),
  CONSTRAINT hr_workplace_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_workplace_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_workplace_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.employment_term (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, supersedes_employment_term_id uuid, effective_from date NOT NULL, effective_to date,
  position_id uuid, department_id uuid, cost_centre_id uuid, workplace_id uuid, manager_employee_id uuid,
  weekly_hours numeric(7,2) NOT NULL, working_time_pattern varchar(64) NOT NULL DEFAULT 'standard',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employment_term_version_check CHECK (version >= 1),
  CONSTRAINT employment_term_dates_check CHECK (effective_to IS NULL OR effective_from <= effective_to),
  CONSTRAINT employment_term_hours_check CHECK (weekly_hours > 0 AND weekly_hours <= 168),
  CONSTRAINT employment_term_working_time_pattern_check CHECK (length(working_time_pattern) BETWEEN 1 AND 64),
  CONSTRAINT employment_term_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employment_term_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employment_term_supersedes_fkey FOREIGN KEY (supersedes_employment_term_id, organization_id) REFERENCES app.employment_term(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_position_fkey FOREIGN KEY (position_id, organization_id) REFERENCES app.hr_position(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_department_fkey FOREIGN KEY (department_id, organization_id) REFERENCES app.hr_department(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_cost_centre_fkey FOREIGN KEY (cost_centre_id, organization_id) REFERENCES app.hr_cost_centre(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_workplace_fkey FOREIGN KEY (workplace_id, organization_id) REFERENCES app.hr_workplace(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_manager_employee_fkey FOREIGN KEY (manager_employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT employment_term_relationship_version_key UNIQUE (relationship_id, version),
  CONSTRAINT employment_term_id_organization_key UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX employment_term_supersedes_successor_key ON app.employment_term(supersedes_employment_term_id) WHERE supersedes_employment_term_id IS NOT NULL;
CREATE INDEX employment_term_relationship_effective_idx ON app.employment_term(organization_id, relationship_id, effective_from DESC, version DESC);

CREATE TABLE app.employee_status_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, employee_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, effective_at timestamptz NOT NULL, reason varchar(500),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_status_change_from_status_check CHECK (from_status IS NULL OR from_status IN ('preboarding', 'active', 'inactive', 'archived', 'cancelled')),
  CONSTRAINT employee_status_change_to_status_check CHECK (to_status IN ('preboarding', 'active', 'inactive', 'archived', 'cancelled')),
  CONSTRAINT employee_status_change_reason_check CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  CONSTRAINT employee_status_change_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT employee_status_change_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_document_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  code varchar(64) NOT NULL, name varchar(200) NOT NULL, confidentiality text NOT NULL, retention_key varchar(64) NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_document_category_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_document_category_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_document_category_confidentiality_check CHECK (confidentiality IN ('operational', 'payroll', 'restricted')),
  CONSTRAINT hr_document_category_retention_key_check CHECK (length(retention_key) BETWEEN 1 AND 64),
  CONSTRAINT hr_document_category_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_document_category_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_document_category_id_organization_key UNIQUE (id, organization_id)
);

ALTER TABLE app.employee_document ADD COLUMN category_id uuid;
ALTER TABLE app.employee_document ADD COLUMN relationship_id uuid;
ALTER TABLE app.employee_document ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required';
ALTER TABLE app.employee_document ADD COLUMN approved_by text;
ALTER TABLE app.employee_document ADD COLUMN approved_at timestamptz;
ALTER TABLE app.employee_document ADD COLUMN supersedes_document_id uuid;
ALTER TABLE app.employee_document ADD CONSTRAINT employee_document_category_fkey FOREIGN KEY (category_id, organization_id) REFERENCES app.hr_document_category(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE app.employee_document ADD CONSTRAINT employee_document_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE app.employee_document ADD CONSTRAINT employee_document_supersedes_fkey FOREIGN KEY (employee_id, supersedes_document_id) REFERENCES app.employee_document(employee_id, document_id) ON DELETE RESTRICT;
ALTER TABLE app.employee_document ADD CONSTRAINT employee_document_approval_status_check CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected'));
ALTER TABLE app.employee_document ADD CONSTRAINT employee_document_supersedes_not_self_check CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> document_id);
CREATE UNIQUE INDEX employee_document_supersedes_successor_key ON app.employee_document(employee_id, supersedes_document_id) WHERE supersedes_document_id IS NOT NULL;

CREATE TABLE app.hr_checklist_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  kind text NOT NULL, code varchar(64) NOT NULL, name varchar(200) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_checklist_template_kind_check CHECK (kind IN ('onboarding', 'change', 'offboarding')),
  CONSTRAINT hr_checklist_template_code_check CHECK (length(code) BETWEEN 1 AND 64),
  CONSTRAINT hr_checklist_template_name_check CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT hr_checklist_template_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_checklist_template_entity_code_key UNIQUE (legal_entity_id, code),
  CONSTRAINT hr_checklist_template_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_checklist_template_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, template_id uuid NOT NULL,
  position integer NOT NULL, title varchar(200) NOT NULL, default_due_offset_days integer NOT NULL,
  document_category_id uuid, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_checklist_template_item_position_check CHECK (position >= 1),
  CONSTRAINT hr_checklist_template_item_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT hr_checklist_template_item_default_due_offset_days_check CHECK (default_due_offset_days BETWEEN -3650 AND 3650),
  CONSTRAINT hr_checklist_template_item_template_fkey FOREIGN KEY (template_id, organization_id) REFERENCES app.hr_checklist_template(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_checklist_template_item_document_category_fkey FOREIGN KEY (document_category_id, organization_id) REFERENCES app.hr_document_category(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_template_item_template_position_key UNIQUE (template_id, position),
  CONSTRAINT hr_checklist_template_item_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL,
  employee_id uuid NOT NULL, relationship_id uuid, template_id uuid NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'open',
  started_on date NOT NULL, completed_at timestamptz,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_checklist_kind_check CHECK (kind IN ('onboarding', 'change', 'offboarding')),
  CONSTRAINT hr_checklist_status_check CHECK (status IN ('open', 'completed', 'cancelled')),
  CONSTRAINT hr_checklist_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_checklist_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_checklist_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_template_fkey FOREIGN KEY (template_id, organization_id) REFERENCES app.hr_checklist_template(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_id_organization_key UNIQUE (id, organization_id)
);

CREATE TABLE app.hr_checklist_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, checklist_id uuid NOT NULL,
  template_item_id uuid, title varchar(200) NOT NULL, owner_user_id text NOT NULL, due_on date NOT NULL, document_category_id uuid, status text NOT NULL DEFAULT 'pending',
  skip_reason varchar(500), document_id uuid, completed_by text, completed_at timestamptz,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_checklist_task_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT hr_checklist_task_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  CONSTRAINT hr_checklist_task_skip_reason_check CHECK (skip_reason IS NULL OR length(skip_reason) BETWEEN 1 AND 500),
  CONSTRAINT hr_checklist_task_checklist_fkey FOREIGN KEY (checklist_id, organization_id) REFERENCES app.hr_checklist(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT hr_checklist_task_template_item_fkey FOREIGN KEY (template_item_id, organization_id) REFERENCES app.hr_checklist_template_item(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_task_document_category_fkey FOREIGN KEY (document_category_id, organization_id) REFERENCES app.hr_document_category(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_task_document_fkey FOREIGN KEY (document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT hr_checklist_task_id_organization_key UNIQUE (id, organization_id)
);
CREATE INDEX hr_checklist_task_owner_status_due_idx ON app.hr_checklist_task(organization_id, owner_user_id, status, due_on, id);

CREATE OR REPLACE FUNCTION app.check_hr_entity_pinning()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE employee_entity uuid; relationship_employee uuid; relationship_entity uuid; reference_entity uuid;
BEGIN
  IF TG_TABLE_NAME = 'hr_department' THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT legal_entity_id INTO reference_entity FROM app.hr_department WHERE id = NEW.parent_id AND organization_id = NEW.organization_id;
      IF reference_entity <> NEW.legal_entity_id THEN RAISE EXCEPTION 'Department parent must belong to the same legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_department_entity_pinning_check'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'employment_term' THEN
    SELECT legal_entity_id INTO employee_entity FROM app.employee WHERE id = NEW.employee_id AND organization_id = NEW.organization_id;
    SELECT employee_id INTO relationship_employee FROM app.employment_relationship WHERE id = NEW.relationship_id AND organization_id = NEW.organization_id;
    IF relationship_employee <> NEW.employee_id THEN RAISE EXCEPTION 'Employment term relationship must belong to its employee' USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_term_entity_pinning_check'; END IF;
    FOREACH reference_entity IN ARRAY ARRAY[
      (SELECT legal_entity_id FROM app.hr_position WHERE id = NEW.position_id AND organization_id = NEW.organization_id),
      (SELECT legal_entity_id FROM app.hr_department WHERE id = NEW.department_id AND organization_id = NEW.organization_id),
      (SELECT legal_entity_id FROM app.hr_cost_centre WHERE id = NEW.cost_centre_id AND organization_id = NEW.organization_id),
      (SELECT legal_entity_id FROM app.hr_workplace WHERE id = NEW.workplace_id AND organization_id = NEW.organization_id),
      (SELECT legal_entity_id FROM app.employee WHERE id = NEW.manager_employee_id AND organization_id = NEW.organization_id)
    ] LOOP
      IF reference_entity IS NOT NULL AND reference_entity <> employee_entity THEN RAISE EXCEPTION 'Employment term reference must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_term_entity_pinning_check'; END IF;
    END LOOP;
    IF NEW.supersedes_employment_term_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM app.employment_term superseded
      WHERE superseded.id = NEW.supersedes_employment_term_id
        AND superseded.organization_id = NEW.organization_id
        AND superseded.relationship_id = NEW.relationship_id
        AND superseded.version < NEW.version
    ) THEN RAISE EXCEPTION 'Employment term must supersede an earlier term of the same relationship' USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_term_supersedes_check'; END IF;
  ELSIF TG_TABLE_NAME = 'employee_document' THEN
    SELECT legal_entity_id INTO employee_entity FROM app.employee WHERE id = NEW.employee_id AND organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.hr_document_category WHERE id = NEW.category_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> employee_entity THEN RAISE EXCEPTION 'Document category must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_entity_pinning_check'; END IF;
    SELECT employee_id INTO relationship_employee FROM app.employment_relationship WHERE id = NEW.relationship_id AND organization_id = NEW.organization_id;
    IF relationship_employee IS NOT NULL AND relationship_employee <> NEW.employee_id THEN RAISE EXCEPTION 'Document relationship must belong to its employee' USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_entity_pinning_check'; END IF;
    SELECT legal_entity_id INTO reference_entity FROM app.document WHERE id = NEW.document_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> employee_entity THEN RAISE EXCEPTION 'Document must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'hr_checklist_template_item' THEN
    SELECT template.legal_entity_id INTO relationship_entity FROM app.hr_checklist_template template WHERE template.id = NEW.template_id AND template.organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.hr_document_category WHERE id = NEW.document_category_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> relationship_entity THEN RAISE EXCEPTION 'Template item category must belong to the template legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_checklist_template_item_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'hr_checklist' THEN
    SELECT legal_entity_id INTO employee_entity FROM app.employee WHERE id = NEW.employee_id AND organization_id = NEW.organization_id;
    SELECT legal_entity_id INTO reference_entity FROM app.hr_checklist_template WHERE id = NEW.template_id AND organization_id = NEW.organization_id;
    SELECT employee_id INTO relationship_employee FROM app.employment_relationship WHERE id = NEW.relationship_id AND organization_id = NEW.organization_id;
    IF employee_entity <> NEW.legal_entity_id OR reference_entity <> NEW.legal_entity_id OR (relationship_employee IS NOT NULL AND relationship_employee <> NEW.employee_id) THEN RAISE EXCEPTION 'Checklist references must belong to its employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_checklist_entity_pinning_check'; END IF;
  ELSIF TG_TABLE_NAME = 'hr_checklist_task' THEN
    SELECT checklist.template_id, checklist.legal_entity_id INTO relationship_entity, employee_entity FROM app.hr_checklist checklist WHERE checklist.id = NEW.checklist_id AND checklist.organization_id = NEW.organization_id;
    SELECT template_id INTO reference_entity FROM app.hr_checklist_template_item WHERE id = NEW.template_item_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> relationship_entity THEN RAISE EXCEPTION 'Checklist task item must belong to the checklist template' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_checklist_task_entity_pinning_check'; END IF;
    SELECT legal_entity_id INTO reference_entity FROM app.hr_document_category WHERE id = NEW.document_category_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> employee_entity THEN RAISE EXCEPTION 'Checklist task category must belong to the checklist legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_checklist_task_entity_pinning_check'; END IF;
    SELECT legal_entity_id INTO reference_entity FROM app.document WHERE id = NEW.document_id AND organization_id = NEW.organization_id;
    IF reference_entity IS NOT NULL AND reference_entity <> employee_entity THEN RAISE EXCEPTION 'Checklist task document must belong to the checklist legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_checklist_task_entity_pinning_check'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_department_entity_pinning_check BEFORE INSERT OR UPDATE ON app.hr_department FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();
CREATE TRIGGER employment_term_entity_pinning_check BEFORE INSERT OR UPDATE ON app.employment_term FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();
CREATE TRIGGER employee_document_entity_pinning_check BEFORE INSERT OR UPDATE ON app.employee_document FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();
CREATE OR REPLACE FUNCTION app.check_employee_document_supersession()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.supersedes_document_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.supersedes_document_id = NEW.document_id THEN
    RAISE EXCEPTION 'Document cannot supersede itself'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_supersedes_not_self_check';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.employee_document predecessor
    WHERE predecessor.employee_id = NEW.employee_id
      AND predecessor.document_id = NEW.supersedes_document_id
      AND predecessor.category_id IS NOT DISTINCT FROM NEW.category_id
  ) THEN
    RAISE EXCEPTION 'Document predecessor must belong to the same employee and category'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_supersedes_check';
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(document_id) AS (
      SELECT NEW.supersedes_document_id
      UNION ALL
      SELECT link.supersedes_document_id FROM app.employee_document link JOIN chain ON link.document_id = chain.document_id
      WHERE link.employee_id = NEW.employee_id AND link.supersedes_document_id IS NOT NULL
    ) SELECT 1 FROM chain WHERE document_id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'Document supersession cannot form a cycle'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_document_supersedes_cycle_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_document_supersession_check BEFORE INSERT OR UPDATE OF category_id, supersedes_document_id ON app.employee_document FOR EACH ROW EXECUTE FUNCTION app.check_employee_document_supersession();
CREATE TRIGGER hr_checklist_template_item_entity_pinning_check BEFORE INSERT OR UPDATE ON app.hr_checklist_template_item FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();
CREATE TRIGGER hr_checklist_entity_pinning_check BEFORE INSERT OR UPDATE ON app.hr_checklist FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();
CREATE TRIGGER hr_checklist_task_entity_pinning_check BEFORE INSERT OR UPDATE OF checklist_id, template_item_id, document_id ON app.hr_checklist_task FOR EACH ROW EXECUTE FUNCTION app.check_hr_entity_pinning();

-- Legacy text becomes a stable reference record, preserving every value without using it as a future code.
ALTER TABLE app.employee NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employment_relationship NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.hr_position (organization_id, legal_entity_id, code, name, created_by)
SELECT relationship.organization_id, employee.legal_entity_id, 'legacy-' || md5(relationship.position), relationship.position, min(relationship.created_by)
FROM app.employment_relationship relationship JOIN app.employee employee ON employee.id = relationship.employee_id AND employee.organization_id = relationship.organization_id
GROUP BY relationship.organization_id, employee.legal_entity_id, relationship.position;
INSERT INTO app.hr_department (organization_id, legal_entity_id, code, name, created_by)
SELECT relationship.organization_id, employee.legal_entity_id, 'legacy-' || md5(relationship.department), relationship.department, min(relationship.created_by)
FROM app.employment_relationship relationship JOIN app.employee employee ON employee.id = relationship.employee_id AND employee.organization_id = relationship.organization_id WHERE relationship.department IS NOT NULL
GROUP BY relationship.organization_id, employee.legal_entity_id, relationship.department;
INSERT INTO app.hr_cost_centre (organization_id, legal_entity_id, code, name, created_by)
SELECT relationship.organization_id, employee.legal_entity_id, 'legacy-' || md5(relationship.cost_centre), relationship.cost_centre, min(relationship.created_by)
FROM app.employment_relationship relationship JOIN app.employee employee ON employee.id = relationship.employee_id AND employee.organization_id = relationship.organization_id WHERE relationship.cost_centre IS NOT NULL
GROUP BY relationship.organization_id, employee.legal_entity_id, relationship.cost_centre;
INSERT INTO app.employment_term (organization_id, employee_id, relationship_id, version, effective_from, effective_to, position_id, department_id, cost_centre_id, weekly_hours, working_time_pattern, created_by)
SELECT relationship.organization_id, relationship.employee_id, relationship.id, 1, relationship.start_date, relationship.end_date,
  position.id, department.id, cost_centre.id, relationship.weekly_hours, 'standard', relationship.created_by
FROM app.employment_relationship relationship
JOIN app.employee employee ON employee.id = relationship.employee_id AND employee.organization_id = relationship.organization_id
JOIN app.hr_position position ON position.organization_id = relationship.organization_id AND position.legal_entity_id = employee.legal_entity_id AND position.code = 'legacy-' || md5(relationship.position)
LEFT JOIN app.hr_department department ON department.organization_id = relationship.organization_id AND department.legal_entity_id = employee.legal_entity_id AND department.code = 'legacy-' || md5(relationship.department)
LEFT JOIN app.hr_cost_centre cost_centre ON cost_centre.organization_id = relationship.organization_id AND cost_centre.legal_entity_id = employee.legal_entity_id AND cost_centre.code = 'legacy-' || md5(relationship.cost_centre);
ALTER TABLE app.employee FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employment_relationship FORCE ROW LEVEL SECURITY;

ALTER TABLE app.hr_department ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_department FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_position ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_position FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_cost_centre ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_cost_centre FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_workplace ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_workplace FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employment_term ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employment_term FORCE ROW LEVEL SECURITY;
ALTER TABLE app.employee_status_change ENABLE ROW LEVEL SECURITY; ALTER TABLE app.employee_status_change FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_document_category ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_document_category FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_checklist_template ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_checklist_template FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_checklist_template_item ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_checklist_template_item FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_checklist ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_checklist FORCE ROW LEVEL SECURITY;
ALTER TABLE app.hr_checklist_task ENABLE ROW LEVEL SECURITY; ALTER TABLE app.hr_checklist_task FORCE ROW LEVEL SECURITY;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['hr_department','hr_position','hr_cost_centre','hr_workplace','employment_term','employee_status_change','hr_document_category','hr_checklist_template','hr_checklist_template_item','hr_checklist','hr_checklist_task'] LOOP
    EXECUTE format('CREATE POLICY %I_select ON app.%I FOR SELECT USING (organization_id = current_setting(''bap.organization_id'', true))', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_insert ON app.%I FOR INSERT WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND created_by = current_setting(''bap.user_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_update ON app.%I FOR UPDATE USING (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_delete ON app.%I FOR DELETE USING (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO bap_api', table_name);
    EXECUTE format('GRANT SELECT ON app.%I TO bap_reporting, bap_backup', table_name);
    EXECUTE format('GRANT SELECT (created_by), UPDATE (created_by) ON app.%I TO bap_eraser', table_name);
  END LOOP;
END $$;
DROP POLICY employment_term_update ON app.employment_term;
DROP POLICY employment_term_delete ON app.employment_term;
DROP POLICY employee_status_change_update ON app.employee_status_change;
DROP POLICY employee_status_change_delete ON app.employee_status_change;
DROP POLICY employment_relationship_update ON app.employment_relationship;
DROP POLICY employment_relationship_delete ON app.employment_relationship;
REVOKE UPDATE ON app.employment_relationship, app.employment_term, app.employee_status_change FROM bap_api;
GRANT SELECT (approved_by), UPDATE (approved_by) ON app.employee_document TO bap_eraser;
GRANT SELECT (completed_by), UPDATE (completed_by) ON app.hr_checklist_task TO bap_eraser;
GRANT SELECT (owner_user_id), UPDATE (owner_user_id) ON app.hr_checklist_task TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN RAISE EXCEPTION 'User erasure requires an explicit subject'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id UNION ALL SELECT 1 FROM app.dataset WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.member_entity_scope WHERE user_id = subject_user_id OR updated_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity_access WHERE user_id = subject_user_id OR created_by = subject_user_id UNION ALL SELECT 1 FROM app.document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.partner WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.document_link WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id
  ) THEN RETURN NULL; END IF;
  tombstone := 'erased_' || gen_random_uuid()::text;
  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id; DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id; DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id; UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id; UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id; UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.organization WHERE slug = 'hr-settings') THEN RAISE EXCEPTION 'Reserved organization slug is already in use' USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_slug_reserved_check'; END IF;
END $$;
ALTER TABLE auth.organization DROP CONSTRAINT organization_slug_reserved_check;
ALTER TABLE auth.organization ADD CONSTRAINT organization_slug_reserved_check CHECK (slug NOT IN ('access','api','datasets','design-system','health','invitation','metrics','ready','sign-in','sign-up','forgot-password','reset-password','activate','welcome','account','organizations','documents','employees','payroll','hr-settings'));
