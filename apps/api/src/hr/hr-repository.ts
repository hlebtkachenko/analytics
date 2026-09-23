import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';

import { entityFilter, isUniqueViolation } from '../documents/sql.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import type {
  CreateEmployeeRequest,
  CreateEmploymentRelationshipRequest,
  Employee,
  EmploymentRelationship,
  UpdateEmployeeRequest,
  EmployeeListQuery,
  EmploymentTerm,
  EmploymentTermListQuery,
  CreateEmploymentTermRequest,
  EmployeeStatusChange,
  EmployeeStatusHistoryQuery,
  EmployeeStatusTransitionRequest,
  EmployeeDocument,
  EmployeeDocumentListQuery,
  LinkEmployeeDocumentRequest,
  UpdateEmployeeDocumentRequest,
  ChecklistTemplate,
  ChecklistTemplateItem,
  Checklist,
  ChecklistTask,
  ChecklistTemplateListQuery,
  ChecklistListQuery,
  CreateChecklistTemplateRequest,
  UpdateChecklistTemplateRequest,
  CreateChecklistTemplateItemRequest,
  UpdateChecklistTemplateItemRequest,
  CreateChecklistRequest,
  UpdateChecklistTaskRequest,
} from './contract.js';

export interface HrScope extends TenantContext, EntityScopeSelector {}
type EmployeeInput = HrScope & { employeeId: string };
const employeeColumns =
  'id, legal_entity_id, employee_number, first_name, last_name, work_email, work_phone, status, created_at, updated_at';
interface EmployeeRow {
  id: string;
  legal_entity_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  work_email: string | null;
  work_phone: string | null;
  status: Employee['status'];
  created_at: Date;
  updated_at: Date;
}
interface RelationshipRow {
  id: string;
  employee_id: string;
  kind: EmploymentRelationship['kind'];
  position: string;
  department: string | null;
  cost_centre: string | null;
  weekly_hours: string;
  start_date: string | Date;
  end_date: string | Date | null;
  created_at: Date;
  updated_at: Date;
}
interface EmploymentTermRow {
  id: string;
  employee_id: string;
  relationship_id: string;
  version: number;
  supersedes_employment_term_id: string | null;
  effective_from: string | Date;
  effective_to: string | Date | null;
  position_id: string | null;
  department_id: string | null;
  cost_centre_id: string | null;
  workplace_id: string | null;
  manager_employee_id: string | null;
  weekly_hours: string;
  working_time_pattern: string;
  created_at: Date;
}
interface EmployeeStatusChangeRow {
  id: string;
  employee_id: string;
  from_status: EmployeeStatusChange['fromStatus'];
  to_status: EmployeeStatusChange['toStatus'];
  effective_at: Date;
  reason: string | null;
  created_at: Date;
}
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
function formatDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}
function employee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    legalEntityId: row.legal_entity_id,
    employeeNumber: row.employee_number,
    firstName: row.first_name,
    lastName: row.last_name,
    workEmail: row.work_email,
    workPhone: row.work_phone,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
