import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';
import { entityFilter } from '../documents/sql.js';
import { openDataset } from '../ingestion/parser.js';
import {
  deleteStagedFile,
  loadStagingDirectory,
  resolveStagedFilePath,
} from '../ingestion/staging.js';
import type { PayrollImport } from './contract.js';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown) =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
const importColumns = [
  'employeeNumber',
  'grossPay',
  'employeeSocial',
  'employeeHealth',
  'incomeTax',
  'otherDeductions',
  'netPay',
  'employerSocial',
  'employerHealth',
  'employerCost',
] as const;
const componentColumn = /^component:[A-Za-z0-9_-]{1,64}$/;
function shape(r: Record<string, unknown>): PayrollImport {
  return {
    id: String(r.id),
    legalEntityId: String(r.legal_entity_id),
    sourceDocumentId: String(r.source_document_id),
    payrollMonth: day(r.payroll_month),
    format: r.format as 'csv' | 'xlsx',
    status: r.status as PayrollImport['status'],
    rowCount: Number(r.row_count),
    errorCount: Number(r.error_count),
    errorReport: (r.error_report ?? []) as PayrollImport['errorReport'],
    payrollRunId: r.payroll_run_id === null ? null : String(r.payroll_run_id),
    createdAt: iso(r.created_at),
  };
}
export abstract class PayrollImportRepository {
  abstract create(
    i: TenantContext & {
      legalEntityId: string;
      payrollMonth: string;
      format: 'csv' | 'xlsx';
      filename: string;
      byteSize: number;
      idempotencyKey: string;
      uploadId: string;
    },
  ): Promise<{ import: PayrollImport; replay: boolean }>;
  abstract get(
    i: TenantContext & { id: string; legalEntityIds: readonly string[] | null },
  ): Promise<PayrollImport | null>;
  abstract failEnqueue(i: TenantContext & { id: string }): Promise<void>;
  abstract consume(
    i: TenantContext & { id: string; legalEntityIds: readonly string[] | null },
  ): Promise<{ runId: string; replay: boolean; status: string } | null>;
}
export class PayrollImportEntityNotFoundError extends Error {}
@Injectable()
export class DatabasePayrollImportRepository
  extends PayrollImportRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  private getPool() {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
  async onModuleDestroy() {
    await (await this.poolPromise)?.end();
  }
  async create(i: Parameters<PayrollImportRepository['create']>[0]) {
    return runInTenantContext(await this.getPool(), i, async (tx) => {
      const entity = await tx.query(
        'select 1 from app.legal_entity where id=$1',
        [i.legalEntityId],
      );
      if (entity.rowCount !== 1) throw new PayrollImportEntityNotFoundError();
      const prior = await tx.query<Record<string, unknown>>(
        'select * from app.payroll_import where organization_id=$1 and idempotency_key=$2',
        [i.organizationId, i.idempotencyKey],
      );
      if (prior.rows[0]) return { import: shape(prior.rows[0]), replay: true };
      await tx.query(
        `insert into app.upload(id,organization_id,legal_entity_id,filename,byte_size,status) values($1,$2,$3,$4,$5,'pending')`,
        [i.uploadId, i.organizationId, i.legalEntityId, i.filename, i.byteSize],
      );
      const doc = await tx.query<{ id: string }>(
        `insert into app.document(organization_id,legal_entity_id,kind,source,title,document_date,created_by) values($1,$2,'payroll','upload',$3,$4::date,$5) returning id`,
        [
          i.organizationId,
          i.legalEntityId,
          'Payroll import',
          i.payrollMonth,
          i.userId,
        ],
      );
      const row = await tx.query<Record<string, unknown>>(
        `insert into app.payroll_import(organization_id,legal_entity_id,source_document_id,upload_id,idempotency_key,payroll_month,format,created_by) values($1,$2,$3,$4,$5,$6::date,$7,$8) returning *`,
        [
          i.organizationId,
          i.legalEntityId,
          doc.rows[0]!.id,
          i.uploadId,
          i.idempotencyKey,
          i.payrollMonth,
          i.format,
          i.userId,
        ],
      );
      await tx.query(
        "select app.record_audit('payroll_import.created','payroll_import',$1,'{}'::jsonb)",
        [row.rows[0]!.id],
      );
      return { import: shape(row.rows[0]!), replay: false };
    });
  }
  async get(i: Parameters<PayrollImportRepository['get']>[0]) {
    return runInTenantContext(await this.getPool(), i, async (tx) => {
      const r = await tx.query<Record<string, unknown>>(
        'select * from app.payroll_import where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
        [i.id, entityFilter(i.legalEntityIds)],
      );
      return r.rows[0] ? shape(r.rows[0]) : null;
    });
  }
  async failEnqueue(i: Parameters<PayrollImportRepository['failEnqueue']>[0]) {
    await runInTenantContext(await this.getPool(), i, async (tx) => {
      await tx.query(
        `update app.payroll_import set status='failed',error_count=0,
         error_report='[]'::jsonb, updated_at=now() where id=$1 and status='staged'`,
        [i.id],
      );
      await tx.query(
        `update app.upload set status='failed',error='The payroll import job could not be enqueued.',updated_at=now()
         where id=(select upload_id from app.payroll_import where id=$1)`,
        [i.id],
      );
      await tx.query(
        "select app.record_audit('payroll_import.enqueue_failed','payroll_import',$1,'{}'::jsonb)",
        [i.id],
      );
    });
  }
  async consume(i: Parameters<PayrollImportRepository['consume']>[0]) {
    let consumedUploadId: string | undefined;
    const consumed = await runInTenantContext(
      await this.getPool(),
      i,
      async (tx) => {
        const q = await tx.query<Record<string, unknown>>(
          `select i.*,u.filename from app.payroll_import i
         join app.upload u on u.id=i.upload_id and u.organization_id=i.organization_id
           and u.legal_entity_id=i.legal_entity_id
         where i.id=$1 and ($2::uuid[] is null or i.legal_entity_id=any($2::uuid[])) for update`,
          [i.id, entityFilter(i.legalEntityIds)],
        );
        const x = q.rows[0];
        if (!x) return null;
        if (x.status === 'consumed')
          return {
            runId: String(x.payroll_run_id),
            replay: true,
            status: 'draft',
          };
        if (x.status !== 'validated')
          return { runId: '', replay: false, status: String(x.status) };
        consumedUploadId = String(x.upload_id);
        const dataset = await openDataset(
          resolveStagedFilePath(
            loadStagingDirectory(process.env),
            String(x.upload_id),
          ),
          x.format as 'csv' | 'xlsx',
        );
        const columns = [...dataset.columns];
        if (
          columns.length < importColumns.length ||
          !importColumns.every((column) => columns.includes(column)) ||
          columns.some(
            (column) =>
              !importColumns.includes(
                column as (typeof importColumns)[number],
              ) && !componentColumn.test(column),
          )
        ) {
          throw new Error(
            'Validated payroll import no longer has a valid header.',
          );
        }
        const componentColumns = columns.filter((column) =>
          componentColumn.test(column),
        );
        const components = new Map<string, string>();
        for (const column of componentColumns) {
          const code = column.slice('component:'.length);
          const definition = await tx.query<{ id: string }>(
            `select id from app.payroll_component_definition
           where legal_entity_id=$1 and code=$2 and active=true`,
            [x.legal_entity_id, code],
          );
          if (definition.rows[0] === undefined)
            throw new Error(
              'Validated payroll import component no longer exists.',
            );
          components.set(column, definition.rows[0].id);
        }
        const rows: Array<{
          employeeId: string;
          values: Record<string, string>;
        }> = [];
        for await (const values of dataset.rows) {
          const row = Object.fromEntries(
            columns.map((column, index) => [
              column,
              values[index] === null ? '' : String(values[index]),
            ]),
          ) as Record<string, string>;
          const employee = await tx.query<{ id: string }>(
            `select id from app.employee where legal_entity_id=$1 and employee_number=$2`,
            [x.legal_entity_id, row.employeeNumber],
          );
          if (employee.rows[0] === undefined)
            throw new Error(
              'Validated payroll import employee no longer exists.',
            );
          rows.push({ employeeId: employee.rows[0].id, values: row });
        }
        if (rows.length !== Number(x.row_count))
          throw new Error('Validated payroll import rows have changed.');
        const run = await tx.query<{ id: string }>(
          `insert into app.payroll_run(organization_id,legal_entity_id,document_id,payroll_month,version,status,origin,created_by) values($1,$2,null,$3,1,'draft','imported',$4) returning id`,
          [i.organizationId, x.legal_entity_id, x.payroll_month, i.userId],
        );
        for (const row of rows) {
          const result = await tx.query<{ id: string }>(
            `insert into app.payroll_result(organization_id,payroll_run_id,employee_id,gross_pay,employee_social,employee_health,income_tax,other_deductions,net_pay,employer_social,employer_health,employer_cost)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
            [
              i.organizationId,
              run.rows[0]!.id,
              row.employeeId,
              ...importColumns.slice(1).map((column) => row.values[column]),
            ],
          );
          for (const column of componentColumns) {
            const value = row.values[column]?.trim();
            if (!value) continue;
            await tx.query(
              `insert into app.payroll_result_component(organization_id,payroll_result_id,component_definition_id,amount,source,created_by)
             values($1,$2,$3,$4,'imported',$5)`,
              [
                i.organizationId,
                result.rows[0]!.id,
                components.get(column),
                value,
                i.userId,
              ],
            );
          }
        }
        await tx.query(
          "update app.payroll_import set status='consumed',payroll_run_id=$1,updated_at=now() where id=$2",
          [run.rows[0]!.id, i.id],
        );
        await tx.query(
          "select app.record_audit('payroll_import.consumed','payroll_import',$1,'{}'::jsonb)",
          [i.id],
        );
        return { runId: run.rows[0]!.id, replay: false, status: 'draft' };
      },
    );
    if (consumedUploadId && consumed?.status === 'draft' && !consumed.replay)
      await deleteStagedFile(
        loadStagingDirectory(process.env),
        consumedUploadId,
      );
    return consumed;
  }
}
