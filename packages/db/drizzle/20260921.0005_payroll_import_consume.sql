-- W2.4 keeps the import-to-run replay result in the database, not the queue.
ALTER TABLE app.payroll_import
  ADD COLUMN payroll_month date,
  ADD COLUMN payroll_run_id uuid;

ALTER TABLE app.payroll_import
  ADD CONSTRAINT payroll_import_month_check CHECK (payroll_month = date_trunc('month', payroll_month)::date);

UPDATE app.payroll_import AS payroll_import
SET payroll_month = date_trunc('month', document.document_date)::date
FROM app.document AS document
WHERE document.id = payroll_import.source_document_id
  AND document.organization_id = payroll_import.organization_id;

ALTER TABLE app.payroll_import
  ALTER COLUMN payroll_month SET NOT NULL,
  ADD CONSTRAINT payroll_import_run_fkey FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT payroll_import_run_key UNIQUE (payroll_run_id),
  ADD CONSTRAINT payroll_import_consumed_run_check CHECK ((status = 'consumed') = (payroll_run_id IS NOT NULL));

CREATE OR REPLACE FUNCTION app.check_payroll_import_run_entity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.payroll_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.payroll_run
    WHERE id = NEW.payroll_run_id AND organization_id = NEW.organization_id
      AND legal_entity_id = NEW.legal_entity_id
  ) THEN
    RAISE EXCEPTION 'Payroll import run must belong to the same legal entity'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payroll_import_run_entity_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_import_run_entity_check BEFORE INSERT OR UPDATE ON app.payroll_import
  FOR EACH ROW EXECUTE FUNCTION app.check_payroll_import_run_entity();

GRANT UPDATE (status, row_count, error_count, error_report, payroll_run_id, updated_at) ON app.payroll_import TO bap_api;