function relationship(row: RelationshipRow): EmploymentRelationship {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind,
    position: row.position,
    department: row.department,
    costCentre: row.cost_centre,
    weeklyHours: row.weekly_hours,
    startDate: formatDate(row.start_date),
    endDate: row.end_date === null ? null : formatDate(row.end_date),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
function employmentTerm(row: EmploymentTermRow): EmploymentTerm {
  return {
    id: row.id,
    employeeId: row.employee_id,
    relationshipId: row.relationship_id,
    version: row.version,
    supersedesEmploymentTermId: row.supersedes_employment_term_id,
    effectiveFrom: formatDate(row.effective_from),
    effectiveTo:
      row.effective_to === null ? null : formatDate(row.effective_to),
    positionId: row.position_id,
    departmentId: row.department_id,
    costCentreId: row.cost_centre_id,
    workplaceId: row.workplace_id,
    managerEmployeeId: row.manager_employee_id,
    weeklyHours: row.weekly_hours,
    workingTimePattern: row.working_time_pattern,
    createdAt: row.created_at.toISOString(),
  };
}
function employeeStatusChange(
  row: EmployeeStatusChangeRow,
): EmployeeStatusChange {
  return {
    id: row.id,
    employeeId: row.employee_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    effectiveAt: row.effective_at.toISOString(),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}
export function isDuplicateHrRecord(error: unknown): boolean {
  return (
    isUniqueViolation(error, 'employee_document_pkey') ||
    isUniqueViolation(error, 'employee_organization_number_key') ||
    isUniqueViolation(error, 'employment_term_relationship_version_key') ||
    isUniqueViolation(error, 'employment_term_supersedes_successor_key') ||
    isUniqueViolation(error, 'employee_document_supersedes_successor_key') ||
    isUniqueViolation(error, 'document_current_reference_key') ||
    isUniqueViolation(error, 'hr_checklist_template_entity_code_key') ||
    isUniqueViolation(error, 'hr_checklist_template_item_template_position_key')
  );
}

export class HrEmployeeNotFoundError extends Error {}
export class HrEmployeeStatusConflictError extends Error {}
export class HrEmployeeStatusReasonError extends Error {}
export class HrEmployeeDocumentNotFoundError extends Error {}
export class HrEmployeeDocumentConflictError extends Error {}
export class HrChecklistNotFoundError extends Error {}
export class HrChecklistConflictError extends Error {}
export class HrChecklistBadRequestError extends Error {}
export function isEmployeeDocumentConflict(error: unknown): boolean {
  const constraint =
    typeof error === 'object' && error !== null && 'constraint' in error
      ? (error as { constraint?: unknown }).constraint
      : undefined;
  return (
    isUniqueViolation(error, 'employee_document_pkey') ||
    isUniqueViolation(error, 'employee_document_supersedes_successor_key') ||
    constraint === 'employee_document_supersedes_cycle_check' ||
    constraint === 'employee_document_supersedes_not_self_check'
  );
}

interface EmployeeDocumentRow {
  document_id: string;
  title: string;
  document_date: string | Date;
  category_id: string | null;
  relationship_id: string | null;
  approval_status: EmployeeDocument['approvalStatus'];
  approved_by: string | null;
  approved_at: Date | null;
  supersedes_document_id: string | null;
  created_at: Date;
}
function employeeDocument(row: EmployeeDocumentRow): EmployeeDocument {
  return {
    documentId: row.document_id,
    title: row.title,
    documentDate: formatDate(row.document_date),
    categoryId: row.category_id,
    relationshipId: row.relationship_id,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at?.toISOString() ?? null,
    supersedesDocumentId: row.supersedes_document_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listEmployees(
  pool: DatabasePool,
  input: HrScope & { query?: EmployeeListQuery },
): Promise<Paged<Employee>> {
  const q = input.query ?? { page: 1, pageSize: 25 };
  const search = q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  return runInTenantContext(pool, input, async (tx) =>
    (() => {
      const where = `where ($1::uuid[] is null or legal_entity_id = any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::text is null or status=$3) and ($4::text is null or employee_number ilike $4 escape '\\' or first_name ilike $4 escape '\\' or last_name ilike $4 escape '\\' or work_email ilike $4 escape '\\')`;
      const params = [
        entityFilter(input.legalEntityIds),
        q.legalEntityId ?? null,
        q.status ?? null,
        search,
      ];
      return Promise.all([
        tx.query<{ count: string }>(
          `select count(*)::text as count from app.employee ${where}`,
          params,
        ),
        tx.query<EmployeeRow>(
          `select ${employeeColumns} from app.employee ${where} order by last_name asc, first_name asc, id asc limit $5 offset $6`,
          [...params, q.pageSize, (q.page - 1) * q.pageSize],
        ),
      ]).then(([count, rows]) => ({
        items: rows.rows.map(employee),
        page: q.page,
        pageSize: q.pageSize,
        total: Number(count.rows[0]?.count ?? 0),
      }));
    })(),
  );
}
export async function readEmployee(
  pool: DatabasePool,
  input: EmployeeInput,
): Promise<Employee | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const r = await tx.query(
      `select ${employeeColumns} from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))`,
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    return r.rows[0] ? employee(r.rows[0]) : null;
  });
}
export async function createEmployee(
  pool: DatabasePool,
  input: HrScope & { body: CreateEmployeeRequest },
): Promise<Employee | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const allowed = await tx.query(
      'select 1 from app.legal_entity where id=$1 and ($2::uuid[] is null or id=any($2::uuid[]))',
      [input.body.legalEntityId, entityFilter(input.legalEntityIds)],
    );
    if (!allowed.rowCount) return null;
    const r = await tx.query(
      `insert into app.employee (organization_id,legal_entity_id,employee_number,first_name,last_name,work_email,work_phone,status,created_by) values ($1,$2,$3,$4,$5,$6,$7,'preboarding',$8) returning ${employeeColumns}`,
      [
        input.organizationId,
        input.body.legalEntityId,
        input.body.employeeNumber,
        input.body.firstName,
        input.body.lastName,
        input.body.workEmail,
        input.body.workPhone,
        input.userId,
      ],
    );
    await tx.query(
      "select app.record_audit('employee.created', 'employee', $1, '{}'::jsonb)",
      [r.rows[0].id],
    );
    return employee(r.rows[0]);
  });
}
export async function updateEmployee(
  pool: DatabasePool,
  input: EmployeeInput & { body: UpdateEmployeeRequest },
): Promise<Employee | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body;
    const r = await tx.query(
      `update app.employee set first_name=coalesce($2,first_name),last_name=coalesce($3,last_name),work_email=case when $4 then $5 else work_email end,work_phone=case when $6 then $7 else work_phone end,updated_at=now() where id=$1 and ($8::uuid[] is null or legal_entity_id=any($8::uuid[])) returning ${employeeColumns}`,
      [
        input.employeeId,
        b.firstName ?? null,
        b.lastName ?? null,
        b.workEmail !== undefined,
        b.workEmail ?? null,
        b.workPhone !== undefined,
        b.workPhone ?? null,
        entityFilter(input.legalEntityIds),
      ],
    );
    if (r.rows[0]) {
      await tx.query(
        "select app.record_audit('employee.updated', 'employee', $1, '{}'::jsonb)",
        [r.rows[0].id],
      );
    }
    return r.rows[0] ? employee(r.rows[0]) : null;
  });
}
const employeeStatusTransitions: Record<
  Employee['status'],
  Employee['status'][]
