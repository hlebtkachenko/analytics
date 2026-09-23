import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';
import type {
  CreateEmployeeUserBinding,
  EmployeeUserBinding,
  MyHrDocument,
  MyHrPayslip,
  MyHrProfile,
} from './contract.js';
import type { Employee, EmploymentRelationship } from '../hr/contract.js';

export class EmployeeUserBindingConflictError extends Error {}
export class EmployeeUserBindingNotFoundError extends Error {}
export class MyHrBindingNotFoundError extends Error {}
type Row = {
  id: string;
  legal_entity_id: string;
  employee_id: string;
  user_id: string;
  status: EmployeeUserBinding['status'];
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
const columns =
  'id, legal_entity_id, employee_id, user_id, status, verified_at, created_at, updated_at';
const binding = (row: Row): EmployeeUserBinding => ({
  id: row.id,
  legalEntityId: row.legal_entity_id,
  employeeId: row.employee_id,
  userId: row.user_id,
  status: row.status,
  verifiedAt: row.verified_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
type EmployeeRow = {
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
};
type RelationshipRow = {
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
};
type DocumentRow = {
  document_id: string;
  title: string;
  document_date: string | Date;
  category_id: string | null;
  relationship_id: string | null;
  approval_status: MyHrDocument['approvalStatus'];
  approved_at: Date | null;
  created_at: Date;
};
type PayslipRow = {
  payroll_run_id: string;
  payroll_month: string | Date;
  version: number;
  status: MyHrPayslip['status'];
  document_id: string;
  finalized_at: Date | null;
  paid_at: Date | null;
};
const date = (value: string | Date) =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
const ownEmployee = (row: EmployeeRow): Employee => ({
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
});
const ownRelationship = (row: RelationshipRow): EmploymentRelationship => ({
  id: row.id,
  employeeId: row.employee_id,
  kind: row.kind,
  position: row.position,
  department: row.department,
  costCentre: row.cost_centre,
  weeklyHours: row.weekly_hours,
  startDate: date(row.start_date),
  endDate: row.end_date === null ? null : date(row.end_date),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const ownDocument = (row: DocumentRow): MyHrDocument => ({
  documentId: row.document_id,
  title: row.title,
  documentDate: date(row.document_date),
  categoryId: row.category_id,
  relationshipId: row.relationship_id,
  approvalStatus: row.approval_status,
  approvedAt: row.approved_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
});
const ownPayslip = (row: PayslipRow): MyHrPayslip => ({
  payrollRunId: row.payroll_run_id,
  month: date(row.payroll_month).slice(0, 7),
  version: row.version,
  status: row.status,
  documentId: row.document_id,
  finalizedAt: row.finalized_at?.toISOString() ?? null,
  paidAt: row.paid_at?.toISOString() ?? null,
});
export abstract class HrSelfServiceRepository {
  abstract create(
    input: TenantContext & { body: CreateEmployeeUserBinding },
  ): Promise<EmployeeUserBinding>;
  abstract list(
    input: TenantContext & {
      legalEntityIds: readonly string[] | null;
      query: {
        legalEntityId?: string | undefined;
        status?: EmployeeUserBinding['status'] | undefined;
        page: number;
        pageSize: number;
      };
    },
  ): Promise<{ items: EmployeeUserBinding[]; total: number }>;
  abstract verify(
    input: TenantContext & { id: string },
  ): Promise<EmployeeUserBinding>;
  abstract revoke(input: TenantContext & { id: string }): Promise<void>;
  abstract access(
    input: TenantContext,
  ): Promise<{ employeeId: string; legalEntityId: string } | null>;
  abstract profile(input: TenantContext): Promise<MyHrProfile>;
  abstract documents(
    input: TenantContext & { query: { page: number; pageSize: number } },
  ): Promise<{ items: MyHrDocument[]; total: number }>;
  abstract payslips(
    input: TenantContext & {
      query: {
        fromMonth?: string | undefined;
        toMonth?: string | undefined;
        page: number;
        pageSize: number;
      };
    },
  ): Promise<{ items: MyHrPayslip[]; total: number }>;
}
@Injectable()
export class DatabaseHrSelfServiceRepository
  extends HrSelfServiceRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise) await (await this.poolPromise).end();
  }
  async list(
    input: TenantContext & {
      legalEntityIds: readonly string[] | null;
      query: {
        legalEntityId?: string | undefined;
        status?: EmployeeUserBinding['status'] | undefined;
        page: number;
        pageSize: number;
      };
    },
  ) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const where = `organization_id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) and ($3::uuid is null or legal_entity_id=$3) and ($4::text is null or status=$4)`;
      const values = [
        input.organizationId,
        input.legalEntityIds,
        input.query.legalEntityId ?? null,
        input.query.status ?? null,
      ];
      const count = await tx.query<{ total: number }>(
        `select count(*)::integer as total from app.employee_user_binding where ${where}`,
        values,
      );
      const rows = await tx.query<Row>(
        `select ${columns} from app.employee_user_binding where ${where} order by legal_entity_id, employee_id, id limit $5 offset $6`,
        [
          ...values,
          input.query.pageSize,
          (input.query.page - 1) * input.query.pageSize,
        ],
      );
      return {
        items: rows.rows.map(binding),
        total: count.rows[0]?.total ?? 0,
      };
    });
  }
  async create(input: TenantContext & { body: CreateEmployeeUserBinding }) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      try {
        const result = await tx.query<Row>(
          `insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by) values ($1,$2,$3,$4,$5) returning ${columns}`,
          [
            input.organizationId,
            input.body.legalEntityId,
            input.body.employeeId,
            input.body.userId,
            input.userId,
          ],
        );
        const value = binding(result.rows[0]!);
        await tx.query(
          "select app.record_audit('employee_user_binding.created', 'employee_user_binding', $1, '{}'::jsonb)",
          [value.id],
        );
        return value;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error) {
          const code = (error as { code?: string }).code;
          if (code === '23505') throw new EmployeeUserBindingConflictError();
          if (code === '23503' || code === '23514')
            throw new EmployeeUserBindingNotFoundError();
        }
        throw error;
      }
    });
  }
  async verify(input: TenantContext & { id: string }) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const result = await tx.query<Row>(
        `update app.employee_user_binding set status='active', verified_at=now(), updated_at=now() where id=$1 and organization_id=$2 and user_id=$3 and status='pending' returning ${columns}`,
        [input.id, input.organizationId, input.userId],
      );
      const value = result.rows[0];
      if (!value) throw new EmployeeUserBindingNotFoundError();
      await tx.query(
        "select app.record_audit('employee_user_binding.verified', 'employee_user_binding', $1, '{}'::jsonb)",
        [value.id],
      );
      return binding(value);
    });
  }
  async revoke(input: TenantContext & { id: string }) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const result = await tx.query(
        `update app.employee_user_binding set status='revoked', updated_at=now() where id=$1 and organization_id=$2 and status <> 'revoked' returning id`,
        [input.id, input.organizationId],
      );
      if (!result.rowCount) throw new EmployeeUserBindingNotFoundError();
      await tx.query(
        "select app.record_audit('employee_user_binding.revoked', 'employee_user_binding', $1, '{}'::jsonb)",
        [input.id],
      );
    });
  }
  async access(input: TenantContext) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const result = await tx.query<{
        employee_id: string;
        legal_entity_id: string;
      }>(
        `select employee_id, legal_entity_id from app.employee_user_binding where organization_id=$1 and user_id=$2 and status='active' limit 1`,
        [input.organizationId, input.userId],
      );
      const row = result.rows[0];
      return row
        ? { employeeId: row.employee_id, legalEntityId: row.legal_entity_id }
        : null;
    });
  }
  async profile(input: TenantContext): Promise<MyHrProfile> {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const own = await this.ownBinding(tx, input);
      const employee = await tx.query<EmployeeRow>(
        `select id, legal_entity_id, employee_number, first_name, last_name, work_email, work_phone, status, created_at, updated_at from app.employee where id=$1 and legal_entity_id=$2 and organization_id=$3`,
        [own.employeeId, own.legalEntityId, input.organizationId],
      );
      if (!employee.rows[0]) throw new MyHrBindingNotFoundError();
      const relationships = await tx.query<RelationshipRow>(
        `select id, employee_id, kind, position, department, cost_centre, weekly_hours, start_date, end_date, created_at, updated_at from app.employment_relationship where employee_id=$1 and organization_id=$2 order by start_date desc, id`,
        [own.employeeId, input.organizationId],
      );
      return {
        employee: ownEmployee(employee.rows[0]),
        relationships: relationships.rows.map(ownRelationship),
      };
    });
  }
  async documents(
    input: TenantContext & { query: { page: number; pageSize: number } },
  ) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const own = await this.ownBinding(tx, input);
      const where = `l.organization_id=$1 and l.employee_id=$2 and c.legal_entity_id=$3 and c.confidentiality='operational' and l.approval_status in ('approved','not_required') and not exists (select 1 from app.employee_document successor where successor.employee_id=l.employee_id and successor.supersedes_document_id=l.document_id)`;
      const params = [input.organizationId, own.employeeId, own.legalEntityId];
      const [count, rows] = await Promise.all([
        tx.query<{ total: number }>(
          `select count(*)::integer as total from app.employee_document l join app.hr_document_category c on c.id=l.category_id and c.organization_id=l.organization_id where ${where}`,
          params,
        ),
        tx.query<DocumentRow>(
          `select l.document_id, d.title, d.document_date, l.category_id, l.relationship_id, l.approval_status, l.approved_at, l.created_at from app.employee_document l join app.document d on d.id=l.document_id and d.organization_id=l.organization_id join app.hr_document_category c on c.id=l.category_id and c.organization_id=l.organization_id where ${where} order by d.document_date desc, l.document_id limit $4 offset $5`,
          [
            ...params,
            input.query.pageSize,
            (input.query.page - 1) * input.query.pageSize,
          ],
        ),
      ]);
      return {
        items: rows.rows.map(ownDocument),
        total: count.rows[0]?.total ?? 0,
      };
    });
  }
  async payslips(
    input: TenantContext & {
      query: {
        fromMonth?: string | undefined;
        toMonth?: string | undefined;
        page: number;
        pageSize: number;
      };
    },
  ) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const own = await this.ownBinding(tx, input);
      const where = `result.organization_id=$1 and result.employee_id=$2 and run.legal_entity_id=$3 and link.kind='payslip' and run.status in ('finalized','paid','superseded') and ($4::date is null or run.payroll_month >= $4::date) and ($5::date is null or run.payroll_month <= $5::date)`;
      const params = [
        input.organizationId,
        own.employeeId,
        own.legalEntityId,
        input.query.fromMonth ? `${input.query.fromMonth}-01` : null,
        input.query.toMonth ? `${input.query.toMonth}-01` : null,
      ];
      const from = `app.payroll_result result join app.payroll_run run on run.id=result.payroll_run_id and run.organization_id=result.organization_id join app.payroll_result_document link on link.payroll_result_id=result.id and link.organization_id=result.organization_id`;
      const [count, rows] = await Promise.all([
        tx.query<{ total: number }>(
          `select count(*)::integer as total from ${from} where ${where}`,
          params,
        ),
        tx.query<PayslipRow>(
          `select run.id as payroll_run_id, run.payroll_month, run.version, run.status, link.document_id, run.finalized_at, run.paid_at from ${from} where ${where} order by run.payroll_month desc, run.version desc, run.id limit $6 offset $7`,
          [
            ...params,
            input.query.pageSize,
            (input.query.page - 1) * input.query.pageSize,
          ],
        ),
      ]);
      return {
        items: rows.rows.map(ownPayslip),
        total: count.rows[0]?.total ?? 0,
      };
    });
  }
  private async ownBinding(
    tx: {
      query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
    },
    input: TenantContext,
  ) {
    const binding = await tx.query<{
      employee_id: string;
      legal_entity_id: string;
    }>(
      `select binding.employee_id, binding.legal_entity_id from app.employee_user_binding binding join app.employee employee on employee.id=binding.employee_id and employee.legal_entity_id=binding.legal_entity_id and employee.organization_id=binding.organization_id where binding.organization_id=$1 and binding.user_id=$2 and binding.status='active' limit 1`,
      [input.organizationId, input.userId],
    );
    const row = binding.rows[0];
    if (!row) throw new MyHrBindingNotFoundError();
    return { employeeId: row.employee_id, legalEntityId: row.legal_entity_id };
  }
  private pool() {
    return (this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool));
  }
}
