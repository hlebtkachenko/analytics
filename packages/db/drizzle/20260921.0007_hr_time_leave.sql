DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.organization WHERE slug = 'time') THEN RAISE EXCEPTION 'Reserved organization slug is already in use' USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_slug_reserved_check'; END IF;
END $$;
ALTER TABLE auth.organization DROP CONSTRAINT organization_slug_reserved_check;
ALTER TABLE auth.organization ADD CONSTRAINT organization_slug_reserved_check CHECK (slug NOT IN ('access','api','datasets','design-system','health','invitation','metrics','ready','sign-in','sign-up','forgot-password','reset-password','activate','welcome','account','organizations','documents','employees','payroll','hr-settings','time'));

CREATE TABLE app.work_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, period_start date NOT NULL, period_end date NOT NULL, status text NOT NULL DEFAULT 'draft',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_schedule_version_check CHECK (version >= 1),
  CONSTRAINT work_schedule_dates_check CHECK (period_start <= period_end),
  CONSTRAINT work_schedule_status_check CHECK (status IN ('draft', 'published', 'superseded')),
  CONSTRAINT work_schedule_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_schedule_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_schedule_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_schedule_relationship_period_version_key UNIQUE (relationship_id, period_start, version),
  CONSTRAINT work_schedule_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.work_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, schedule_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, break_minutes integer NOT NULL DEFAULT 0, kind text NOT NULL DEFAULT 'regular',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_shift_range_check CHECK (starts_at < ends_at),
  CONSTRAINT work_shift_break_minutes_check CHECK (break_minutes >= 0 AND break_minutes * 60 < extract(epoch FROM ends_at - starts_at)),
  CONSTRAINT work_shift_kind_check CHECK (kind IN ('regular', 'on_call')),
  CONSTRAINT work_shift_schedule_fkey FOREIGN KEY (schedule_id, organization_id) REFERENCES app.work_schedule(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT work_shift_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.timesheet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, version integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz, approved_by text, approved_at timestamptz, rejection_reason varchar(500), supersedes_timesheet_id uuid,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_dates_check CHECK (period_start <= period_end),
  CONSTRAINT timesheet_version_check CHECK (version >= 1),
  CONSTRAINT timesheet_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'corrected')),
  CONSTRAINT timesheet_submission_check CHECK ((status IN ('submitted', 'approved', 'corrected')) = (submitted_at IS NOT NULL)),
  CONSTRAINT timesheet_approval_check CHECK ((status IN ('approved', 'corrected')) = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT timesheet_rejection_reason_check CHECK (rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 500),
  CONSTRAINT timesheet_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT timesheet_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT timesheet_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT timesheet_supersedes_fkey FOREIGN KEY (supersedes_timesheet_id, organization_id) REFERENCES app.timesheet(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT timesheet_supersedes_not_self_check CHECK (supersedes_timesheet_id IS NULL OR supersedes_timesheet_id <> id),
  CONSTRAINT timesheet_relationship_period_version_key UNIQUE (relationship_id, period_start, version),
  CONSTRAINT timesheet_id_organization_key UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX timesheet_supersedes_successor_key ON app.timesheet(supersedes_timesheet_id) WHERE supersedes_timesheet_id IS NOT NULL;
CREATE TABLE app.time_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, timesheet_id uuid NOT NULL, work_date date NOT NULL,
  started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL, break_minutes integer NOT NULL DEFAULT 0, overtime_minutes integer NOT NULL DEFAULT 0, night_minutes integer NOT NULL DEFAULT 0, holiday_minutes integer NOT NULL DEFAULT 0, standby_minutes integer NOT NULL DEFAULT 0, activity_code varchar(64),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entry_range_check CHECK (started_at < ended_at),
  CONSTRAINT time_entry_break_minutes_check CHECK (break_minutes >= 0 AND break_minutes * 60 < extract(epoch FROM ended_at - started_at)),
  CONSTRAINT time_entry_overtime_minutes_check CHECK (overtime_minutes >= 0),
  CONSTRAINT time_entry_night_minutes_check CHECK (night_minutes >= 0),
  CONSTRAINT time_entry_holiday_minutes_check CHECK (holiday_minutes >= 0),
  CONSTRAINT time_entry_standby_minutes_check CHECK (standby_minutes >= 0),
  CONSTRAINT time_entry_activity_code_check CHECK (activity_code IS NULL OR length(activity_code) BETWEEN 1 AND 64),
  CONSTRAINT time_entry_timesheet_fkey FOREIGN KEY (timesheet_id, organization_id) REFERENCES app.timesheet(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT time_entry_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.leave_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, code varchar(64) NOT NULL, name varchar(200) NOT NULL, unit text NOT NULL, paid boolean NOT NULL, active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_type_code_check CHECK (length(code) BETWEEN 1 AND 64), CONSTRAINT leave_type_name_check CHECK (length(name) BETWEEN 1 AND 200), CONSTRAINT leave_type_unit_check CHECK (unit IN ('hours', 'days')),
  CONSTRAINT leave_type_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_type_entity_code_key UNIQUE (legal_entity_id, code), CONSTRAINT leave_type_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.leave_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL, leave_type_id uuid NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, requested_amount numeric(7,2) NOT NULL, status text NOT NULL DEFAULT 'requested', decided_by text, decided_at timestamptz, reason varchar(500),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_request_dates_check CHECK (starts_on <= ends_on), CONSTRAINT leave_request_amount_check CHECK (requested_amount > 0),
  CONSTRAINT leave_request_status_check CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'taken')),
  CONSTRAINT leave_request_decision_check CHECK ((status IN ('approved', 'rejected', 'cancelled', 'taken')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT leave_request_reason_check CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  CONSTRAINT leave_request_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_request_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_request_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_request_type_fkey FOREIGN KEY (leave_type_id, organization_id) REFERENCES app.leave_type(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leave_request_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.leave_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL, leave_type_id uuid NOT NULL,
  effective_on date NOT NULL, amount numeric(7,2) NOT NULL, source text NOT NULL, source_id uuid,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_ledger_amount_check CHECK (amount <> 0), CONSTRAINT leave_ledger_source_check CHECK (source IN ('opening', 'entitlement', 'request', 'correction', 'expiry')),
  CONSTRAINT leave_ledger_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_ledger_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_ledger_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT leave_ledger_type_fkey FOREIGN KEY (leave_type_id, organization_id) REFERENCES app.leave_type(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leave_ledger_id_organization_key UNIQUE (id, organization_id)
);
CREATE TABLE app.absence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, legal_entity_id uuid NOT NULL, employee_id uuid NOT NULL, relationship_id uuid NOT NULL,
  kind text NOT NULL, starts_on date NOT NULL, ends_on date, payroll_code varchar(64) NOT NULL, document_id uuid,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT absence_kind_check CHECK (kind IN ('sickness', 'care', 'parental', 'unpaid', 'other')), CONSTRAINT absence_dates_check CHECK (ends_on IS NULL OR starts_on <= ends_on), CONSTRAINT absence_payroll_code_check CHECK (length(payroll_code) BETWEEN 1 AND 64),
  CONSTRAINT absence_entity_fkey FOREIGN KEY (legal_entity_id, organization_id) REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT absence_employee_fkey FOREIGN KEY (employee_id, organization_id) REFERENCES app.employee(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT absence_relationship_fkey FOREIGN KEY (relationship_id, organization_id) REFERENCES app.employment_relationship(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT absence_document_fkey FOREIGN KEY (document_id, organization_id) REFERENCES app.document(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT absence_id_organization_key UNIQUE (id, organization_id)
);

CREATE INDEX work_schedule_entity_employee_period_idx ON app.work_schedule(organization_id, legal_entity_id, employee_id, period_start DESC, version DESC);
CREATE INDEX work_shift_schedule_starts_idx ON app.work_shift(organization_id, schedule_id, starts_at);
CREATE INDEX timesheet_entity_employee_period_idx ON app.timesheet(organization_id, legal_entity_id, employee_id, period_start DESC, version DESC);
CREATE INDEX timesheet_entity_period_status_idx ON app.timesheet(organization_id, legal_entity_id, period_start DESC, status, id);
CREATE INDEX time_entry_timesheet_work_date_idx ON app.time_entry(organization_id, timesheet_id, work_date, started_at);
CREATE INDEX leave_type_entity_active_idx ON app.leave_type(organization_id, legal_entity_id, active, code);
CREATE INDEX leave_request_entity_employee_status_idx ON app.leave_request(organization_id, legal_entity_id, employee_id, status, starts_on);
CREATE INDEX leave_request_entity_status_starts_idx ON app.leave_request(organization_id, legal_entity_id, status, starts_on, id);
CREATE INDEX leave_ledger_entity_employee_effective_idx ON app.leave_ledger(organization_id, legal_entity_id, employee_id, leave_type_id, effective_on, created_at);
CREATE INDEX absence_entity_employee_starts_idx ON app.absence(organization_id, legal_entity_id, employee_id, starts_on DESC);

CREATE OR REPLACE FUNCTION app.check_time_leave_entity_pinning() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE employee_entity uuid; relationship_employee uuid; reference_entity uuid; parent_status text; period_begin date; period_finish date;
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'bap_eraser' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('work_schedule', 'timesheet', 'leave_request', 'leave_ledger', 'absence') THEN
    SELECT legal_entity_id INTO employee_entity FROM app.employee WHERE id = NEW.employee_id AND organization_id = NEW.organization_id;
    SELECT employee_id INTO relationship_employee FROM app.employment_relationship WHERE id = NEW.relationship_id AND organization_id = NEW.organization_id;
    IF employee_entity <> NEW.legal_entity_id OR relationship_employee <> NEW.employee_id THEN RAISE EXCEPTION 'Time and leave references must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_entity_pinning_check'; END IF;
    IF TG_TABLE_NAME IN ('leave_request', 'leave_ledger') THEN SELECT legal_entity_id INTO reference_entity FROM app.leave_type WHERE id = (to_jsonb(NEW)->>'leave_type_id')::uuid AND organization_id = NEW.organization_id; IF reference_entity <> NEW.legal_entity_id THEN RAISE EXCEPTION 'Leave type must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_entity_pinning_check'; END IF; END IF;
    IF TG_TABLE_NAME = 'absence' AND (to_jsonb(NEW)->>'document_id') IS NOT NULL THEN SELECT legal_entity_id INTO reference_entity FROM app.document WHERE id = (to_jsonb(NEW)->>'document_id')::uuid AND organization_id = NEW.organization_id; IF reference_entity IS DISTINCT FROM NEW.legal_entity_id THEN RAISE EXCEPTION 'Absence document must belong to the employee legal entity' USING ERRCODE = 'check_violation', CONSTRAINT = 'absence_entity_pinning_check'; END IF; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_schedule_entity_pinning_check BEFORE INSERT OR UPDATE ON app.work_schedule FOR EACH ROW EXECUTE FUNCTION app.check_time_leave_entity_pinning();
CREATE TRIGGER timesheet_entity_pinning_check BEFORE INSERT OR UPDATE ON app.timesheet FOR EACH ROW EXECUTE FUNCTION app.check_time_leave_entity_pinning();
CREATE TRIGGER leave_request_entity_pinning_check BEFORE INSERT OR UPDATE ON app.leave_request FOR EACH ROW EXECUTE FUNCTION app.check_time_leave_entity_pinning();
CREATE TRIGGER leave_ledger_entity_pinning_check BEFORE INSERT OR UPDATE ON app.leave_ledger FOR EACH ROW EXECUTE FUNCTION app.check_time_leave_entity_pinning();
CREATE TRIGGER absence_entity_pinning_check BEFORE INSERT OR UPDATE ON app.absence FOR EACH ROW EXECUTE FUNCTION app.check_time_leave_entity_pinning();

CREATE FUNCTION app.check_work_shift_entity_pinning() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'bap_eraser' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.work_schedule WHERE id = NEW.schedule_id AND organization_id = NEW.organization_id) THEN RAISE EXCEPTION 'Shift schedule must be in the organization' USING ERRCODE = 'check_violation', CONSTRAINT = 'work_shift_entity_pinning_check'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_shift_entity_pinning_check BEFORE INSERT OR UPDATE ON app.work_shift FOR EACH ROW EXECUTE FUNCTION app.check_work_shift_entity_pinning();

CREATE FUNCTION app.check_time_entry_constraints() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE parent_status text; period_begin date; period_finish date;
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'bap_eraser' THEN RETURN NEW; END IF;
  SELECT status, period_start, period_end INTO parent_status, period_begin, period_finish FROM app.timesheet WHERE id = NEW.timesheet_id AND organization_id = NEW.organization_id;
  IF parent_status <> 'draft' THEN RAISE EXCEPTION 'Time entries require a draft timesheet' USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entry_timesheet_status_check'; END IF;
  IF NEW.work_date < period_begin OR NEW.work_date > period_finish THEN RAISE EXCEPTION 'Time entry work date must lie within its timesheet period' USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entry_work_date_check'; END IF;
  IF EXISTS (SELECT 1 FROM app.time_entry e WHERE e.organization_id = NEW.organization_id AND e.timesheet_id = NEW.timesheet_id AND e.id <> NEW.id AND tstzrange(e.started_at, e.ended_at, '[)') && tstzrange(NEW.started_at, NEW.ended_at, '[)')) THEN RAISE EXCEPTION 'Time entries cannot overlap' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'time_entry_overlap_check'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER time_entry_entity_pinning_check BEFORE INSERT OR UPDATE ON app.time_entry FOR EACH ROW EXECUTE FUNCTION app.check_time_entry_constraints();

CREATE FUNCTION app.check_time_entry_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE parent_status text;
BEGIN
  IF current_user = 'bap_eraser' THEN RETURN OLD; END IF;
  SELECT status INTO parent_status FROM app.timesheet WHERE id = OLD.timesheet_id AND organization_id = OLD.organization_id;
  IF parent_status <> 'draft' THEN RAISE EXCEPTION 'Time entries can only be deleted from a draft timesheet' USING ERRCODE = 'check_violation', CONSTRAINT = 'time_entry_timesheet_status_check'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER time_entry_delete_check BEFORE DELETE ON app.time_entry FOR EACH ROW EXECUTE FUNCTION app.check_time_entry_delete();

CREATE OR REPLACE FUNCTION app.enforce_timesheet_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_user = 'bap_eraser' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.legal_entity_id IS NOT DISTINCT FROM OLD.legal_entity_id AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id AND NEW.relationship_id IS NOT DISTINCT FROM OLD.relationship_id AND NEW.period_start IS NOT DISTINCT FROM OLD.period_start AND NEW.period_end IS NOT DISTINCT FROM OLD.period_end AND NEW.version IS NOT DISTINCT FROM OLD.version AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason AND NEW.supersedes_timesheet_id IS NOT DISTINCT FROM OLD.supersedes_timesheet_id AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NULL;
    ELSIF OLD.status = 'draft' AND NEW.status = 'submitted' THEN NULL;
    ELSIF OLD.status = 'submitted' AND NEW.status = 'draft' AND NEW.rejection_reason IS NOT NULL THEN NULL;
    ELSIF OLD.status = 'submitted' AND NEW.status = 'approved' THEN NULL;
    ELSIF OLD.status = 'approved' AND NEW.status = 'corrected' AND NEW.period_start = OLD.period_start AND NEW.period_end = OLD.period_end AND NEW.version = OLD.version AND NEW.organization_id = OLD.organization_id AND NEW.legal_entity_id = OLD.legal_entity_id AND NEW.employee_id = OLD.employee_id AND NEW.relationship_id = OLD.relationship_id AND NEW.submitted_at = OLD.submitted_at AND NEW.approved_by = OLD.approved_by AND NEW.approved_at = OLD.approved_at AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason AND NEW.created_by = OLD.created_by AND NEW.created_at = OLD.created_at THEN NULL;
    ELSIF OLD.status IN ('approved', 'corrected') THEN RAISE EXCEPTION 'Approved and corrected timesheets are immutable' USING ERRCODE = 'check_violation', CONSTRAINT = 'timesheet_immutable_check';
    ELSE RAISE EXCEPTION 'Invalid timesheet state transition' USING ERRCODE = 'check_violation', CONSTRAINT = 'timesheet_transition_check'; END IF;
  END IF;
  IF NEW.supersedes_timesheet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.timesheet predecessor WHERE predecessor.id = NEW.supersedes_timesheet_id AND predecessor.organization_id = NEW.organization_id AND predecessor.relationship_id = NEW.relationship_id AND predecessor.period_start = NEW.period_start AND predecessor.version < NEW.version AND predecessor.status = 'corrected') THEN RAISE EXCEPTION 'Timesheet correction must supersede a corrected earlier version' USING ERRCODE = 'check_violation', CONSTRAINT = 'timesheet_supersedes_check'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER timesheet_transition_check BEFORE INSERT OR UPDATE ON app.timesheet FOR EACH ROW EXECUTE FUNCTION app.enforce_timesheet_transition();

CREATE FUNCTION app.enforce_leave_request_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_user = 'bap_eraser' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.legal_entity_id IS NOT DISTINCT FROM OLD.legal_entity_id AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id AND NEW.relationship_id IS NOT DISTINCT FROM OLD.relationship_id AND NEW.leave_type_id IS NOT DISTINCT FROM OLD.leave_type_id AND NEW.starts_on IS NOT DISTINCT FROM OLD.starts_on AND NEW.ends_on IS NOT DISTINCT FROM OLD.ends_on AND NEW.requested_amount IS NOT DISTINCT FROM OLD.requested_amount AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at AND NEW.reason IS NOT DISTINCT FROM OLD.reason AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NULL;
    ELSIF OLD.status = 'requested' AND NEW.status IN ('approved', 'rejected', 'cancelled') THEN NULL;
    ELSIF OLD.status = 'approved' AND NEW.status IN ('taken', 'cancelled') THEN NULL;
    ELSIF OLD.status IN ('taken', 'rejected', 'cancelled') THEN RAISE EXCEPTION 'Terminal leave requests are immutable' USING ERRCODE = 'check_violation', CONSTRAINT = 'leave_request_transition_check';
    ELSE RAISE EXCEPTION 'Invalid leave request state transition' USING ERRCODE = 'check_violation', CONSTRAINT = 'leave_request_transition_check'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leave_request_transition_check BEFORE INSERT OR UPDATE ON app.leave_request FOR EACH ROW EXECUTE FUNCTION app.enforce_leave_request_transition();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['work_schedule','work_shift','timesheet','time_entry','leave_type','leave_request','absence'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I_select ON app.%I FOR SELECT USING (organization_id = current_setting(''bap.organization_id'', true))', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_insert ON app.%I FOR INSERT WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND created_by = current_setting(''bap.user_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_update ON app.%I FOR UPDATE USING (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write()) WITH CHECK (organization_id = current_setting(''bap.organization_id'', true) AND app.role_can_write())', table_name, table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO bap_api', table_name); EXECUTE format('GRANT SELECT ON app.%I TO bap_reporting, bap_backup', table_name); EXECUTE format('GRANT SELECT (created_by), UPDATE (created_by) ON app.%I TO bap_eraser', table_name);
  END LOOP;
END $$;
CREATE POLICY time_entry_delete ON app.time_entry FOR DELETE USING (organization_id = current_setting('bap.organization_id', true) AND app.role_can_write());
GRANT DELETE ON app.time_entry TO bap_api;
ALTER TABLE app.leave_ledger ENABLE ROW LEVEL SECURITY; ALTER TABLE app.leave_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY leave_ledger_select ON app.leave_ledger FOR SELECT USING (organization_id = current_setting('bap.organization_id', true));
CREATE POLICY leave_ledger_insert ON app.leave_ledger FOR INSERT WITH CHECK (organization_id = current_setting('bap.organization_id', true) AND created_by = current_setting('bap.user_id', true) AND app.role_can_write());
GRANT SELECT, INSERT ON app.leave_ledger TO bap_api; GRANT SELECT ON app.leave_ledger TO bap_reporting, bap_backup; GRANT SELECT (created_by), UPDATE (created_by) ON app.leave_ledger TO bap_eraser;
GRANT SELECT (approved_by), UPDATE (approved_by) ON app.timesheet TO bap_eraser;
GRANT SELECT (decided_by), UPDATE (decided_by) ON app.leave_request TO bap_eraser;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN RAISE EXCEPTION 'User erasure requires an explicit subject'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id UNION ALL SELECT 1 FROM app.dataset WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.member_entity_scope WHERE user_id = subject_user_id OR updated_by = subject_user_id UNION ALL SELECT 1 FROM app.legal_entity_access WHERE user_id = subject_user_id OR created_by = subject_user_id UNION ALL SELECT 1 FROM app.document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.partner WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.document_link WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id OR approved_by = subject_user_id OR finalized_by = subject_user_id OR paid_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id UNION ALL SELECT 1 FROM app.hr_access_assignment WHERE created_by = subject_user_id OR user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_component_definition WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.employee_compensation_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_component WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_liability WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_approval WHERE created_by = subject_user_id OR actor_user_id = subject_user_id UNION ALL SELECT 1 FROM app.payroll_account_mapping WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_result_document WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_import WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.payroll_command_receipt WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.work_schedule WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.work_shift WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.timesheet WHERE created_by = subject_user_id OR approved_by = subject_user_id UNION ALL SELECT 1 FROM app.time_entry WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_type WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_request WHERE created_by = subject_user_id OR decided_by = subject_user_id UNION ALL SELECT 1 FROM app.leave_ledger WHERE created_by = subject_user_id UNION ALL SELECT 1 FROM app.absence WHERE created_by = subject_user_id
  ) THEN RETURN NULL; END IF;
  tombstone := 'erased_' || gen_random_uuid()::text;
  UPDATE app.audit_log SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.dataset SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.legal_entity SET created_by = tombstone WHERE created_by = subject_user_id; DELETE FROM app.legal_entity_access WHERE user_id = subject_user_id; DELETE FROM app.member_entity_scope WHERE user_id = subject_user_id; UPDATE app.member_entity_scope SET updated_by = tombstone WHERE updated_by = subject_user_id; UPDATE app.legal_entity_access SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.partner SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.document_link SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_run SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.payroll_run SET finalized_by = tombstone WHERE finalized_by = subject_user_id; UPDATE app.payroll_run SET paid_by = tombstone WHERE paid_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id; UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  UPDATE app.hr_access_assignment SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.hr_access_assignment SET user_id = tombstone WHERE user_id = subject_user_id; UPDATE app.payroll_component_definition SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.employee_compensation_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_component SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_liability SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_approval SET actor_user_id = tombstone WHERE actor_user_id = subject_user_id; UPDATE app.payroll_account_mapping SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_result_document SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_import SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.payroll_command_receipt SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.work_schedule SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.work_shift SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.timesheet SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.timesheet SET approved_by = tombstone WHERE approved_by = subject_user_id; UPDATE app.time_entry SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_type SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_request SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.leave_request SET decided_by = tombstone WHERE decided_by = subject_user_id; UPDATE app.leave_ledger SET created_by = tombstone WHERE created_by = subject_user_id; UPDATE app.absence SET created_by = tombstone WHERE created_by = subject_user_id;
  RETURN tombstone;
END;
$$;
ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
