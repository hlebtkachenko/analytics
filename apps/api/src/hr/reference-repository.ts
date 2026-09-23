import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';

import { entityFilter, isUniqueViolation } from '../documents/sql.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import type { Paged } from './hr-repository.js';
import type {
  CostCentre,
  CreateCostCentreRequest,
  CreateDepartmentRequest,
  CreateDocumentCategoryRequest,
  CreatePositionRequest,
  CreateWorkplaceRequest,
  Department,
  DocumentCategory,
  HrReferenceListQuery,
  Position,
  UpdateCostCentreRequest,
  UpdateDepartmentRequest,
  UpdateDocumentCategoryRequest,
  UpdatePositionRequest,
  UpdateWorkplaceRequest,
  Workplace,
} from './contract.js';

export interface ReferenceScope extends TenantContext, EntityScopeSelector {}
export type ReferenceKind =
  'department' | 'position' | 'costCentre' | 'workplace' | 'documentCategory';
export type Reference =
  Department | Position | CostCentre | Workplace | DocumentCategory;
export type CreateReference =
  | CreateDepartmentRequest
  | CreatePositionRequest
  | CreateCostCentreRequest
  | CreateWorkplaceRequest
  | CreateDocumentCategoryRequest;
export type UpdateReference =
  | UpdateDepartmentRequest
  | UpdatePositionRequest
  | UpdateCostCentreRequest
  | UpdateWorkplaceRequest
  | UpdateDocumentCategoryRequest;
