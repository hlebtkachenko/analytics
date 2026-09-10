import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { readEntityScope, withTenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { EntityScope, LegalEntity, OrganizationRole } from '@bap/security';
import type { PoolClient } from 'pg';

import type { TenantSelector } from '../tenant-access.js';
import { MAX_LEGAL_ENTITY_LIST_SIZE } from './contract.js';

export interface ListLegalEntitiesInput extends TenantSelector {
  // null is the absence of an entity filter; an empty array lists nothing.
  legalEntityIds: readonly string[] | null;
}

export interface CreateLegalEntityInput extends TenantSelector {
  kind: string;
  name: string;
  registrationNumber: string | null;
}

export interface UpdateLegalEntityInput extends TenantSelector {
  kind: string | null;
  legalEntityId: string;
  legalEntityIds: readonly string[] | null;
  name: string | null;
  // Explicit flag: an absent field leaves the number alone, an explicit null clears it.
  registrationNumber: string | null;
  updatesRegistrationNumber: boolean;
}

export interface DeleteLegalEntityInput extends TenantSelector {
  legalEntityId: string;
  legalEntityIds: readonly string[] | null;
}

export interface ReadMemberEntityScopeInput extends TenantSelector {
  targetRole: OrganizationRole;
  targetUserId: string;
}

export interface WriteMemberEntityScopeInput extends TenantSelector {
  scope: EntityScope;
  targetUserId: string;
}

// 'unknown-entity' is the only failure the caller must translate, and it becomes a 400.
export type WriteMemberEntityScopeResult = 'unknown-entity' | 'written';

interface LegalEntityRow {
  created_at: Date;
  id: string;
  kind: string;
  name: string;
  registration_number: string | null;
  updated_at: Date;
}

const LEGAL_ENTITY_COLUMNS =
  'id, name, kind, registration_number, created_at, updated_at';

function toLegalEntity(row: LegalEntityRow): LegalEntity {
  return {
    createdAt: row.created_at.toISOString(),
    id: row.id,
    kind: row.kind as LegalEntity['kind'],
    name: row.name,
    registrationNumber: row.registration_number,
    updatedAt: row.updated_at.toISOString(),
  };
}

// An entity filter of null is the "all entities" view: the absence of a filter, never a wider query.
function entityFilter(
  legalEntityIds: readonly string[] | null,
): string[] | null {
  return legalEntityIds === null ? null : [...legalEntityIds];
}

// The unique (organization_id, name) index is the only conflict a well-formed body can hit.
export function isDuplicateEntityName(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505' &&
    (error as { constraint?: unknown }).constraint ===
      'legal_entity_organization_name_key'
  );
}

async function inTenantContext<T>(
  pool: DatabasePool,
  tenant: TenantSelector,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

export async function listLegalEntities(
  pool: DatabasePool,
  input: ListLegalEntitiesInput,
): Promise<LegalEntity[]> {
  return inTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<LegalEntityRow>(
      `select ${LEGAL_ENTITY_COLUMNS}
       from app.legal_entity
       where ($1::uuid[] is null or id = any($1::uuid[]))
       order by created_at desc, id desc
       limit $2`,
      [entityFilter(input.legalEntityIds), MAX_LEGAL_ENTITY_LIST_SIZE],
    );

    return result.rows.map(toLegalEntity);
  });
}

export async function createLegalEntity(
  pool: DatabasePool,
  input: CreateLegalEntityInput,
): Promise<LegalEntity> {
  return inTenantContext(pool, input, async (transaction) => {
    const created = await transaction.query<LegalEntityRow>(
      `insert into app.legal_entity (organization_id, name, kind, registration_number, created_by)
       values ($1, $2, $3, $4, $5)
       returning ${LEGAL_ENTITY_COLUMNS}`,
      [
        input.organizationId,
        input.name,
        input.kind,
        input.registrationNumber,
        input.userId,
      ],
    );
    const row = created.rows[0];

    if (row === undefined) {
      throw new Error('The legal entity insert returned no row.');
    }

    // Attribution is derived from the transaction context, so this must run inside it.
    // The metadata names the kind only: the entity name is never logged.
    await transaction.query(
      "select app.record_audit('legal_entity.created', 'legal_entity', $1, $2::jsonb)",
      [row.id, JSON.stringify({ kind: row.kind })],
    );
    return toLegalEntity(row);
  });
}

// Returns null when the entity is absent or out of scope, so a restricted caller learns nothing.
export async function updateLegalEntity(
  pool: DatabasePool,
  input: UpdateLegalEntityInput,
): Promise<LegalEntity | null> {
  return inTenantContext(pool, input, async (transaction) => {
    const updated = await transaction.query<LegalEntityRow>(
      `update app.legal_entity
       set name = coalesce($2, name),
           kind = coalesce($3, kind),
           registration_number = case when $4 then $5 else registration_number end,
           updated_at = now()
       where id = $1
         and ($6::uuid[] is null or id = any($6::uuid[]))
       returning ${LEGAL_ENTITY_COLUMNS}`,
      [
        input.legalEntityId,
        input.name,
        input.kind,
        input.updatesRegistrationNumber,
        input.registrationNumber,
        entityFilter(input.legalEntityIds),
      ],
    );
    const row = updated.rows[0];

    if (row === undefined) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('legal_entity.updated', 'legal_entity', $1, '{}'::jsonb)",
      [row.id],
    );
    return toLegalEntity(row);
  });
}

