-- Generic tenant data foundation: datasets as tabular containers, their columns, their rows, and upload metadata.
-- No business domain entity and no sample data belongs here; every table stays a generic container.
-- Embeddings belong to the phase 3 migration: only one branch at a time may add a migration file.

CREATE TABLE IF NOT EXISTS app.dataset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'importing',
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema, exactly like app.data_grants.
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Stored generated tsvector keeps search pg native: the name outranks the description, 'simple' assumes no language.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'B')
  ) STORED,
  CONSTRAINT dataset_status_check CHECK (status IN ('importing', 'ready', 'failed')),
  -- Lets child tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT dataset_id_organization_key UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS dataset_organization_id_idx ON app.dataset(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dataset_search_vector_idx ON app.dataset USING gin (search_vector);

-- Deliberately no organization_id: a copy of the parent tenant would be a second, driftable source of truth.
-- Cross tenant reads stay impossible: the policy resolves the parent through app.dataset's own forced policy.
CREATE TABLE IF NOT EXISTS app.dataset_column (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  -- Open vocabulary on purpose: type inference gains a new label without a migration.
  inferred_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_column_position_check CHECK (position >= 0),
  CONSTRAINT dataset_column_dataset_position_key UNIQUE (dataset_id, position),
  CONSTRAINT dataset_column_dataset_name_key UNIQUE (dataset_id, name)
);

CREATE TABLE IF NOT EXISTS app.dataset_row (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id uuid NOT NULL,
  organization_id text NOT NULL,
  row_number integer NOT NULL,
  -- jsonb to start: no columnar layout until a real workload justifies one.
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_row_row_number_check CHECK (row_number >= 0),
  CONSTRAINT dataset_row_dataset_row_number_key UNIQUE (dataset_id, row_number),
  -- Composite foreign key makes the denormalized organization_id provably equal to the parent's.
  CONSTRAINT dataset_row_dataset_fkey FOREIGN KEY (dataset_id, organization_id)
    REFERENCES app.dataset(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dataset_row_organization_id_idx ON app.dataset_row(organization_id, dataset_id);

CREATE TABLE IF NOT EXISTS app.upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  -- Metadata only: the raw file never lands in the database, so no payload column exists.
  dataset_id uuid,
  filename text NOT NULL,
  byte_size bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upload_byte_size_check CHECK (byte_size >= 0),
  CONSTRAINT upload_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  -- The column list keeps organization_id intact, so the upload record survives its dataset.
  CONSTRAINT upload_dataset_fkey FOREIGN KEY (dataset_id, organization_id)
    REFERENCES app.dataset(id, organization_id) ON DELETE SET NULL (dataset_id)
);

CREATE INDEX IF NOT EXISTS upload_organization_id_idx ON app.upload(organization_id, created_at DESC);

-- One definition of dataset visibility, evaluated as the caller so app.dataset's own forced policy decides the answer.
CREATE OR REPLACE FUNCTION app.dataset_is_readable(target_dataset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.dataset AS readable WHERE readable.id = target_dataset_id
  )
$$;

-- Writes stay with the creator: a grant confers read visibility, never authorship.
CREATE OR REPLACE FUNCTION app.dataset_is_writable(target_dataset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, app
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.dataset AS writable
    WHERE writable.id = target_dataset_id
      AND writable.created_by = current_setting('bap.user_id', true)
  )
$$;

ALTER FUNCTION app.dataset_is_readable(uuid) OWNER TO bap_owner;
ALTER FUNCTION app.dataset_is_writable(uuid) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.dataset_is_readable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.dataset_is_writable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dataset_is_readable(uuid) TO bap_api, bap_reporting;
GRANT EXECUTE ON FUNCTION app.dataset_is_writable(uuid) TO bap_api;

ALTER TABLE app.dataset ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dataset FORCE ROW LEVEL SECURITY;
ALTER TABLE app.dataset_column ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dataset_column FORCE ROW LEVEL SECURITY;
ALTER TABLE app.dataset_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dataset_row FORCE ROW LEVEL SECURITY;
ALTER TABLE app.upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.upload FORCE ROW LEVEL SECURITY;

-- Tenant context and per user visibility: the creator always, anyone else only through an explicit app.data_grants row.
-- Grant scope is not interpreted yet; WITH CHECK still pins every written row to the acting subject.
CREATE POLICY dataset_isolation ON app.dataset
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND (
      created_by = current_setting('bap.user_id', true)
      OR EXISTS (
        SELECT 1
        FROM app.data_grants AS granted
        WHERE granted.organization_id = dataset.organization_id
          AND granted.user_id = current_setting('bap.user_id', true)
          AND granted.resource_type = 'dataset'
          AND granted.resource_id = dataset.id::text
      )
    )
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
  );

CREATE POLICY dataset_column_isolation ON app.dataset_column
  USING (app.dataset_is_readable(dataset_id))
  WITH CHECK (app.dataset_is_writable(dataset_id));

CREATE POLICY dataset_row_isolation ON app.dataset_row
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_readable(dataset_id)
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_writable(dataset_id)
  );

-- Uploads carry no creator column, so tenant isolation is the whole rule for them.
CREATE POLICY upload_isolation ON app.upload
  USING (organization_id = current_setting('bap.organization_id', true))
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

GRANT USAGE ON SCHEMA app TO bap_api, bap_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.dataset, app.dataset_column, app.dataset_row, app.upload TO bap_api;
GRANT SELECT ON app.dataset, app.dataset_column, app.dataset_row, app.upload TO bap_reporting;

-- Default privileges under bap_owner already cover these, but the whole database dump must not depend on them.
GRANT SELECT ON app.dataset, app.dataset_column, app.dataset_row, app.upload TO bap_backup;