> = {
  preboarding: ['active', 'cancelled'],
  active: ['inactive'],
  inactive: ['active', 'archived'],
  archived: [],
  cancelled: [],
};
export async function transitionEmployeeStatus(
  pool: DatabasePool,
  input: EmployeeInput & { body: EmployeeStatusTransitionRequest },
): Promise<EmployeeStatusChange> {
  return runInTenantContext(pool, input, async (tx) => {
    const visible = await tx.query<Pick<EmployeeRow, 'id' | 'status'>>(
      `select id,status from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) for update`,
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    const current = visible.rows[0];
    if (!current) throw new HrEmployeeNotFoundError();
    const { toStatus, effectiveAt, reason } = input.body;
    if (!employeeStatusTransitions[current.status].includes(toStatus)) {
      throw new HrEmployeeStatusConflictError();
    }
    if (current.status === 'inactive' && toStatus === 'active') {
      if (reason === undefined) throw new HrEmployeeStatusReasonError();
    } else if (reason !== undefined) {
      throw new HrEmployeeStatusReasonError();
    }
    const created = await tx.query<EmployeeStatusChangeRow>(
      `insert into app.employee_status_change (organization_id,employee_id,from_status,to_status,effective_at,reason,created_by) values ($1,$2,$3,$4,$5::timestamptz,$6,$7) returning id,employee_id,from_status,to_status,effective_at,reason,created_at`,
      [
        input.organizationId,
        input.employeeId,
        current.status,
        toStatus,
        effectiveAt,
        reason ?? null,
        input.userId,
      ],
    );
    await tx.query(
      'update app.employee set status=$2,updated_at=now() where id=$1',
      [input.employeeId, toStatus],
    );
    await tx.query(
      "select app.record_audit('employee.status_transitioned', 'employee', $1, '{}'::jsonb)",
      [input.employeeId],
    );
    return employeeStatusChange(created.rows[0]!);
  });
}
export async function listEmployeeStatusHistory(
  pool: DatabasePool,
  input: EmployeeInput & { query: EmployeeStatusHistoryQuery },
): Promise<Paged<EmployeeStatusChange>> {
  const q = input.query;
  return runInTenantContext(pool, input, async (tx) => {
    const visible = await tx.query(
      'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!visible.rowCount) throw new HrEmployeeNotFoundError();
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        'select count(*)::text as count from app.employee_status_change where employee_id=$1',
        [input.employeeId],
      ),
      tx.query<EmployeeStatusChangeRow>(
        'select id,employee_id,from_status,to_status,effective_at,reason,created_at from app.employee_status_change where employee_id=$1 order by effective_at desc, created_at desc, id asc limit $2 offset $3',
        [input.employeeId, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: rows.rows.map(employeeStatusChange),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function listRelationships(
  pool: DatabasePool,
  input: EmployeeInput,
): Promise<EmploymentRelationship[]> {
  return runInTenantContext(pool, input, async (tx) =>
    (
      await tx.query(
        `select r.* from app.employment_relationship r join app.employee e on e.id=r.employee_id where r.employee_id=$1 and ($2::uuid[] is null or e.legal_entity_id=any($2::uuid[])) order by r.start_date desc`,
        [input.employeeId, entityFilter(input.legalEntityIds)],
      )
    ).rows.map(relationship),
  );
}
export async function listEmploymentTerms(
  pool: DatabasePool,
  input: EmployeeInput & { query: EmploymentTermListQuery },
): Promise<Paged<EmploymentTerm>> {
  const q = input.query;
  return runInTenantContext(pool, input, async (tx) => {
    const employeeVisible = await tx.query<{ legal_entity_id: string }>(
      'select legal_entity_id from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!employeeVisible.rowCount) throw new HrTermNotFoundError();
    if (
      q.relationshipId &&
      !(
        await tx.query(
          'select 1 from app.employment_relationship where id=$1 and employee_id=$2',
          [q.relationshipId, input.employeeId],
        )
      ).rowCount
    )
      throw new HrTermNotFoundError();
    const historyWhere = `where t.employee_id=$1 and ($2::uuid is null or t.relationship_id=$2)`;
    const historyParams = [input.employeeId, q.relationshipId ?? null];
    const currentParams = [...historyParams, q.effectiveOn];
    const currentCandidates = `select t.*, row_number() over (partition by t.relationship_id order by t.effective_from desc, t.version desc, t.id asc) as term_rank from app.employment_term t ${historyWhere} and t.effective_from <= $3 and (t.effective_to is null or t.effective_to >= $3) and not exists (select 1 from app.employment_term successor where successor.supersedes_employment_term_id=t.id and successor.effective_from <= $3)`;
    const countSql = q.effectiveOn
      ? `with ranked as (${currentCandidates}) select count(*)::text as count from ranked where term_rank=1`
      : `select count(*)::text as count from app.employment_term t ${historyWhere}`;
    const rowsSql = q.effectiveOn
      ? `with ranked as (${currentCandidates}) select * from ranked where term_rank=1 order by effective_from desc, version desc, id asc limit $4 offset $5`
      : `select t.* from app.employment_term t ${historyWhere} order by t.effective_from desc, t.version desc, t.id asc limit $3 offset $4`;
    const countParams = q.effectiveOn ? currentParams : historyParams;
    const rowsParams = q.effectiveOn
      ? [...currentParams, q.pageSize, (q.page - 1) * q.pageSize]
      : [...historyParams, q.pageSize, (q.page - 1) * q.pageSize];
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(countSql, countParams),
      tx.query<EmploymentTermRow>(rowsSql, rowsParams),
    ]);
    return {
      items: rows.rows.map(employmentTerm),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function createEmploymentTerm(
  pool: DatabasePool,
  input: EmployeeInput & { body: CreateEmploymentTermRequest },
): Promise<EmploymentTerm | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body;
    const employeeResult = await tx.query<{ legal_entity_id: string }>(
      'select legal_entity_id from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    const legalEntityId = employeeResult.rows[0]?.legal_entity_id;
    if (!legalEntityId) return null;
    const relationshipResult = await tx.query<{ id: string }>(
      'select id from app.employment_relationship where id=$1 and employee_id=$2',
      [b.relationshipId, input.employeeId],
    );
    if (!relationshipResult.rowCount) return null;
    await tx.query(
      'select pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [b.relationshipId],
    );
    const referenceChecks: Array<[string | null, string]> = [
      [b.positionId, 'hr_position'],
      [b.departmentId, 'hr_department'],
      [b.costCentreId, 'hr_cost_centre'],
      [b.workplaceId, 'hr_workplace'],
    ];
    for (const [id, table] of referenceChecks) {
      if (
        id &&
        !(
          await tx.query(
            `select 1 from app.${table} where id=$1 and legal_entity_id=$2`,
            [id, legalEntityId],
          )
        ).rowCount
      )
        return null;
    }
    if (
      b.managerEmployeeId &&
      !(
        await tx.query(
          'select 1 from app.employee where id=$1 and legal_entity_id=$2 and ($3::uuid[] is null or legal_entity_id=any($3::uuid[]))',
          [
            b.managerEmployeeId,
            legalEntityId,
            entityFilter(input.legalEntityIds),
          ],
        )
      ).rowCount
    )
      return null;
    const predecessor = b.supersedesEmploymentTermId
      ? await tx.query<EmploymentTermRow>(
          'select * from app.employment_term where id=$1 and relationship_id=$2',
          [b.supersedesEmploymentTermId, b.relationshipId],
        )
      : null;
    if (b.supersedesEmploymentTermId && !predecessor?.rowCount) return null;
    const existing = await tx.query<{ id: string }>(
      'select id from app.employment_term where relationship_id=$1 and ($2::uuid is null or supersedes_employment_term_id=$2) limit 1',
      [b.relationshipId, b.supersedesEmploymentTermId],
    );
    if (existing.rowCount) throw new HrTermConflictError();
    const predecessorRow = predecessor?.rows[0];
    const version = predecessorRow ? predecessorRow.version + 1 : 1;
    const inserted = await tx.query<EmploymentTermRow>(
      `insert into app.employment_term (organization_id,employee_id,relationship_id,version,supersedes_employment_term_id,effective_from,effective_to,position_id,department_id,cost_centre_id,workplace_id,manager_employee_id,weekly_hours,working_time_pattern,created_by) values ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13::numeric,$14,$15) returning *`,
      [
        input.organizationId,
        input.employeeId,
        b.relationshipId,
        version,
        b.supersedesEmploymentTermId,
        b.effectiveFrom,
        b.effectiveTo,
        b.positionId,
        b.departmentId,
        b.costCentreId,
        b.workplaceId,
        b.managerEmployeeId,
        b.weeklyHours,
        b.workingTimePattern,
        input.userId,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (!insertedRow)
      throw new Error('Employment term insert did not return a row.');
    await tx.query(
      "select app.record_audit('employment_term.created', 'employment_term', $1, '{}'::jsonb)",
      [insertedRow.id],
    );
    return employmentTerm(insertedRow);
  });
}
export class HrTermConflictError extends Error {}
export class HrTermNotFoundError extends Error {}
export async function createRelationship(
  pool: DatabasePool,
  input: EmployeeInput & { body: CreateEmploymentRelationshipRequest },
): Promise<EmploymentRelationship | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const visible = await tx.query(
      'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!visible.rowCount) return null;
    const b = input.body;
    const r = await tx.query(
      `insert into app.employment_relationship (organization_id,employee_id,kind,position,department,cost_centre,weekly_hours,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10) returning *`,
      [
        input.organizationId,
        input.employeeId,
        b.kind,
        b.position,
        b.department,
        b.costCentre,
        b.weeklyHours,
        b.startDate,
        b.endDate,
        input.userId,
      ],
    );
    await tx.query(
      "select app.record_audit('employment_relationship.created', 'employment_relationship', $1, '{}'::jsonb)",
      [r.rows[0].id],
    );
    return relationship(r.rows[0]);
  });
}
export async function linkEmployeeDocument(
  pool: DatabasePool,
  input: EmployeeInput & { body: LinkEmployeeDocumentRequest },
): Promise<EmployeeDocument> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body;
    const visible = await tx.query(
      `select e.id from app.employee e join app.document d on d.id=$2 and d.organization_id=e.organization_id and d.legal_entity_id=e.legal_entity_id join app.hr_document_category c on c.id=$3 and c.organization_id=e.organization_id and c.legal_entity_id=e.legal_entity_id and c.confidentiality='operational' where e.id=$1 and ($4::uuid[] is null or e.legal_entity_id=any($4::uuid[]))`,
      [
        input.employeeId,
        b.documentId,
        b.categoryId,
        entityFilter(input.legalEntityIds),
      ],
    );
    if (!visible.rowCount) throw new HrEmployeeDocumentNotFoundError();
    const dependencies = await tx.query(
      `select 1 where ($1::uuid is null or exists (select 1 from app.employment_relationship where id=$1 and employee_id=$2)) and ($3::uuid is null or exists (select 1 from app.employee_document p join app.hr_document_category c on c.id=p.category_id where p.employee_id=$2 and p.document_id=$3 and p.category_id=$4 and c.confidentiality='operational'))`,
      [
        b.relationshipId,
        input.employeeId,
        b.supersedesDocumentId,
        b.categoryId,
      ],
    );
    if (!dependencies.rowCount) throw new HrEmployeeDocumentNotFoundError();
    const r = await tx.query(
      `insert into app.employee_document (organization_id,employee_id,document_id,category_id,relationship_id,supersedes_document_id,approval_status,created_by)
       select $1,$2,$3,$4,$5,$6,case when c.requires_approval then 'pending' else 'not_required' end,$7 from app.hr_document_category c where c.id=$4
       returning document_id,(select title from app.document where id=document_id) as title,(select document_date from app.document where id=document_id) as document_date,category_id,relationship_id,approval_status,approved_by,approved_at,supersedes_document_id,created_at`,
      [
        input.organizationId,
        input.employeeId,
        b.documentId,
        b.categoryId,
        b.relationshipId,
        b.supersedesDocumentId,
        input.userId,
      ],
    );
    if (!r.rowCount) throw new HrEmployeeDocumentConflictError();
    await tx.query(
      "select app.record_audit('employee_document.linked', 'employee_document', $1, '{}'::jsonb)",
      [b.documentId],
    );
    return employeeDocument(r.rows[0]);
  });
}
export async function listEmployeeDocuments(
  pool: DatabasePool,
  input: EmployeeInput & { query?: EmployeeDocumentListQuery },
): Promise<Paged<EmployeeDocument>> {
  const q = input.query ?? { page: 1, pageSize: 25, currentOnly: true };
  return runInTenantContext(pool, input, async (tx) => {
    const visible = await tx.query(
      'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!visible.rowCount) throw new HrEmployeeDocumentNotFoundError();
    const where = `where l.employee_id=$1 and (l.category_id is null or c.confidentiality='operational') and ($2::uuid is null or l.category_id=$2) and ($3::text is null or l.approval_status=$3) and ($4::boolean=false or not exists (select 1 from app.employee_document successor join app.hr_document_category successor_category on successor_category.id=successor.category_id where successor.employee_id=l.employee_id and successor.supersedes_document_id=l.document_id and successor_category.confidentiality='operational'))`;
    const params = [
      input.employeeId,
      q.categoryId ?? null,
      q.approvalStatus ?? null,
      q.currentOnly,
    ];
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text as count from app.employee_document l left join app.hr_document_category c on c.id=l.category_id ${where}`,
        params,
      ),
      tx.query<EmployeeDocumentRow>(
        `select l.document_id,d.title,d.document_date,l.category_id,l.relationship_id,l.approval_status,l.approved_by,l.approved_at,l.supersedes_document_id,l.created_at from app.employee_document l join app.document d on d.id=l.document_id left join app.hr_document_category c on c.id=l.category_id ${where} order by l.created_at desc,l.document_id asc limit $5 offset $6`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: rows.rows.map(employeeDocument),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function updateEmployeeDocument(
  pool: DatabasePool,
  input: EmployeeInput & {
    documentId: string;
    body: UpdateEmployeeDocumentRequest;
  },
): Promise<EmployeeDocument> {
  return runInTenantContext(pool, input, async (tx) => {
    const existing = await tx.query<
      EmployeeDocumentRow & { requires_approval: boolean | null }
    >(
      `select l.document_id,d.title,d.document_date,l.category_id,l.relationship_id,l.approval_status,l.approved_by,l.approved_at,l.supersedes_document_id,l.created_at,c.requires_approval from app.employee_document l join app.employee e on e.id=l.employee_id join app.document d on d.id=l.document_id left join app.hr_document_category c on c.id=l.category_id where l.employee_id=$1 and l.document_id=$2 and ($3::uuid[] is null or e.legal_entity_id=any($3::uuid[])) and (l.category_id is null or c.confidentiality='operational') for update of l`,
      [input.employeeId, input.documentId, entityFilter(input.legalEntityIds)],
    );
    if (!existing.rowCount) throw new HrEmployeeDocumentNotFoundError();
    const old = existing.rows[0];
    if (!old) throw new HrEmployeeDocumentNotFoundError();
    const b = input.body;
    if (old.category_id === null && b.categoryId === undefined)
      throw new HrEmployeeDocumentNotFoundError();
    const categoryId =
      b.categoryId === undefined ? old.category_id : b.categoryId;
    const relationshipId =
      b.relationshipId === undefined ? old.relationship_id : b.relationshipId;
    const predecessor =
      b.supersedesDocumentId === undefined
        ? old.supersedes_document_id
        : b.supersedesDocumentId;
    const dependency = await tx.query(
      `select 1 where ($1::uuid is null or exists (select 1 from app.hr_document_category c join app.employee e on e.legal_entity_id=c.legal_entity_id where c.id=$1 and c.confidentiality='operational' and e.id=$2)) and ($3::uuid is null or exists (select 1 from app.employment_relationship where id=$3 and employee_id=$2)) and ($4::uuid is null or exists (select 1 from app.employee_document p where p.employee_id=$2 and p.document_id=$4 and p.category_id=$1))`,
      [categoryId, input.employeeId, relationshipId, predecessor],
    );
    if (!dependency.rowCount || predecessor === input.documentId)
      throw new HrEmployeeDocumentNotFoundError();
    const requiresApproval =
      b.categoryId === undefined
        ? (old.requires_approval ?? false)
        : ((
            await tx.query<{ requires_approval: boolean }>(
              'select requires_approval from app.hr_document_category where id=$1',
              [categoryId],
            )
          ).rows[0]?.requires_approval ?? false);
    const nextApprovalStatus =
      b.categoryId === undefined
        ? old.approval_status
        : requiresApproval
          ? 'pending'
          : 'not_required';
    if (b.approvalDecision && nextApprovalStatus !== 'pending')
      throw new HrEmployeeDocumentConflictError();
    const row = await tx.query<EmployeeDocumentRow>(
      `update app.employee_document l set category_id=$3,relationship_id=$4,supersedes_document_id=$5,approval_status=case when $7::text is not null then $7 when $6::boolean then case when coalesce((select requires_approval from app.hr_document_category where id=$3), false) then 'pending' else 'not_required' end else l.approval_status end,approved_by=case when $7::text is not null then $8 when $6::boolean then null else l.approved_by end,approved_at=case when $7::text is not null then now() when $6::boolean then null else l.approved_at end where l.employee_id=$1 and l.document_id=$2 returning l.document_id,(select title from app.document where id=l.document_id) as title,(select document_date from app.document where id=l.document_id) as document_date,l.category_id,l.relationship_id,l.approval_status,l.approved_by,l.approved_at,l.supersedes_document_id,l.created_at`,
      [
        input.employeeId,
        input.documentId,
        categoryId,
        relationshipId,
        predecessor,
        b.categoryId !== undefined,
        b.approvalDecision ?? null,
        input.userId,
      ],
    );
    if (!row.rowCount) throw new HrEmployeeDocumentConflictError();
    await tx.query(
      "select app.record_audit('employee_document.updated', 'employee_document', $1, '{}'::jsonb)",
      [input.documentId],
    );
    const updated = row.rows[0];
    if (!updated) throw new HrEmployeeDocumentConflictError();
    return employeeDocument(updated);
  });
}
interface ChecklistTemplateRow {
  id: string;
  legal_entity_id: string;
  kind: ChecklistTemplate['kind'];
  code: string;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}
interface ChecklistTemplateItemRow {
  id: string;
  template_id: string;
  position: number;
  title: string;
  default_due_offset_days: number;
  document_category_id: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}
interface ChecklistRow {
  id: string;
  legal_entity_id: string;
  employee_id: string;
  relationship_id: string | null;
  template_id: string;
  kind: Checklist['kind'];
  status: Checklist['status'];
  started_on: string | Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface ChecklistTaskRow {
  id: string;
  checklist_id: string;
  template_item_id: string | null;
  title: string;
  owner_user_id: string;
  due_on: string | Date;
  document_category_id: string | null;
  status: ChecklistTask['status'];
  skip_reason: string | null;
  document_id: string | null;
  completed_by: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
const toTemplateItem = (
  r: ChecklistTemplateItemRow,
): ChecklistTemplateItem => ({
  id: r.id,
  templateId: r.template_id,
  position: r.position,
  title: r.title,
  defaultDueOffsetDays: r.default_due_offset_days,
  documentCategoryId: r.document_category_id,
  active: r.active,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const toTask = (r: ChecklistTaskRow): ChecklistTask => ({
  id: r.id,
  checklistId: r.checklist_id,
  templateItemId: r.template_item_id,
  title: r.title,
  ownerUserId: r.owner_user_id,
  dueOn: formatDate(r.due_on),
  documentCategoryId: r.document_category_id,
  status: r.status,
  skipReason: r.skip_reason,
  documentId: r.document_id,
  completedBy: r.completed_by,
  completedAt: r.completed_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
async function templateWithItems(
  tx: DatabasePool | PoolClient,
  r: ChecklistTemplateRow,
): Promise<ChecklistTemplate> {
  const items = await tx.query<ChecklistTemplateItemRow>(
    'select id,template_id,position,title,default_due_offset_days,document_category_id,active,created_at,updated_at from app.hr_checklist_template_item where template_id=$1 order by position asc,id asc',
    [r.id],
  );
  return {
    id: r.id,
    legalEntityId: r.legal_entity_id,
    kind: r.kind,
    code: r.code,
    name: r.name,
    active: r.active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    items: items.rows.map(toTemplateItem),
  };
}
async function checklistWithTasks(
  tx: DatabasePool | PoolClient,
  r: ChecklistRow,
): Promise<Checklist> {
  const tasks = await tx.query<ChecklistTaskRow>(
    'select id,checklist_id,template_item_id,title,owner_user_id,due_on,document_category_id,status,skip_reason,document_id,completed_by,completed_at,created_at,updated_at from app.hr_checklist_task where checklist_id=$1 order by due_on asc,id asc',
    [r.id],
  );
  return {
    id: r.id,
    legalEntityId: r.legal_entity_id,
    employeeId: r.employee_id,
    relationshipId: r.relationship_id,
    templateId: r.template_id,
    kind: r.kind,
    status: r.status,
    startedOn: formatDate(r.started_on),
    completedAt: r.completed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    tasks: tasks.rows.map(toTask),
  };
}
export async function listChecklistTemplates(
  pool: DatabasePool,
  input: HrScope & { query: ChecklistTemplateListQuery },
): Promise<Paged<ChecklistTemplate>> {
  const q = input.query,
    search = q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  return runInTenantContext(pool, input, async (tx) => {
    const p = [
      entityFilter(input.legalEntityIds),
      q.legalEntityId ?? null,
      q.kind ?? null,
      q.active ?? null,
      search,
    ];
    const w =
      "where ($1::uuid[] is null or legal_entity_id=any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::text is null or kind=$3) and ($4::boolean is null or active=$4) and ($5::text is null or code ilike $5 escape '\\' or name ilike $5 escape '\\')";
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.hr_checklist_template ${w}`,
        p,
      ),
      tx.query<ChecklistTemplateRow>(
        `select id,legal_entity_id,kind,code,name,active,created_at,updated_at from app.hr_checklist_template ${w} order by code asc,id asc limit $6 offset $7`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: await Promise.all(rows.rows.map((r) => templateWithItems(tx, r))),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function createChecklistTemplate(
  pool: DatabasePool,
  input: HrScope & { body: CreateChecklistTemplateRequest },
): Promise<ChecklistTemplate | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body;
    const r = await tx.query<ChecklistTemplateRow>(
      `insert into app.hr_checklist_template(organization_id,legal_entity_id,kind,code,name,created_by) select $1,$2,$3,$4,$5,$6 where exists(select 1 from app.legal_entity where id=$2 and ($7::uuid[] is null or id=any($7::uuid[]))) returning id,legal_entity_id,kind,code,name,active,created_at,updated_at`,
      [
        input.organizationId,
        b.legalEntityId,
        b.kind,
        b.code,
        b.name,
        input.userId,
        entityFilter(input.legalEntityIds),
      ],
    );
    if (!r.rowCount) return null;
    await tx.query(
      "select app.record_audit('hr_checklist_template.created','hr_checklist_template',$1,'{}'::jsonb)",
      [r.rows[0]!.id],
    );
    return templateWithItems(tx, r.rows[0]!);
  });
}
export async function updateChecklistTemplate(
  pool: DatabasePool,
  input: HrScope & { templateId: string; body: UpdateChecklistTemplateRequest },
): Promise<ChecklistTemplate | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body,
      r = await tx.query<ChecklistTemplateRow>(
        'update app.hr_checklist_template set name=coalesce($2,name),active=case when $3 then $4 else active end,updated_at=now() where id=$1 and ($5::uuid[] is null or legal_entity_id=any($5::uuid[])) returning id,legal_entity_id,kind,code,name,active,created_at,updated_at',
        [
          input.templateId,
          b.name ?? null,
          b.active !== undefined,
          b.active ?? false,
          entityFilter(input.legalEntityIds),
        ],
      );
    if (!r.rowCount) return null;
    await tx.query(
      "select app.record_audit('hr_checklist_template.updated','hr_checklist_template',$1,'{}'::jsonb)",
      [input.templateId],
    );
    return templateWithItems(tx, r.rows[0]!);
  });
}
export async function createChecklistTemplateItem(
  pool: DatabasePool,
  input: HrScope & {
    templateId: string;
    body: CreateChecklistTemplateItemRequest;
  },
): Promise<ChecklistTemplateItem | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body,
      t = await tx.query<ChecklistTemplateRow>(
        'select id,legal_entity_id,kind,code,name,active,created_at,updated_at from app.hr_checklist_template where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) for update',
        [input.templateId, entityFilter(input.legalEntityIds)],
      );
    if (!t.rowCount) return null;
    if (
      b.documentCategoryId &&
      !(
        await tx.query(
          "select 1 from app.hr_document_category where id=$1 and legal_entity_id=$2 and confidentiality='operational'",
          [b.documentCategoryId, t.rows[0]!.legal_entity_id],
        )
      ).rowCount
    )
      return null;
    const r = await tx.query<ChecklistTemplateItemRow>(
      'insert into app.hr_checklist_template_item(organization_id,template_id,position,title,default_due_offset_days,document_category_id,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id,template_id,position,title,default_due_offset_days,document_category_id,active,created_at,updated_at',
      [
        input.organizationId,
        input.templateId,
        b.position,
        b.title,
        b.defaultDueOffsetDays,
        b.documentCategoryId,
        input.userId,
      ],
    );
    await tx.query(
      "select app.record_audit('hr_checklist_template_item.created','hr_checklist_template_item',$1,'{}'::jsonb)",
      [r.rows[0]!.id],
    );
    return toTemplateItem(r.rows[0]!);
  });
}
export async function updateChecklistTemplateItem(
  pool: DatabasePool,
  input: HrScope & {
    templateId: string;
    itemId: string;
    body: UpdateChecklistTemplateItemRequest;
  },
): Promise<ChecklistTemplateItem | null> {
  return runInTenantContext(pool, input, async (tx) => {
    const old = await tx.query<
      ChecklistTemplateItemRow & { legal_entity_id: string }
    >(
      'select i.id,i.template_id,i.position,i.title,i.default_due_offset_days,i.document_category_id,i.active,i.created_at,i.updated_at,t.legal_entity_id from app.hr_checklist_template_item i join app.hr_checklist_template t on t.id=i.template_id where i.id=$1 and i.template_id=$2 and ($3::uuid[] is null or t.legal_entity_id=any($3::uuid[])) for update',
      [input.itemId, input.templateId, entityFilter(input.legalEntityIds)],
    );
    if (!old.rowCount) return null;
    const b = input.body,
      c =
        b.documentCategoryId === undefined
          ? old.rows[0]!.document_category_id
          : b.documentCategoryId;
    if (
      c &&
      !(
        await tx.query(
          "select 1 from app.hr_document_category where id=$1 and legal_entity_id=$2 and confidentiality='operational'",
          [c, old.rows[0]!.legal_entity_id],
        )
      ).rowCount
    )
      return null;
    const r = await tx.query<ChecklistTemplateItemRow>(
      'update app.hr_checklist_template_item set position=coalesce($3,position),title=coalesce($4,title),default_due_offset_days=coalesce($5,default_due_offset_days),document_category_id=$6,active=case when $7 then $8 else active end,updated_at=now() where id=$1 and template_id=$2 returning id,template_id,position,title,default_due_offset_days,document_category_id,active,created_at,updated_at',
      [
        input.itemId,
        input.templateId,
        b.position ?? null,
        b.title ?? null,
        b.defaultDueOffsetDays ?? null,
        c,
        b.active !== undefined,
        b.active ?? false,
      ],
    );
    await tx.query(
      "select app.record_audit('hr_checklist_template_item.updated','hr_checklist_template_item',$1,'{}'::jsonb)",
      [input.itemId],
    );
    return toTemplateItem(r.rows[0]!);
  });
}
export async function listChecklists(
  pool: DatabasePool,
  input: EmployeeInput & { query: ChecklistListQuery },
): Promise<Paged<Checklist>> {
  const q = input.query;
  return runInTenantContext(pool, input, async (tx) => {
    if (
      !(
        await tx.query(
          'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
          [input.employeeId, entityFilter(input.legalEntityIds)],
        )
      ).rowCount
    )
      throw new HrChecklistNotFoundError();
    const params = [
      input.employeeId,
      q.kind ?? null,
      q.status ?? null,
      q.ownerUserId ?? null,
      q.dueBefore ?? null,
    ];
    const where = `where c.employee_id=$1 and ($2::text is null or c.kind=$2) and ($3::text is null or c.status=$3) and ($4::text is null or exists(select 1 from app.hr_checklist_task t where t.checklist_id=c.id and t.owner_user_id=$4)) and ($5::date is null or exists(select 1 from app.hr_checklist_task t where t.checklist_id=c.id and t.due_on < $5::date))`;
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.hr_checklist c ${where}`,
        params,
      ),
      tx.query<ChecklistRow>(
        `select c.* from app.hr_checklist c ${where} order by (select min(t.due_on) from app.hr_checklist_task t where t.checklist_id=c.id) asc nulls last,c.id asc limit $6 offset $7`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: await Promise.all(rows.rows.map((r) => checklistWithTasks(tx, r))),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function createChecklist(
  pool: DatabasePool,
  input: EmployeeInput & { body: CreateChecklistRequest },
): Promise<Checklist> {
  return runInTenantContext(pool, input, async (tx) => {
    const b = input.body;
    const employeeRow = await tx.query<{ legal_entity_id: string }>(
      'select legal_entity_id from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) for update',
      [input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!employeeRow.rowCount) throw new HrChecklistNotFoundError();
    const template = await tx.query<ChecklistTemplateRow>(
      'select id,legal_entity_id,kind,code,name,active,created_at,updated_at from app.hr_checklist_template where id=$1 and legal_entity_id=$2 and active=true for update',
      [b.templateId, employeeRow.rows[0]!.legal_entity_id],
    );
    if (!template.rowCount) throw new HrChecklistNotFoundError();
    if (
      b.relationshipId &&
      !(
        await tx.query(
          'select 1 from app.employment_relationship where id=$1 and employee_id=$2',
          [b.relationshipId, input.employeeId],
        )
      ).rowCount
    )
      throw new HrChecklistNotFoundError();
    const items = await tx.query<ChecklistTemplateItemRow>(
      'select id,template_id,position,title,default_due_offset_days,document_category_id,active,created_at,updated_at from app.hr_checklist_template_item where template_id=$1 and active=true order by position,id for update',
      [b.templateId],
    );
    if (!items.rowCount) throw new HrChecklistConflictError();
    const checklist = await tx.query<ChecklistRow>(
      'insert into app.hr_checklist(organization_id,legal_entity_id,employee_id,relationship_id,template_id,kind,started_on,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [
        input.organizationId,
        employeeRow.rows[0]!.legal_entity_id,
        input.employeeId,
        b.relationshipId,
        b.templateId,
        template.rows[0]!.kind,
        b.startedOn,
        input.userId,
      ],
    );
    for (const item of items.rows)
      await tx.query(
        'insert into app.hr_checklist_task(organization_id,checklist_id,template_item_id,title,owner_user_id,due_on,document_category_id,created_by) values($1,$2,$3,$4,$5,$6::date + $7::integer,$8,$9)',
        [
          input.organizationId,
          checklist.rows[0]!.id,
          item.id,
          item.title,
          b.ownerUserId,
          b.startedOn,
          item.default_due_offset_days,
          item.document_category_id,
          input.userId,
        ],
      );
    await tx.query(
      "select app.record_audit('hr_checklist.created','hr_checklist',$1,'{}'::jsonb)",
      [checklist.rows[0]!.id],
    );
    return checklistWithTasks(tx, checklist.rows[0]!);
  });
}
export async function updateChecklistTask(
  pool: DatabasePool,
  input: EmployeeInput & {
    checklistId: string;
    taskId: string;
    body: UpdateChecklistTaskRequest;
  },
): Promise<ChecklistTask> {
  return runInTenantContext(pool, input, async (tx) => {
    const checklist = await tx.query<{ status: Checklist['status'] }>(
      'select c.status from app.hr_checklist c join app.employee e on e.id=c.employee_id where c.id=$1 and c.employee_id=$2 and ($3::uuid[] is null or e.legal_entity_id=any($3::uuid[])) for update',
      [input.checklistId, input.employeeId, entityFilter(input.legalEntityIds)],
    );
    if (!checklist.rowCount) throw new HrChecklistNotFoundError();
    if (checklist.rows[0]!.status !== 'open')
      throw new HrChecklistConflictError();
    const task = await tx.query<ChecklistTaskRow>(
      'select t.* from app.hr_checklist_task t where t.id=$1 and t.checklist_id=$2 for update',
      [input.taskId, input.checklistId],
    );
    const old = task.rows[0];
    if (!old) throw new HrChecklistNotFoundError();
    const b = input.body;
    if (
      (b.status === 'in_progress' && old.status !== 'pending') ||
      (b.status === 'completed' && old.status !== 'in_progress') ||
      (b.status === 'skipped' &&
        !['pending', 'in_progress'].includes(old.status))
    )
      throw new HrChecklistConflictError();
    if ((b.status === 'skipped') !== (b.skipReason !== undefined))
      throw new HrChecklistBadRequestError();
    const documentId =
      b.documentId === undefined ? old.document_id : b.documentId;
    if (b.status === 'completed' && old.document_category_id && !documentId)
      throw new HrChecklistBadRequestError();
    if (
      documentId &&
      !(
        await tx.query(
          `select 1 from app.employee_document l join app.hr_document_category c on c.id=l.category_id where l.employee_id=$1 and l.document_id=$2 and c.confidentiality='operational' and ($3::uuid is null or l.category_id=$3::uuid) and not exists(select 1 from app.employee_document s left join app.hr_document_category sc on sc.id=s.category_id where s.employee_id=l.employee_id and s.supersedes_document_id=l.document_id and (s.category_id is null or sc.confidentiality='operational'))`,
          [input.employeeId, documentId, old.document_category_id],
        )
      ).rowCount
    )
      throw new HrChecklistNotFoundError();
    const row = await tx.query<ChecklistTaskRow>(
      "update app.hr_checklist_task set status=$2,skip_reason=$3,document_id=$4,completed_by=case when $2 in ('completed','skipped') then $5 else null end,completed_at=case when $2 in ('completed','skipped') then now() else null end,updated_at=now() where id=$1 returning id,checklist_id,template_item_id,title,owner_user_id,due_on,document_category_id,status,skip_reason,document_id,completed_by,completed_at,created_at,updated_at",
      [input.taskId, b.status, b.skipReason ?? null, documentId, input.userId],
    );
    if (b.status === 'completed' || b.status === 'skipped')
      await tx.query(
        "update app.hr_checklist set status='completed',completed_at=now(),updated_at=now() where id=$1 and not exists(select 1 from app.hr_checklist_task where checklist_id=$1 and status not in ('completed','skipped'))",
        [input.checklistId],
      );
    await tx.query(
      "select app.record_audit('hr_checklist_task.updated','hr_checklist_task',$1,'{}'::jsonb)",
      [input.taskId],
    );
    return toTask(row.rows[0]!);
  });
}

export abstract class HrRepository {
  abstract listChecklistTemplates(
    input: HrScope & { query: ChecklistTemplateListQuery },
  ): Promise<Paged<ChecklistTemplate>>;
  abstract createChecklistTemplate(
    input: HrScope & { body: CreateChecklistTemplateRequest },
  ): Promise<ChecklistTemplate | null>;
  abstract updateChecklistTemplate(
    input: HrScope & {
      templateId: string;
      body: UpdateChecklistTemplateRequest;
    },
  ): Promise<ChecklistTemplate | null>;
  abstract createChecklistTemplateItem(
    input: HrScope & {
      templateId: string;
      body: CreateChecklistTemplateItemRequest;
    },
  ): Promise<ChecklistTemplateItem | null>;
  abstract updateChecklistTemplateItem(
    input: HrScope & {
      templateId: string;
      itemId: string;
      body: UpdateChecklistTemplateItemRequest;
    },
  ): Promise<ChecklistTemplateItem | null>;
  abstract listChecklists(
    input: EmployeeInput & { query: ChecklistListQuery },
  ): Promise<Paged<Checklist>>;
  abstract createChecklist(
    input: EmployeeInput & { body: CreateChecklistRequest },
  ): Promise<Checklist>;
  abstract updateChecklistTask(
    input: EmployeeInput & {
      checklistId: string;
      taskId: string;
      body: UpdateChecklistTaskRequest;
    },
  ): Promise<ChecklistTask>;
  abstract listEmployees(
    input: HrScope & { query?: EmployeeListQuery },
  ): Promise<Paged<Employee>>;
  abstract readEmployee(input: EmployeeInput): Promise<Employee | null>;
  abstract createEmployee(
    input: HrScope & { body: CreateEmployeeRequest },
  ): Promise<Employee | null>;
  abstract updateEmployee(
    input: EmployeeInput & { body: UpdateEmployeeRequest },
  ): Promise<Employee | null>;
  abstract transitionEmployeeStatus(
    input: EmployeeInput & { body: EmployeeStatusTransitionRequest },
  ): Promise<EmployeeStatusChange>;
  abstract listEmployeeStatusHistory(
    input: EmployeeInput & { query: EmployeeStatusHistoryQuery },
  ): Promise<Paged<EmployeeStatusChange>>;
  abstract listRelationships(
    input: EmployeeInput,
  ): Promise<EmploymentRelationship[]>;
  abstract createRelationship(
    input: EmployeeInput & { body: CreateEmploymentRelationshipRequest },
  ): Promise<EmploymentRelationship | null>;
  abstract listEmploymentTerms(
    input: EmployeeInput & { query: EmploymentTermListQuery },
  ): Promise<Paged<EmploymentTerm>>;
  abstract createEmploymentTerm(
    input: EmployeeInput & { body: CreateEmploymentTermRequest },
  ): Promise<EmploymentTerm | null>;
  abstract linkEmployeeDocument(
    input: EmployeeInput & { body: LinkEmployeeDocumentRequest },
  ): Promise<EmployeeDocument>;
  abstract listEmployeeDocuments(
    input: EmployeeInput & { query?: EmployeeDocumentListQuery },
  ): Promise<Paged<EmployeeDocument>>;
  abstract updateEmployeeDocument(
    input: EmployeeInput & {
      documentId: string;
      body: UpdateEmployeeDocumentRequest;
    },
  ): Promise<EmployeeDocument>;
}
@Injectable()
export class DatabaseHrRepository
  extends HrRepository
  implements OnModuleDestroy
{
  async listChecklistTemplates(
    i: HrScope & { query: ChecklistTemplateListQuery },
  ) {
    return listChecklistTemplates(await this.getPool(), i);
  }
  async createChecklistTemplate(
    i: HrScope & { body: CreateChecklistTemplateRequest },
  ) {
    return createChecklistTemplate(await this.getPool(), i);
  }
  async updateChecklistTemplate(
    i: HrScope & { templateId: string; body: UpdateChecklistTemplateRequest },
  ) {
    return updateChecklistTemplate(await this.getPool(), i);
  }
  async createChecklistTemplateItem(
    i: HrScope & {
      templateId: string;
      body: CreateChecklistTemplateItemRequest;
    },
  ) {
    return createChecklistTemplateItem(await this.getPool(), i);
  }
  async updateChecklistTemplateItem(
    i: HrScope & {
      templateId: string;
      itemId: string;
      body: UpdateChecklistTemplateItemRequest;
    },
  ) {
    return updateChecklistTemplateItem(await this.getPool(), i);
  }
  async listChecklists(i: EmployeeInput & { query: ChecklistListQuery }) {
    return listChecklists(await this.getPool(), i);
  }
  async createChecklist(i: EmployeeInput & { body: CreateChecklistRequest }) {
    return createChecklist(await this.getPool(), i);
  }
  async updateChecklistTask(
    i: EmployeeInput & {
      checklistId: string;
      taskId: string;
      body: UpdateChecklistTaskRequest;
    },
  ) {
    return updateChecklistTask(await this.getPool(), i);
  }
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise !== undefined) await (await this.poolPromise).end();
  }
  async listEmployees(i: HrScope) {
    return listEmployees(await this.getPool(), i);
  }
  async readEmployee(i: EmployeeInput) {
    return readEmployee(await this.getPool(), i);
  }
  async createEmployee(i: HrScope & { body: CreateEmployeeRequest }) {
    return createEmployee(await this.getPool(), i);
  }
  async updateEmployee(i: EmployeeInput & { body: UpdateEmployeeRequest }) {
    return updateEmployee(await this.getPool(), i);
  }
  async transitionEmployeeStatus(
    i: EmployeeInput & { body: EmployeeStatusTransitionRequest },
  ) {
    return transitionEmployeeStatus(await this.getPool(), i);
  }
  async listEmployeeStatusHistory(
    i: EmployeeInput & { query: EmployeeStatusHistoryQuery },
  ) {
    return listEmployeeStatusHistory(await this.getPool(), i);
  }
  async listRelationships(i: EmployeeInput) {
    return listRelationships(await this.getPool(), i);
  }
  async createRelationship(
    i: EmployeeInput & { body: CreateEmploymentRelationshipRequest },
  ) {
    return createRelationship(await this.getPool(), i);
  }
  async listEmploymentTerms(
    i: EmployeeInput & { query: EmploymentTermListQuery },
  ) {
    return listEmploymentTerms(await this.getPool(), i);
  }
  async createEmploymentTerm(
    i: EmployeeInput & { body: CreateEmploymentTermRequest },
  ) {
    return createEmploymentTerm(await this.getPool(), i);
  }
  async linkEmployeeDocument(
    i: EmployeeInput & { body: LinkEmployeeDocumentRequest },
  ) {
    return linkEmployeeDocument(await this.getPool(), i);
  }
  async listEmployeeDocuments(
    i: EmployeeInput & { query?: EmployeeDocumentListQuery },
  ) {
    return listEmployeeDocuments(await this.getPool(), i);
  }
  async updateEmployeeDocument(
    i: EmployeeInput & {
      documentId: string;
      body: UpdateEmployeeDocumentRequest;
    },
  ) {
    return updateEmployeeDocument(await this.getPool(), i);
  }
  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
