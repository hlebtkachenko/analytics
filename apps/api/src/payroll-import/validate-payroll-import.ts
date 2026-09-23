import type { DatabasePool } from '@bap/db/pool';
import { resolveMembership } from '@bap/db/access';
import { withTenantContext } from '@bap/db';
import {
  DatasetParseError,
  openDataset,
  resolveDatasetFormat,
} from '../ingestion/parser.js';
import {
  deleteStagedFile,
  resolveStagedFilePath,
} from '../ingestion/staging.js';
import { payrollImportJobSchema, type PayrollImportError } from './contract.js';

const required = [
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
const amount = /^\d+(?:\.\d{1,4})?$/;
const componentColumn = /^component:[A-Za-z0-9_-]{1,64}$/;
export async function validatePayrollImport(options: {
  data: unknown;
  pool: DatabasePool;
  stagingDirectory: string;
}): Promise<void> {
  const job = payrollImportJobSchema.parse(options.data);
  const member = await resolveMembership(options.pool, {
    organizationId: job.organizationId,
    subjectId: job.userId,
  });
  if (!member || member.role === 'member')
    throw new Error('Payroll import subject no longer has write membership.');
  const client = await options.pool.connect();
  let terminalUploadId: string | undefined;
  try {
    await withTenantContext(
      client,
      {
        organizationId: job.organizationId,
        role: member.role,
        userId: job.userId,
      },
      async (tx) => {
        const found = await tx.query<{
          id: string;
          legal_entity_id: string;
          status: string;
          upload_id: string;
          filename: string;
        }>(
          `select i.id,i.legal_entity_id,i.status,i.upload_id,u.filename from app.payroll_import i join app.upload u on u.id=i.upload_id and u.organization_id=i.organization_id and u.legal_entity_id=i.legal_entity_id where i.id=$1 for update`,
          [job.payrollImportId],
        );
        const item = found.rows[0];
        if (!item || item.status !== 'staged') return;
        // Recheck assignment scope at dequeue. Owners retain all entity scope; other roles require payroll_specialist.
        if (member.role !== 'owner') {
          const access = await tx.query(
            "select 1 from app.hr_access_assignment where legal_entity_id=$1 and user_id=$2 and access_role='payroll_specialist'",
            [item.legal_entity_id, job.userId],
          );
          if (access.rowCount !== 1)
            throw new Error(
              'Payroll import subject no longer has payroll access to this entity.',
            );
          const scope = await tx.query<{ mode: string }>(
            `select mode from app.member_entity_scope
             where organization_id=$1 and user_id=$2`,
            [job.organizationId, job.userId],
          );
          if (scope.rows[0]?.mode === 'restricted') {
            const scoped = await tx.query(
              `select 1 from app.legal_entity_access
               where organization_id=$1 and user_id=$2 and legal_entity_id=$3`,
              [job.organizationId, job.userId, item.legal_entity_id],
            );
            if (scoped.rowCount !== 1)
              throw new Error(
                'Payroll import subject no longer has entity scope.',
              );
          }
        }
        const format = resolveDatasetFormat(item.filename);
        const errors: PayrollImportError[] = [];
        let errorCount = 0;
        let rowCount = 0;
        const add = (
          row: number,
          field: string,
          code: PayrollImportError['code'],
        ) => {
          errorCount++;
          if (errors.length < 1000) errors.push({ row, field, code });
        };
        try {
          if (!format) throw new Error();
          const dataset = await openDataset(
            resolveStagedFilePath(options.stagingDirectory, item.upload_id),
            format,
          );
          const columns = [...dataset.columns];
          const valid =
            columns.length >= required.length &&
            columns.every(
              (c) =>
                required.includes(c as (typeof required)[number]) ||
                componentColumn.test(c),
            ) &&
            new Set(columns).size === columns.length &&
            required.every((c) => columns.includes(c));
          if (!valid) {
            add(1, 'header', 'invalid_header');
          } else {
            const seen = new Set<string>();
            let n = 0;
            for await (const values of dataset.rows) {
              n++;
              if (n > 10000) {
                add(n + 1, 'row', 'row_limit_exceeded');
                break;
              }
              rowCount = n;
              const record = Object.fromEntries(
                columns.map((c, i) => [
                  c,
                  values[i] === null ? '' : String(values[i]),
                ]),
              ) as Record<string, string>;
              const employee = record.employeeNumber?.trim() ?? '';
              if (!employee) add(n + 1, 'employeeNumber', 'required');
              else if (!/^[A-Za-z0-9_-]{1,64}$/.test(employee))
                add(n + 1, 'employeeNumber', 'invalid_employee_number');
              else if (seen.has(employee))
                add(n + 1, 'employeeNumber', 'duplicate_employee');
              else {
                seen.add(employee);
                const employeeRow = await tx.query(
                  'select 1 from app.employee where legal_entity_id=$1 and employee_number=$2',
                  [item.legal_entity_id, employee],
                );
                if (!employeeRow.rowCount)
                  add(n + 1, 'employeeNumber', 'employee_not_found');
              }
              for (const c of required.slice(1)) {
                if (!amount.test(record[c] ?? ''))
                  add(
                    n + 1,
                    c,
                    record[c]?.trim() === '' ? 'required' : 'invalid_amount',
                  );
              }
              if (
                required.slice(1).every((c) => amount.test(record[c] ?? ''))
              ) {
                const arithmetic = await tx.query<{ valid: boolean }>(
                  `select (($1::numeric-$2::numeric-$3::numeric-$4::numeric-$5::numeric)=$6::numeric
                    and ($1::numeric+$7::numeric+$8::numeric)=$9::numeric) as valid`,
                  [
                    record.grossPay,
                    record.employeeSocial,
                    record.employeeHealth,
                    record.incomeTax,
                    record.otherDeductions,
                    record.netPay,
                    record.employerSocial,
                    record.employerHealth,
                    record.employerCost,
                  ],
                );
                if (!arithmetic.rows[0]?.valid)
                  add(n + 1, 'netPay', 'arithmetic_mismatch');
              }
              for (const c of columns.filter((c) =>
                c.startsWith('component:'),
              )) {
                const value = record[c]?.trim() ?? '';
                if (value && !amount.test(value))
                  add(n + 1, c, 'invalid_amount');
                if (value && amount.test(value)) {
                  const definition = await tx.query(
                    `select 1 from app.payroll_component_definition
                     where legal_entity_id=$1 and code=$2 and active=true`,
                    [item.legal_entity_id, c.slice('component:'.length)],
                  );
                  if (!definition.rowCount)
                    add(n + 1, c, 'component_not_found');
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof DatasetParseError)
            add(1, 'file', 'malformed_file');
          else throw error;
        }
        await tx.query(
          'update app.payroll_import set status=$1,row_count=$2,error_count=$3,error_report=$4::jsonb,updated_at=now() where id=$5',
          [
            errorCount > 0 ? 'failed' : 'validated',
            rowCount,
            errorCount,
            JSON.stringify(errors),
            item.id,
          ],
        );
        await tx.query(
          'update app.upload set status=$1,updated_at=now() where id=$2',
          [errorCount > 0 ? 'failed' : 'completed', item.upload_id],
        );
        if (errorCount > 0) terminalUploadId = item.upload_id;
      },
    );
  } finally {
    client.release();
    if (terminalUploadId)
      await deleteStagedFile(options.stagingDirectory, terminalUploadId);
  }
}
