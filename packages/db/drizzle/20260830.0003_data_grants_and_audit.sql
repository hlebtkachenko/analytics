-- Per user data grants and the append only audit log, both tenant scoped.
-- data_grants stays polymorphic: no foreign key to any future dataset table, so phase 1 never depends on phase 2 schema.
CREATE TABLE IF NOT EXISTS app.data_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Leading organization_id makes this the tenant index and keeps one grant per subject, resource, and scope.
  CONSTRAINT data_grants_subject_resource_key UNIQUE (organization_id, user_id, resource_type, resource_id, scope)
);

-- Future row level security policies on data tables read this table for per user row visibility.
ALTER TABLE app.data_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.data_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY data_grants_isolation ON app.data_grants
  USING (organization_id = current_setting('bap.organization_id', true))
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

CREATE TABLE IF NOT EXISTS app.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_organization_id_idx ON app.audit_log(organization_id, created_at DESC);

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;

-- Forced row level security binds the definer function too, so not even it can write across tenants.
CREATE POLICY audit_log_isolation ON app.audit_log
  USING (organization_id = current_setting('bap.organization_id', true))
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

-- The only writer of app.audit_log: no role holds INSERT, UPDATE, or DELETE on the table.
CREATE OR REPLACE FUNCTION app.record_audit(
  audit_action text,
  audit_resource_type text,
  audit_resource_id text DEFAULT NULL,
  audit_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  -- Tenant identity is derived from the transaction context and never from an argument.
  -- An argument passed organization id would be a cross tenant write primitive.
  context_organization_id text := current_setting('bap.organization_id', true);
  context_user_id text := current_setting('bap.user_id', true);
  recorded_id uuid;
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Audit entries require tenant context';
  END IF;

  IF coalesce(context_user_id, '') = '' THEN
    RAISE EXCEPTION 'Audit entries require user context';
  END IF;

  INSERT INTO app.audit_log (organization_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (
    context_organization_id,
    context_user_id,
    audit_action,
    audit_resource_type,
    audit_resource_id,
    coalesce(audit_metadata, '{}'::jsonb)
  )
  RETURNING id INTO recorded_id;

  RETURN recorded_id;
END;
$$;

ALTER FUNCTION app.record_audit(text, text, text, jsonb) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.record_audit(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_audit(text, text, text, jsonb) TO bap_api, bap_reporting;

GRANT USAGE ON SCHEMA app TO bap_api, bap_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.data_grants TO bap_api;
GRANT SELECT ON app.data_grants TO bap_reporting;

-- Read only for both service roles keeps the audit log append only outside app.record_audit.
GRANT SELECT ON app.audit_log TO bap_api, bap_reporting;

-- Default privileges under bap_owner already cover these, but the whole database dump must not depend on them.
GRANT SELECT ON app.data_grants, app.audit_log TO bap_backup;
