import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { readEntityScope, runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { EntityScope, LegalEntity, OrganizationRole } from '@bap/security';

import { MAX_LEGAL_ENTITY_LIST_SIZE } from './contract.js';

export interface ListLegalEntitiesInput extends TenantContext {
  // null is the absence of an entity filter; an empty array lists nothing.
  legalEntityIds: readonly string[] | null;
}

export interface CreateLegalEntityInput extends TenantContext {
  kind: string;
  name: string;
  registrationNumber: string | null;
}

export interface UpdateLegalEntityInput extends TenantContext {
  kind: string | undefined;
  legalEntityId: string;
  legalEntityIds: readonly string[] | null;
  name: string | undefined;
  // An absent number leaves the stored one alone, an explicit null clears it.
  registrationNumber: string | null | undefined;
}

export interface DeleteLegalEntityInput extends TenantContext {
  legalEntityId: string;
  legalEntityIds: readonly string[] | null;
}

export interface ReadMemberEntityScopeInput extends TenantContext {
  targetRole: OrganizationRole;
  targetUserId: string;
}

export interface WriteMemberEntityScopeInput extends TenantContext {
  scope: EntityScope;
  targetUserId: string;
}

// One entry per stored scope row; a member without a row is implicitly unrestricted and is omitted.
export interface MemberEntityScope {
  entityScope: EntityScope;
  userId: string;
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

export async function listLegalEntities(
  pool: DatabasePool,
  input: ListLegalEntitiesInput,
): Promise<LegalEntity[]> {
  return runInTenantContext(pool, input, async (transaction) => {
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
  return runInTenantContext(pool, input, async (transaction) => {
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

    // Attribution comes from the transaction context, so this runs inside it and logs the kind only, never the name.
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
  return runInTenantContext(pool, input, async (transaction) => {
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
        input.name ?? null,
        input.kind ?? null,
        input.registrationNumber !== undefined,
        input.registrationNumber ?? null,
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
  return runInTenantContext(pool, input, async (transaction) => {
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
  return runInTenantContext(pool, input, (transaction) =>
    readEntityScope(transaction, {
      organizationId: input.organizationId,
      role: input.targetRole,
      userId: input.targetUserId,
    }),
  );
}

// The members page needs every stored scope at once: one transaction and two queries instead of a call per member.
export async function listMemberEntityScopes(
  pool: DatabasePool,
  input: TenantContext,
): Promise<MemberEntityScope[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const scopes = await transaction.query<{ mode: string; user_id: string }>(
      `select user_id, mode
       from app.member_entity_scope
       where organization_id = $1
       order by user_id`,
      [input.organizationId],
    );
    const granted = await transaction.query<{
      legal_entity_id: string;
      user_id: string;
    }>(
      `select user_id, legal_entity_id
       from app.legal_entity_access
       where organization_id = $1
       order by user_id, legal_entity_id`,
      [input.organizationId],
    );
    const entitiesByUser = new Map<string, string[]>();

    for (const row of granted.rows) {
      const entities = entitiesByUser.get(row.user_id) ?? [];
      entities.push(row.legal_entity_id);
      entitiesByUser.set(row.user_id, entities);
    }

    return scopes.rows.map((row) => ({
      entityScope:
        row.mode === 'restricted'
          ? {
              legalEntityIds: entitiesByUser.get(row.user_id) ?? [],
              mode: 'restricted' as const,
            }
          : { mode: 'all' as const },
      userId: row.user_id,
    }));
  });
}

export async function writeMemberEntityScope(
  pool: DatabasePool,
  input: WriteMemberEntityScopeInput,
): Promise<WriteMemberEntityScopeResult> {
  const legalEntityIds =
    input.scope.mode === 'restricted' ? [...input.scope.legalEntityIds] : [];

  return runInTenantContext(pool, input, async (transaction) => {
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
  abstract listMemberScopes(input: TenantContext): Promise<MemberEntityScope[]>;
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

  async listMemberScopes(input: TenantContext): Promise<MemberEntityScope[]> {
    return listMemberEntityScopes(await this.getPool(), input);
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
