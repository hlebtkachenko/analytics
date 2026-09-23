ALTER TABLE app.upload
  ADD CONSTRAINT upload_id_entity_organization_key
  UNIQUE (id, legal_entity_id, organization_id);

ALTER TABLE app.payroll_import
  ADD COLUMN upload_id uuid NOT NULL,
  ADD CONSTRAINT payroll_import_upload_fkey
  FOREIGN KEY (upload_id, legal_entity_id, organization_id)
  REFERENCES app.upload(id, legal_entity_id, organization_id) ON DELETE RESTRICT;
