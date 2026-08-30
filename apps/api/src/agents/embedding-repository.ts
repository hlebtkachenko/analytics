import { withTenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

// Must equal the width of app.dataset_embedding.embedding; a provider answer of any other width is rejected here.
export const EMBEDDING_DIMENSIONS = 1_536;

// Keyset paging starts before every uuid, so the first page needs no separate statement.
export const FIRST_DATASET_CURSOR = '00000000-0000-0000-0000-000000000000';

// pgvector post-filters an approximate scan, so without this a tenant can see fewer of its own rows than it owns.
const ENABLE_ITERATIVE_SCAN =
  "select set_config('hnsw.iterative_scan', 'strict_order', true)";

export interface EmbeddingCandidate {
  columns: string;
  contentHash: string | null;
  datasetId: string;
  description: string;
  model: string | null;
  name: string;
}

export interface LoadEmbeddingCandidatesInput {
  afterDatasetId: string;
  limit: number;
  userId: string;
}

export interface StoredEmbedding {
  contentHash: string;
  datasetId: string;
  embedding: readonly number[];
}

export interface StoreDatasetEmbeddingsInput {
  embeddings: readonly StoredEmbedding[];
  model: string;
  organizationId: string;
}

export interface SimilarDataset {
  datasetId: string;
  distance: number;
  name: string;
}

export interface SearchDatasetsByEmbeddingInput {
  embedding: readonly number[];
  limit: number;
  organizationId: string;
  userId: string;
}

export interface FindDatasetsNearDatasetInput {
  datasetId: string;
  limit: number;
  organizationId: string;
  userId: string;
}

// The vector crosses as one bound parameter, never as SQL text, and the provider answer is validated first.
export function toVectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('The embedding model returned an unsupported dimension.');
  }

  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('The embedding model returned a non-finite component.');
    }
  }

  return `[${embedding.join(',')}]`;
}

// Only datasets this subject created are listed: app.dataset_embedding writes follow app.dataset_is_writable.
export async function loadEmbeddingCandidates(
  transaction: PoolClient,
  input: LoadEmbeddingCandidatesInput,
): Promise<EmbeddingCandidate[]> {
  const result = await transaction.query<{
    columns: string;
    content_hash: string | null;
    dataset_id: string;
    description: string;
    model: string | null;
    name: string;
  }>(
    `select d.id as dataset_id,
            d.name,
            coalesce(d.description, '') as description,
            coalesce((
              select string_agg(c.name || ' (' || c.inferred_type || ')', ', ' order by c.position)
              from app.dataset_column as c
              where c.dataset_id = d.id
            ), '') as columns,
            e.content_hash,
            e.model
     from app.dataset as d
     left join app.dataset_embedding as e on e.dataset_id = d.id
     where d.created_by = $1
       and d.status = 'ready'
       and d.id > $2::uuid
     order by d.id
     limit $3`,
    [input.userId, input.afterDatasetId, input.limit],
  );

  return result.rows.map((row) => ({
    columns: row.columns,
    contentHash: row.content_hash,
    datasetId: row.dataset_id,
    description: row.description,
    model: row.model,
    name: row.name,
  }));
}

// One statement per batch: the conflict target is the single current vector each dataset is allowed.
export async function storeDatasetEmbeddings(
  transaction: PoolClient,
  input: StoreDatasetEmbeddingsInput,
): Promise<number> {
  if (input.embeddings.length === 0) {
    return 0;
  }

  const written = await transaction.query(
    `insert into app.dataset_embedding (organization_id, dataset_id, model, content_hash, embedding)
     select $1, staged.dataset_id::uuid, $2, staged.content_hash, staged.embedding::vector
     from unnest($3::text[], $4::text[], $5::text[])
       as staged(dataset_id, content_hash, embedding)
     on conflict (dataset_id) do update
     set content_hash = excluded.content_hash,
         embedding = excluded.embedding,
         model = excluded.model,
         updated_at = now()`,
    [
      input.organizationId,
      input.model,
      input.embeddings.map((entry) => entry.datasetId),
      input.embeddings.map((entry) => entry.contentHash),
      input.embeddings.map((entry) => toVectorLiteral(entry.embedding)),
    ],
  );
  // Attribution is derived from the transaction context, so the audit call must run inside it.
  // The metadata names the model only; the embedded text and the vector never enter the audit log.
  await transaction.query(
    `select app.record_audit('dataset.embedded', 'dataset', staged.dataset_id, $2::jsonb)
     from unnest($1::text[]) as staged(dataset_id)`,
    [
      input.embeddings.map((entry) => entry.datasetId),
      JSON.stringify({ model: input.model }),
    ],
  );

  return written.rowCount ?? 0;
}

// Row level security confines the search: the tenant transaction is the only place it may run.
export async function searchDatasetsByEmbedding(
  pool: DatabasePool,
  input: SearchDatasetsByEmbeddingInput,
): Promise<SimilarDataset[]> {
  const literal = toVectorLiteral(input.embedding);
  const client = await pool.connect();

  try {
    return await withTenantContext(
      client,
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        await transaction.query(ENABLE_ITERATIVE_SCAN);
        const result = await transaction.query<{
          dataset_id: string;
          distance: number;
          name: string;
        }>(
          `select d.id as dataset_id,
                  d.name,
                  (e.embedding <=> $1::vector)::float8 as distance
           from app.dataset_embedding as e
           join app.dataset as d on d.id = e.dataset_id
           order by e.embedding <=> $1::vector
           limit $2`,
          [literal, input.limit],
        );

        return result.rows.map((row) => ({
          datasetId: row.dataset_id,
          distance: Number(row.distance),
          name: row.name,
        }));
      },
    );
  } finally {
    client.release();
  }
}

// Neighbours of a stored vector: the query vector never leaves the database, so nothing crosses the wire.
export async function findDatasetsNearDataset(
  pool: DatabasePool,
  input: FindDatasetsNearDatasetInput,
): Promise<SimilarDataset[]> {
  const client = await pool.connect();

  try {
    return await withTenantContext(
      client,
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        await transaction.query(ENABLE_ITERATIVE_SCAN);
        const result = await transaction.query<{
          dataset_id: string;
          distance: number;
          name: string;
        }>(
          `select other.dataset_id,
                  d.name,
                  (other.embedding <=> source.embedding)::float8 as distance
           from app.dataset_embedding as source
           join app.dataset_embedding as other on other.dataset_id <> source.dataset_id
           join app.dataset as d on d.id = other.dataset_id
           where source.dataset_id = $1::uuid
           order by other.embedding <=> source.embedding
           limit $2`,
          [input.datasetId, input.limit],
        );

        return result.rows.map((row) => ({
          datasetId: row.dataset_id,
          distance: Number(row.distance),
          name: row.name,
        }));
      },
    );
  } finally {
    client.release();
  }
}