// Datasets and uploads of the entity go with it: the composite foreign keys cascade.
export async function deleteLegalEntity(
  pool: DatabasePool,
  input: DeleteLegalEntityInput,
): Promise<boolean> {
  return inTenantContext(pool, input, async (transaction) => {
    const removed = await transaction.query(
      `delete from app.legal_entity
       where id = $1
         and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [input.legalEntityId, entityFilter(input.legalEntityIds)],
    );

    if (removed.rowCount === 0) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('legal_entity.deleted', 'legal_entity', $1, '{}'::jsonb)",
      [input.legalEntityId],
    );
    return true;
  });
}

export async function readMemberEntityScope(
  pool: DatabasePool,
  input: ReadMemberEntityScopeInput,
): Promise<EntityScope> {
  return inTenantContext(pool, input, (transaction) =>
    readEntityScope(transaction, {
      organizationId: input.organizationId,
      role: input.targetRole,
      userId: input.targetUserId,
    }),
  );
}

export async function writeMemberEntityScope(
  pool: DatabasePool,
  input: WriteMemberEntityScopeInput,
): Promise<WriteMemberEntityScopeResult> {
  const legalEntityIds =
    input.scope.mode === 'restricted' ? [...input.scope.legalEntityIds] : [];

  return inTenantContext(pool, input, async (transaction) => {
    if (legalEntityIds.length > 0) {
      // Row level security confines this count to the caller's organization, so a foreign id is unknown too.
      const known = await transaction.query<{ total: number }>(
        'select count(*)::int as total from app.legal_entity where id = any($1::uuid[])',
        [legalEntityIds],
      );

      if (known.rows[0]?.total !== new Set(legalEntityIds).size) {
        return 'unknown-entity';
      }
    }

    await transaction.query(
      `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (organization_id, user_id) do update
       set mode = excluded.mode,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      [
        input.organizationId,
        input.targetUserId,
        input.scope.mode,
        input.userId,
      ],
    );
    // The stored access rows are replaced wholesale, so the list in the request is the whole truth.
    await transaction.query(
      `delete from app.legal_entity_access
       where user_id = $1 and not (legal_entity_id = any($2::uuid[]))`,
      [input.targetUserId, legalEntityIds],
    );

    if (legalEntityIds.length > 0) {
      await transaction.query(
        `insert into app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by)
         select $1, $2, staged.legal_entity_id::uuid, $4
         from unnest($3::text[]) as staged(legal_entity_id)
         on conflict (organization_id, user_id, legal_entity_id) do nothing`,
        [
          input.organizationId,
          input.targetUserId,
          legalEntityIds,
          input.userId,
        ],
      );
    }

    // The subject of the change is the audited resource; the entity list stays a count.
    await transaction.query(
      "select app.record_audit('member_entity_scope.updated', 'member', $1, $2::jsonb)",
      [
        input.targetUserId,
        JSON.stringify({
          entities: legalEntityIds.length,
          mode: input.scope.mode,
        }),
      ],
    );
    return 'written';
  });
}

export abstract class LegalEntityRepository {
  abstract createEntity(input: CreateLegalEntityInput): Promise<LegalEntity>;
  abstract deleteEntity(input: DeleteLegalEntityInput): Promise<boolean>;
  abstract listEntities(input: ListLegalEntitiesInput): Promise<LegalEntity[]>;
  abstract readMemberScope(
    input: ReadMemberEntityScopeInput,
  ): Promise<EntityScope>;
  abstract updateEntity(
    input: UpdateLegalEntityInput,
  ): Promise<LegalEntity | null>;
  abstract writeMemberScope(
    input: WriteMemberEntityScopeInput,
  ): Promise<WriteMemberEntityScopeResult>;
}

@Injectable()
export class DatabaseLegalEntityRepository
  extends LegalEntityRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async createEntity(input: CreateLegalEntityInput): Promise<LegalEntity> {
    return createLegalEntity(await this.getPool(), input);
  }

  async deleteEntity(input: DeleteLegalEntityInput): Promise<boolean> {
    return deleteLegalEntity(await this.getPool(), input);
  }

  async listEntities(input: ListLegalEntitiesInput): Promise<LegalEntity[]> {
    return listLegalEntities(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async readMemberScope(
    input: ReadMemberEntityScopeInput,
  ): Promise<EntityScope> {
    return readMemberEntityScope(await this.getPool(), input);
  }

  async updateEntity(
    input: UpdateLegalEntityInput,
  ): Promise<LegalEntity | null> {
    return updateLegalEntity(await this.getPool(), input);
  }

  async writeMemberScope(
    input: WriteMemberEntityScopeInput,
  ): Promise<WriteMemberEntityScopeResult> {
    return writeMemberEntityScope(await this.getPool(), input);
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
