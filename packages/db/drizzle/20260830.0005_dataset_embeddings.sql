-- Phase 3 agent storage: one current embedding per dataset, produced by the model the AI credential names.
-- The embedded text is dataset metadata only: name, description and column names, never a stored cell value.

-- Dimension 1536: the native width of OpenAI text-embedding-3-small and a supported reduced width of text-embedding-3-large.
-- Anthropic publishes no embedding model, so those two are the entire choice the credential can name today.
-- 1536 also stays under the 2000 dimension ceiling pgvector enforces for an hnsw index on the vector type.
-- A model of a different width fails this column outright, so adopting one is a new migration plus a full re-backfill.
CREATE TABLE IF NOT EXISTS app.dataset_embedding (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  dataset_id uuid NOT NULL,
  -- The fully qualified provider:model that produced the vector, so a model change is detectable without a dump.
  model text NOT NULL,
  -- sha256 of the exact embedded text, so a backfill re-embeds only the datasets whose text actually changed.
  content_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_embedding_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dataset_embedding_model_check CHECK (length(model) BETWEEN 1 AND 128),
  -- One current vector per dataset: keeping history would be a second source of truth with no reader.
  CONSTRAINT dataset_embedding_dataset_key UNIQUE (dataset_id),
  -- Composite foreign key makes the denormalized organization_id provably equal to the parent's.
  CONSTRAINT dataset_embedding_dataset_fkey FOREIGN KEY (dataset_id, organization_id)
    REFERENCES app.dataset(id, organization_id) ON DELETE CASCADE
);

-- Leading organization_id keeps the tenant predicate on an index, which is the exact plan a small tenant gets.
CREATE INDEX IF NOT EXISTS dataset_embedding_organization_id_idx
  ON app.dataset_embedding(organization_id, dataset_id);

-- hnsw over cosine distance: the metric these embeddings are normalized for, and unlike ivfflat it needs no trained sample.
-- An approximate scan is filtered by row level security afterwards, so a reader must enable hnsw.iterative_scan.
-- Without it a tenant can be squeezed out of the candidate set and see fewer rows than it owns, never another tenant's.
CREATE INDEX IF NOT EXISTS dataset_embedding_embedding_idx
  ON app.dataset_embedding USING hnsw (embedding vector_cosine_ops);

ALTER TABLE app.dataset_embedding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dataset_embedding FORCE ROW LEVEL SECURITY;

-- Split per command on purpose: one ALL policy would let its USING clause govern DELETE and the row selection of UPDATE,
-- so a read grant on the parent dataset would confer deletion of its embedding. A grant widens reading only.
-- Reading follows the dataset, writing stays with the dataset creator, exactly like app.dataset_column and app.dataset_row.
CREATE POLICY dataset_embedding_select ON app.dataset_embedding FOR SELECT
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_readable(dataset_id)
  );

CREATE POLICY dataset_embedding_insert ON app.dataset_embedding FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_writable(dataset_id)
  );

CREATE POLICY dataset_embedding_update ON app.dataset_embedding FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_writable(dataset_id)
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_writable(dataset_id)
  );

CREATE POLICY dataset_embedding_delete ON app.dataset_embedding FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.dataset_is_writable(dataset_id)
  );

GRANT USAGE ON SCHEMA app TO bap_api, bap_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.dataset_embedding TO bap_api;
GRANT SELECT ON app.dataset_embedding TO bap_reporting;

-- Default privileges under bap_owner already cover this, but the whole database dump must not depend on them.
GRANT SELECT ON app.dataset_embedding TO bap_backup;