interface ReferenceRow {
  id: string;
  legal_entity_id: string;
  code: string;
  name: string;
  active: boolean;
  parent_id?: string | null;
  address_label?: string | null;
  confidentiality?: 'operational';
  retention_key?: string;
  requires_approval?: boolean;
  created_at: Date;
  updated_at: Date;
}
const table: Record<ReferenceKind, string> = {
  department: 'hr_department',
  position: 'hr_position',
  costCentre: 'hr_cost_centre',
  workplace: 'hr_workplace',
  documentCategory: 'hr_document_category',
};
const unique: Record<ReferenceKind, string> = {
  department: 'hr_department_entity_code_key',
  position: 'hr_position_entity_code_key',
  costCentre: 'hr_cost_centre_entity_code_key',
  workplace: 'hr_workplace_entity_code_key',
  documentCategory: 'hr_document_category_entity_code_key',
};
const columns: Record<ReferenceKind, string> = {
  department:
    'id,legal_entity_id,code,name,parent_id,active,created_at,updated_at',
  position: 'id,legal_entity_id,code,name,active,created_at,updated_at',
  costCentre: 'id,legal_entity_id,code,name,active,created_at,updated_at',
  workplace:
    'id,legal_entity_id,code,name,address_label,active,created_at,updated_at',
  documentCategory:
    'id,legal_entity_id,code,name,confidentiality,retention_key,requires_approval,active,created_at,updated_at',
};
function item(kind: ReferenceKind, row: ReferenceRow): Reference {
  const base = {
    id: row.id,
    legalEntityId: row.legal_entity_id,
    code: row.code,
    name: row.name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (kind === 'department')
    return { ...base, parentId: row.parent_id ?? null };
  if (kind === 'workplace')
    return { ...base, addressLabel: row.address_label ?? null };
  if (kind === 'documentCategory')
    return {
      ...base,
      confidentiality: row.confidentiality!,
      retentionKey: row.retention_key!,
      requiresApproval: row.requires_approval!,
    };
  return base;
}
async function visibleEntity(
  tx: { query: DatabasePool['query'] },
  legalEntityId: string,
  legalEntityIds: readonly string[] | null,
) {
  return (
    (
      await tx.query(
        'select 1 from app.legal_entity where id=$1 and ($2::uuid[] is null or id=any($2::uuid[]))',
        [legalEntityId, entityFilter(legalEntityIds)],
      )
    ).rowCount === 1
  );
}
export function isDuplicateReference(error: unknown, kind: ReferenceKind) {
  return isUniqueViolation(error, unique[kind]);
}
export async function listReferences(
  pool: DatabasePool,
  input: ReferenceScope & { kind: ReferenceKind; query: HrReferenceListQuery },
): Promise<Paged<Reference> | null> {
  const { kind, query: q } = input;
  const search = q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  return runInTenantContext(pool, input, async (tx) => {
    if (
      q.legalEntityId &&
      !(await visibleEntity(tx, q.legalEntityId, input.legalEntityIds))
    )
      return null;
    const where =
      "where ($1::uuid[] is null or legal_entity_id=any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::boolean is null or active=$3) and ($4::text is null or code ilike $4 escape '\\' or name ilike $4 escape '\\')";
    const params = [
      entityFilter(input.legalEntityIds),
      q.legalEntityId ?? null,
      q.active ?? null,
      search,
    ];
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text as count from app.${table[kind]} ${where}`,
        params,
      ),
      tx.query<ReferenceRow>(
        `select ${columns[kind]} from app.${table[kind]} ${where} order by code asc,id asc limit $5 offset $6`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: rows.rows.map((row) => item(kind, row)),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function createReference(
  pool: DatabasePool,
  input: ReferenceScope & { kind: ReferenceKind; body: CreateReference },
): Promise<Reference | null> {
  const { kind, body } = input;
  return runInTenantContext(pool, input, async (tx) => {
    const legalEntityId = (body as { legalEntityId: string }).legalEntityId;
    if (!(await visibleEntity(tx, legalEntityId, input.legalEntityIds)))
      return null;
    if (
      kind === 'department' &&
      (body as CreateDepartmentRequest).parentId !== null
    ) {
      const parent = await tx.query(
        'select 1 from app.hr_department where id=$1 and legal_entity_id=$2 and ($3::uuid[] is null or legal_entity_id=any($3::uuid[]))',
        [
          (body as CreateDepartmentRequest).parentId,
          legalEntityId,
          entityFilter(input.legalEntityIds),
        ],
      );
      if (!parent.rowCount) return null;
    }
    const extra =
      kind === 'department'
        ? ['parent_id', (body as CreateDepartmentRequest).parentId]
        : kind === 'workplace'
          ? ['address_label', (body as CreateWorkplaceRequest).addressLabel]
          : kind === 'documentCategory'
            ? [
                'confidentiality,retention_key,requires_approval',
                [
                  (body as CreateDocumentCategoryRequest).confidentiality,
                  (body as CreateDocumentCategoryRequest).retentionKey,
                  (body as CreateDocumentCategoryRequest).requiresApproval,
                ],
              ]
            : ['', []];
    const names = `organization_id,legal_entity_id,code,name,created_by${extra[0] ? `,${extra[0]}` : ''}`;
    const values = [
      input.organizationId,
      legalEntityId,
      body.code,
      body.name,
      input.userId,
      ...(Array.isArray(extra[1]) ? extra[1] : [extra[1]]),
    ];
    const markers = values.map((_, i) => `$${i + 1}`).join(',');
    const created = await tx.query<ReferenceRow>(
      `insert into app.${table[kind]} (${names}) values (${markers}) returning ${columns[kind]}`,
      values,
    );
    await tx.query("select app.record_audit($1, $2, $3, '{}'::jsonb)", [
      `${table[kind]}.created`,
      table[kind],
      created.rows[0]!.id,
    ]);
    return item(kind, created.rows[0]!);
  });
}
export async function updateReference(
  pool: DatabasePool,
  input: ReferenceScope & {
    kind: ReferenceKind;
    id: string;
    body: UpdateReference;
  },
): Promise<Reference | null> {
  const { kind, body } = input;
  return runInTenantContext(pool, input, async (tx) => {
    if (
      kind === 'department' &&
      (body as UpdateDepartmentRequest).parentId !== undefined &&
      (body as UpdateDepartmentRequest).parentId !== null
    ) {
      const parent = await tx.query(
        'select 1 from app.hr_department d join app.hr_department p on p.id=$1 and p.legal_entity_id=d.legal_entity_id where d.id=$2 and ($3::uuid[] is null or d.legal_entity_id=any($3::uuid[]))',
        [
          (body as UpdateDepartmentRequest).parentId,
          input.id,
          entityFilter(input.legalEntityIds),
        ],
      );
      if (!parent.rowCount) return null;
    }
    const fields: [string, unknown][] = [
      ['name', body.name],
      ['active', body.active],
    ];
    if (kind === 'department')
      fields.push(['parent_id', (body as UpdateDepartmentRequest).parentId]);
    if (kind === 'workplace')
      fields.push([
        'address_label',
        (body as UpdateWorkplaceRequest).addressLabel,
      ]);
    if (kind === 'documentCategory')
      fields.push(
        ['retention_key', body.retentionKey],
        ['requires_approval', body.requiresApproval],
      );
    const changed = fields.filter(([, value]) => value !== undefined);
    const params = changed.map(([, value]) => value);
    const set = changed
      .map(([name], index) => `${name}=$${index + 1}`)
      .join(',');
    const updated = await tx.query<ReferenceRow>(
      `update app.${table[kind]} set ${set},updated_at=now() where id=$${params.length + 1} and ($${params.length + 2}::uuid[] is null or legal_entity_id=any($${params.length + 2}::uuid[])) returning ${columns[kind]}`,
      [...params, input.id, entityFilter(input.legalEntityIds)],
    );
    if (!updated.rows[0]) return null;
    await tx.query("select app.record_audit($1, $2, $3, '{}'::jsonb)", [
      `${table[kind]}.updated`,
      table[kind],
      updated.rows[0].id,
    ]);
    return item(kind, updated.rows[0]);
  });
}
export abstract class ReferenceRepository {
  abstract list(
    input: ReferenceScope & {
      kind: ReferenceKind;
      query: HrReferenceListQuery;
    },
  ): Promise<Paged<Reference> | null>;
  abstract create(
    input: ReferenceScope & { kind: ReferenceKind; body: CreateReference },
  ): Promise<Reference | null>;
  abstract update(
    input: ReferenceScope & {
      kind: ReferenceKind;
      id: string;
      body: UpdateReference;
    },
  ): Promise<Reference | null>;
}
@Injectable()
export class DatabaseReferenceRepository
  extends ReferenceRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise) await (await this.poolPromise).end();
  }
  async list(
    input: ReferenceScope & {
      kind: ReferenceKind;
      query: HrReferenceListQuery;
    },
  ) {
    return listReferences(await this.pool(), input);
  }
  async create(
    input: ReferenceScope & { kind: ReferenceKind; body: CreateReference },
  ) {
    return createReference(await this.pool(), input);
  }
  async update(
    input: ReferenceScope & {
      kind: ReferenceKind;
      id: string;
      body: UpdateReference;
    },
  ) {
    return updateReference(await this.pool(), input);
  }
  private pool() {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
