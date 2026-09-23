import { createHash } from 'node:crypto';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';

import { entityFilter, isUniqueViolation } from '../documents/sql.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import type { Paged } from '../hr/hr-repository.js';
import type {
  Component,
  Compensation,
  CreateCompensation,
  CreateComponent,
  CreateMapping,
  Mapping,
  UpdateCompensation,
  UpdateComponent,
  UpdateMapping,
  ComponentListQuery,
  MappingListQuery,
  CreatePayrollRun,
  EmployeePayrollResult,
  EmployeePayrollResultsQuery,
  PayrollRun,
} from './contract.js';

export interface PayrollScope extends TenantContext, EntityScopeSelector {}
type Tx = { query: DatabasePool['query'] };
type Row = Record<string, unknown>;
const componentColumns =
  'id,legal_entity_id,code,name,kind,recurrence,accounting_key,active,created_at,updated_at';
const compensationColumns =
  'id,employee_id,relationship_id,component_definition_id,valid_from,valid_to,amount,currency,created_at,updated_at';
const mappingColumns =
  'id,legal_entity_id,accounting_key,account_code,side,valid_from,valid_to,created_at,updated_at';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown) =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v);
function component(r: Row): Component {
  return {
    id: String(r.id),
    legalEntityId: String(r.legal_entity_id),
    code: String(r.code),
    name: String(r.name),
    kind: r.kind as Component['kind'],
    recurrence: r.recurrence as Component['recurrence'],
    accountingKey: String(r.accounting_key),
    active: Boolean(r.active),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function compensation(r: Row): Compensation {
  return {
    id: String(r.id),
    employeeId: String(r.employee_id),
    relationshipId: String(r.relationship_id),
    componentDefinitionId: String(r.component_definition_id),
    validFrom: day(r.valid_from),
    validTo: r.valid_to === null ? null : day(r.valid_to),
    amount: String(r.amount),
    currency: String(r.currency),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function mapping(r: Row): Mapping {
  return {
    id: String(r.id),
    legalEntityId: String(r.legal_entity_id),
    accountingKey: String(r.accounting_key),
    accountCode: String(r.account_code),
    side: r.side as Mapping['side'],
    validFrom: day(r.valid_from),
    validTo: r.valid_to === null ? null : day(r.valid_to),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
async function audit(tx: Tx, action: string, table: string, id: string) {
  await tx.query("select app.record_audit($1,$2,$3,'{}'::jsonb)", [
    action,
    table,
    id,
  ]);
}
async function visible(tx: Tx, id: string, ids: readonly string[] | null) {
  return (
    (
      await tx.query(
        'select 1 from app.legal_entity where id=$1 and ($2::uuid[] is null or id=any($2::uuid[]))',
        [id, entityFilter(ids)],
      )
    ).rowCount === 1
  );
}
async function lock(tx: Tx, key: string) {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
}
async function overlaps(
  tx: Tx,
  table: string,
  where: string,
  params: unknown[],
  from: string,
  to: string | null,
  excluded: string | null = null,
) {
  const r = await tx.query(
    `select 1 from app.${table} where ${where} and ($${params.length + 1}::uuid is null or id<>$${params.length + 1}) and daterange(valid_from,coalesce(valid_to,'infinity'::date),'[]') && daterange($${params.length + 2}::date,coalesce($${params.length + 3}::date,'infinity'::date),'[]') limit 1`,
    [...params, excluded, from, to],
  );
  return Boolean(r.rowCount);
}
export class PayrollConflictError extends Error {}
export function isPayrollConflict(e: unknown) {
  return (
    e instanceof PayrollConflictError ||
    isUniqueViolation(e, 'payroll_component_definition_entity_code_key') ||
    isUniqueViolation(
      e,
      'employee_compensation_component_relationship_definition_from_key',
    ) ||
    isUniqueViolation(e, 'payroll_account_mapping_entity_key_from_key') ||
    isUniqueViolation(e, 'payroll_run_entity_month_version_key')
  );
}

export abstract class PayrollRepository {
  abstract listEmployeePayrollResults(
    i: PayrollScope & {
      employeeId: string;
      query: EmployeePayrollResultsQuery;
    },
  ): Promise<Paged<EmployeePayrollResult> | null>;
  abstract listRuns(
    i: PayrollScope & {
      query: {
        page: number;
        pageSize: number;
        legalEntityId?: string;
        month?: string;
      };
    },
  ): Promise<Paged<PayrollRun>>;
  abstract readRun(
    i: PayrollScope & { id: string },
  ): Promise<PayrollRun | null>;
  abstract createRun(
    i: PayrollScope & { body: CreatePayrollRun; idempotencyKey: string },
  ): Promise<PayrollRun | null>;
  abstract command(
    i: PayrollScope & {
      id: string;
      command:
        | 'validate'
        | 'submit'
        | 'approve'
        | 'reject'
        | 'finalize'
        | 'record_payment'
        | 'correct';
      body: Record<string, unknown>;
      idempotencyKey: string;
    },
  ): Promise<PayrollRun | null>;
  abstract approvals(i: PayrollScope & { id: string }): Promise<Row[] | null>;
  abstract liabilities(i: PayrollScope & { id: string }): Promise<Row[] | null>;
  abstract listComponents(
    i: PayrollScope & { query: ComponentListQuery },
  ): Promise<Paged<Component> | null>;
  abstract createComponent(
    i: PayrollScope & { body: CreateComponent },
  ): Promise<Component | null>;
  abstract updateComponent(
    i: PayrollScope & { id: string; body: UpdateComponent },
  ): Promise<Component | null>;
  abstract listCompensation(
    i: PayrollScope & {
      employeeId: string;
      page: number;
      pageSize: number;
      relationshipId?: string;
    },
  ): Promise<Paged<Compensation> | null>;
  abstract createCompensation(
    i: PayrollScope & { employeeId: string; body: CreateCompensation },
  ): Promise<Compensation | null>;
  abstract updateCompensation(
    i: PayrollScope & {
      employeeId: string;
      id: string;
      body: UpdateCompensation;
    },
  ): Promise<Compensation | null>;
  abstract listMappings(
    i: PayrollScope & { query: MappingListQuery },
  ): Promise<Paged<Mapping> | null>;
  abstract createMapping(
    i: PayrollScope & { body: CreateMapping },
  ): Promise<Mapping | null>;
  abstract updateMapping(
    i: PayrollScope & { id: string; body: UpdateMapping },
  ): Promise<Mapping | null>;
}

const payrollColumns = `id,legal_entity_id,document_id,payroll_month,version,supersedes_payroll_run_id,status,origin,validation_summary,approved_by,approved_at,finalized_by,finalized_at,paid_by,paid_at,payment_reference,rule_set_id,created_at`;
const payrollResultColumns =
  'employee_id,gross_pay,employee_social,employee_health,income_tax,other_deductions,net_pay,employer_social,employer_health,employer_cost';
const payrollRun = async (tx: Tx, row: Row): Promise<PayrollRun> => {
  const results = await tx.query<Row>(
    `select ${payrollResultColumns} from app.payroll_result where payroll_run_id=$1 order by employee_id`,
    [row.id],
  );
  return {
    id: String(row.id),
    legalEntityId: String(row.legal_entity_id),
    documentId: row.document_id === null ? null : String(row.document_id),
    month: day(row.payroll_month).slice(0, 7),
    version: Number(row.version),
    supersedesPayrollRunId:
      row.supersedes_payroll_run_id === null
        ? null
        : String(row.supersedes_payroll_run_id),
    status: row.status as PayrollRun['status'],
    origin: row.origin as PayrollRun['origin'],
    validationSummary:
      (row.validation_summary as PayrollRun['validationSummary']) ?? {
        valid: false,
        issues: [],
      },
    approvedBy: row.approved_by === null ? null : String(row.approved_by),
    approvedAt: row.approved_at === null ? null : iso(row.approved_at),
    finalizedBy: row.finalized_by === null ? null : String(row.finalized_by),
    finalizedAt: row.finalized_at === null ? null : iso(row.finalized_at),
    paidBy: row.paid_by === null ? null : String(row.paid_by),
    paidAt: row.paid_at === null ? null : iso(row.paid_at),
    paymentReference:
      row.payment_reference === null ? null : String(row.payment_reference),
    ruleSetId: row.rule_set_id === null ? null : String(row.rule_set_id),
    createdAt: iso(row.created_at),
    results: results.rows.map((r) => ({
      employeeId: String(r.employee_id),
      grossPay: String(r.gross_pay),
      employeeSocial: String(r.employee_social),
      employeeHealth: String(r.employee_health),
      incomeTax: String(r.income_tax),
      otherDeductions: String(r.other_deductions),
      netPay: String(r.net_pay),
      employerSocial: String(r.employer_social),
      employerHealth: String(r.employer_health),
      totalEmployerCost: String(r.employer_cost),
    })),
  };
};
const fixed = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
};
const decimal = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(5, '0');
  return `${sign}${digits.slice(0, -4)}.${digits.slice(-4)}`;
};
const add = (...values: string[]) =>
  decimal(values.reduce((n, v) => n + fixed(v), 0n));
const nonZero = (value: string) => fixed(value) !== 0n;
const arithmetic = (r: PayrollRun['results'][number]) =>
  fixed(r.grossPay) ===
    fixed(r.netPay) +
      fixed(r.employeeSocial) +
      fixed(r.employeeHealth) +
      fixed(r.incomeTax) +
      fixed(r.otherDeductions) &&
  fixed(r.totalEmployerCost) ===
    fixed(r.grossPay) + fixed(r.employerSocial) + fixed(r.employerHealth);
const hash = (body: unknown) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

export async function listRuns(
  pool: DatabasePool,
  i: PayrollScope & {
    query: {
      page: number;
      pageSize: number;
      legalEntityId?: string;
      month?: string;
    };
  },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const p = [
      entityFilter(i.legalEntityIds),
      i.query.legalEntityId ?? null,
      i.query.month ? `${i.query.month}-01` : null,
    ];
    const where =
      'where ($1::uuid[] is null or legal_entity_id=any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::date is null or payroll_month=$3::date)';
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.payroll_run ${where}`,
        p,
      ),
      tx.query<Row>(
        `select ${payrollColumns} from app.payroll_run ${where} order by payroll_month desc,version desc,id asc limit $4 offset $5`,
        [...p, i.query.pageSize, (i.query.page - 1) * i.query.pageSize],
      ),
    ]);
    return {
      items: await Promise.all(rows.rows.map((r) => payrollRun(tx, r))),
      page: i.query.page,
      pageSize: i.query.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function listEmployeePayrollResults(
  pool: DatabasePool,
  i: PayrollScope & {
    employeeId: string;
    query: EmployeePayrollResultsQuery;
  },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const employee = await tx.query(
      'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [i.employeeId, entityFilter(i.legalEntityIds)],
    );
    if (!employee.rowCount) return null;
    const params = [
      i.employeeId,
      i.query.fromMonth ? `${i.query.fromMonth}-01` : null,
      i.query.toMonth ? `${i.query.toMonth}-01` : null,
    ];
    const where =
      'where result.employee_id=$1 and ($2::date is null or run.payroll_month >= $2::date) and ($3::date is null or run.payroll_month <= $3::date)';
    const [count, rows] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.payroll_result result join app.payroll_run run on run.id=result.payroll_run_id ${where}`,
        params,
      ),
      tx.query<Row>(
        `select run.id payroll_run_id,run.legal_entity_id,run.payroll_month,run.version,run.supersedes_payroll_run_id,run.status,run.origin,result.gross_pay,result.employee_social,result.employee_health,result.income_tax,result.other_deductions,result.net_pay,result.employer_social,result.employer_health,result.employer_cost,payslip.document_id payslip_document_id,run.finalized_at,run.paid_at from app.payroll_result result join app.payroll_run run on run.id=result.payroll_run_id left join lateral (select document_id from app.payroll_result_document where payroll_result_id=result.id and kind='payslip' order by id asc limit 1) payslip on true ${where} order by run.payroll_month desc,run.version desc,run.id asc limit $4 offset $5`,
        [...params, i.query.pageSize, (i.query.page - 1) * i.query.pageSize],
      ),
    ]);
    return {
      items: rows.rows.map((r) => ({
        payrollRunId: String(r.payroll_run_id),
        legalEntityId: String(r.legal_entity_id),
        month: day(r.payroll_month).slice(0, 7),
        version: Number(r.version),
        supersedesPayrollRunId:
          r.supersedes_payroll_run_id === null
            ? null
            : String(r.supersedes_payroll_run_id),
        status: r.status as EmployeePayrollResult['status'],
        origin: r.origin as EmployeePayrollResult['origin'],
        grossPay: String(r.gross_pay),
        employeeSocial: String(r.employee_social),
        employeeHealth: String(r.employee_health),
        incomeTax: String(r.income_tax),
        otherDeductions: String(r.other_deductions),
        netPay: String(r.net_pay),
        employerSocial: String(r.employer_social),
        employerHealth: String(r.employer_health),
        totalEmployerCost: String(r.employer_cost),
        payslipDocumentId:
          r.payslip_document_id === null ? null : String(r.payslip_document_id),
        finalizedAt: r.finalized_at === null ? null : iso(r.finalized_at),
        paidAt: r.paid_at === null ? null : iso(r.paid_at),
      })),
      page: i.query.page,
      pageSize: i.query.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  });
}
export async function readRun(
  pool: DatabasePool,
  i: PayrollScope & { id: string },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const r = await tx.query<Row>(
      `select ${payrollColumns} from app.payroll_run where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))`,
      [i.id, entityFilter(i.legalEntityIds)],
    );
    return r.rows[0] ? payrollRun(tx, r.rows[0]) : null;
  });
}
export async function createRun(
  pool: DatabasePool,
  i: PayrollScope & { body: CreatePayrollRun; idempotencyKey: string },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const requestHash = hash(i.body);
    await lock(tx, `payroll-key:${i.organizationId}:${i.idempotencyKey}`);
    const prior = await tx.query<Row>(
      'select * from app.payroll_run where organization_id=$1 and idempotency_key=$2',
      [i.organizationId, i.idempotencyKey],
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].idempotency_request_hash === null ||
        String(prior.rows[0].idempotency_request_hash) !== requestHash
      )
        throw new PayrollConflictError();
      return payrollRun(tx, prior.rows[0]);
    }
    if (
      !(await visible(tx, i.body.legalEntityId, i.legalEntityIds)) ||
      !i.body.results.every(arithmetic)
    )
      return null;
    const employeeIds = i.body.results.map((r) => r.employeeId);
    const employees = await tx.query(
      'select id from app.employee where legal_entity_id=$1 and id=any($2::uuid[])',
      [i.body.legalEntityId, employeeIds],
    );
    if (employees.rowCount !== employeeIds.length) return null;
    const row = await tx.query<Row>(
      `insert into app.payroll_run (organization_id,legal_entity_id,payroll_month,version,status,origin,idempotency_key,idempotency_request_hash,validation_summary,created_by) values ($1,$2,$3::date,1,'draft','calculated',$4,$5,'{"valid":false,"issues":[]}'::jsonb,$6) returning ${payrollColumns}`,
      [
        i.organizationId,
        i.body.legalEntityId,
        `${i.body.month}-01`,
        i.idempotencyKey,
        requestHash,
        i.userId,
      ],
    );
    for (const x of i.body.results)
      await tx.query(
        `insert into app.payroll_result (organization_id,payroll_run_id,employee_id,gross_pay,employee_social,employee_health,income_tax,other_deductions,net_pay,employer_social,employer_health,employer_cost) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          i.organizationId,
          row.rows[0]!.id,
          x.employeeId,
          x.grossPay,
          x.employeeSocial,
          x.employeeHealth,
          x.incomeTax,
          x.otherDeductions,
          x.netPay,
          x.employerSocial,
          x.employerHealth,
          x.totalEmployerCost,
        ],
      );
    await audit(
      tx,
      'payroll_run.created',
      'payroll_run',
      String(row.rows[0]!.id),
    );
    return payrollRun(tx, row.rows[0]!);
  });
}
export async function commandRun(
  pool: DatabasePool,
  i: PayrollScope & {
    id: string;
    command:
      | 'validate'
      | 'submit'
      | 'approve'
      | 'reject'
      | 'finalize'
      | 'record_payment'
      | 'correct';
    body: Record<string, unknown>;
    idempotencyKey: string;
  },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const requestHash = hash(i.body);
    await lock(tx, `payroll-command:${i.organizationId}:${i.idempotencyKey}`);
    const receipt = await tx.query<Row>(
      'select * from app.payroll_command_receipt where organization_id=$1 and idempotency_key=$2',
      [i.organizationId, i.idempotencyKey],
    );
    if (receipt.rows[0]) {
      const x = receipt.rows[0];
      if (
        String(x.payroll_run_id) !== i.id ||
        String(x.command) !== i.command ||
        String(x.request_hash) !== requestHash
      )
        throw new PayrollConflictError();
      const replay = await tx.query<Row>(
        `select ${payrollColumns} from app.payroll_run where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))`,
        [x.result_payroll_run_id ?? i.id, entityFilter(i.legalEntityIds)],
      );
      return replay.rows[0] ? payrollRun(tx, replay.rows[0]) : null;
    }
    const locked = await tx.query<Row>(
      `select ${payrollColumns} from app.payroll_run where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) for update`,
      [i.id, entityFilter(i.legalEntityIds)],
    );
    const run = locked.rows[0];
    if (!run) return null;
    const fail = () => {
      throw new PayrollConflictError();
    };
    let resultId = String(run.id);
    if (i.command === 'validate') {
      if (run.status !== 'draft') fail();
      await tx.query(
        "update app.payroll_run set status='validating' where id=$1",
        [run.id],
      );
      const results = await payrollRun(tx, run);
      const missing = results.results.length === 0;
      const mappings = await tx.query<{ count: string }>(
        `with required(accounting_key, side) as (values
          ('gross_pay'::text,'debit'::text),
          ('employer_contributions','debit'),
          ('net_wages','credit'),
          ('insurance_payable','credit'),
          ('income_tax','credit'),
          ('other_deductions','credit')
        )
        select count(*)::text count from required r
        left join lateral (
          select account_code, side from app.payroll_account_mapping m
          where m.legal_entity_id=$1 and m.accounting_key=r.accounting_key
            and m.valid_from <= $2::date and (m.valid_to is null or m.valid_to >= $2::date)
          order by m.valid_from desc, m.id asc limit 1
        ) m on true
        where m.account_code is not null
          and (m.side <> r.side or m.account_code !~ '^[0-9]{3}$')`,
        [run.legal_entity_id, run.payroll_month],
      );
      const unbalanced = results.results.filter(
        (result) => !arithmetic(result),
      ).length;
      const issues = [
        { code: 'missing_results', count: missing ? 1 : 0 },
        {
          code: 'invalid_account_mapping',
          count: Number(mappings.rows[0]?.count ?? 0),
        },
        { code: 'unbalanced_accounting', count: unbalanced },
      ].filter((x) => x.count > 0);
      const summary = { valid: issues.length === 0, issues };
      await tx.query(
        'update app.payroll_run set status=$1,validation_summary=$2::jsonb where id=$3',
        [
          summary.valid ? 'validating' : 'draft',
          JSON.stringify(summary),
          run.id,
        ],
      );
    } else if (i.command === 'submit') {
      if (
        run.status !== 'validating' ||
        !(run.validation_summary as { valid?: boolean }).valid
      )
        fail();
      await tx.query(
        "update app.payroll_run set status='ready_for_approval' where id=$1",
        [run.id],
      );
      await tx.query(
        "insert into app.payroll_approval (organization_id,payroll_run_id,action,actor_user_id,created_by,acted_at) values ($1,$2,'submitted',$3,$3,now())",
        [i.organizationId, run.id, i.userId],
      );
    } else if (i.command === 'approve') {
      if (run.status !== 'ready_for_approval') fail();
      await tx.query(
        "update app.payroll_run set status='approved',approved_by=$1,approved_at=now() where id=$2",
        [i.userId, run.id],
      );
      await tx.query(
        "insert into app.payroll_approval (organization_id,payroll_run_id,action,actor_user_id,created_by,acted_at) values ($1,$2,'approved',$3,$3,now())",
        [i.organizationId, run.id, i.userId],
      );
    } else if (i.command === 'reject') {
      if (run.status !== 'ready_for_approval') fail();
      await tx.query("update app.payroll_run set status='draft' where id=$1", [
        run.id,
      ]);
      await tx.query(
        "insert into app.payroll_approval (organization_id,payroll_run_id,action,actor_user_id,reason,created_by,acted_at) values ($1,$2,'rejected',$3,$4,$3,now())",
        [i.organizationId, run.id, i.userId, String(i.body.reason)],
      );
    } else if (i.command === 'record_payment') {
      if (run.status !== 'finalized') fail();
      await tx.query(
        "update app.payroll_run set status='paid',paid_by=$1,paid_at=$2::timestamptz,payment_reference=$3 where id=$4",
        [i.userId, i.body.paidAt, i.body.paymentReference, run.id],
      );
      await tx.query(
        "update app.payroll_liability set status='paid',paid_at=$1::timestamptz where payroll_run_id=$2 and status='open'",
        [i.body.paidAt, run.id],
      );
      await tx.query(
        "insert into app.payroll_approval (organization_id,payroll_run_id,action,actor_user_id,created_by,acted_at) values ($1,$2,'paid',$3,$3,now())",
        [i.organizationId, run.id, i.userId],
      );
    } else if (i.command === 'correct') {
      if (run.status !== 'finalized' && run.status !== 'paid') fail();
      await lock(
        tx,
        `payroll-month:${run.legal_entity_id}:${day(run.payroll_month)}`,
      );
      const next = await tx.query<Row>(
        `insert into app.payroll_run (organization_id,legal_entity_id,payroll_month,version,supersedes_payroll_run_id,status,origin,validation_summary,created_by) values ($1,$2,$3,$4,$5,'draft',$6,'{"valid":false,"issues":[]}'::jsonb,$7) returning ${payrollColumns}`,
        [
          i.organizationId,
          run.legal_entity_id,
          run.payroll_month,
          Number(run.version) + 1,
          run.id,
          run.origin,
          i.userId,
        ],
      );
      await tx.query(
        `insert into app.payroll_result (organization_id,payroll_run_id,employee_id,gross_pay,employee_social,employee_health,income_tax,other_deductions,net_pay,employer_social,employer_health,employer_cost) select organization_id,$1,employee_id,gross_pay,employee_social,employee_health,income_tax,other_deductions,net_pay,employer_social,employer_health,employer_cost from app.payroll_result where payroll_run_id=$2`,
        [next.rows[0]!.id, run.id],
      );
      await tx.query(
        `insert into app.payroll_result_component (organization_id,payroll_result_id,component_definition_id,amount,source,description,created_by)
         select source.organization_id,target.id,component.component_definition_id,component.amount,component.source,component.description,$3
         from app.payroll_result_component component
         join app.payroll_result source on source.id=component.payroll_result_id
         join app.payroll_result target on target.payroll_run_id=$1 and target.employee_id=source.employee_id
         where source.payroll_run_id=$2`,
        [next.rows[0]!.id, run.id, i.userId],
      );
      resultId = String(next.rows[0]!.id);
    } else if (i.command === 'finalize') {
      if (
        run.status !== 'approved' ||
        !(run.validation_summary as { valid?: boolean }).valid
      )
        fail();
      await lock(
        tx,
        `payroll-month:${run.legal_entity_id}:${day(run.payroll_month)}`,
      );
      const other = await tx.query<{ has_other: boolean }>(
        'select app.has_other_payroll_manager($1,$2,$3) has_other',
        [i.organizationId, run.legal_entity_id, i.userId],
      );
      if (run.approved_by === i.userId && other.rows[0]?.has_other) fail();
      const totals = await tx.query<Row>(
        `select coalesce(sum(gross_pay),0) gross_pay,coalesce(sum(employer_social+employer_health),0) employer_contributions,coalesce(sum(net_pay),0) net_wages,coalesce(sum(employee_social+employer_social),0) social,coalesce(sum(employee_health+employer_health),0) health,coalesce(sum(income_tax),0) income_tax,coalesce(sum(other_deductions),0) other,coalesce(sum(employer_cost),0) employer_cost from app.payroll_result where payroll_run_id=$1`,
        [run.id],
      );
      const t = totals.rows[0]!;
      const doc = await tx.query<{ id: string }>(
        "insert into app.document (organization_id,legal_entity_id,kind,source,title,document_date,total_amount,created_by) values ($1,$2,'payroll','api','Payroll',$3::date,$4,$5) returning id",
        [
          i.organizationId,
          run.legal_entity_id,
          run.payroll_month,
          t.employer_cost,
          i.userId,
        ],
      );
      const resultRows = await tx.query<Row>(
        'select id from app.payroll_result where payroll_run_id=$1 order by employee_id',
        [run.id],
      );
      for (const result of resultRows.rows) {
        const resultDocument = await tx.query<{ id: string }>(
          "insert into app.document (organization_id,legal_entity_id,kind,source,title,document_date,total_amount,created_by) values ($1,$2,'payroll','api','Payroll result',$3::date,0,$4) returning id",
          [i.organizationId, run.legal_entity_id, run.payroll_month, i.userId],
        );
        await tx.query(
          "insert into app.payroll_result_document (organization_id,payroll_result_id,document_id,kind,created_by) values ($1,$2,$3,'payslip',$4)",
          [i.organizationId, result.id, resultDocument.rows[0]!.id, i.userId],
        );
      }
      const defaults = [
        ['gross_pay', 'debit', '521', t.gross_pay],
        ['employer_contributions', 'debit', '524', t.employer_contributions],
        ['net_wages', 'credit', '331', t.net_wages],
        [
          'insurance_payable',
          'credit',
          '336',
          add(String(t.social), String(t.health)),
        ],
        ['income_tax', 'credit', '342', t.income_tax],
        ['other_deductions', 'credit', '333', t.other],
      ] as const;
      const event = await tx.query<{ id: string }>(
        "insert into app.economic_event (organization_id,legal_entity_id,document_id,event_date,rule_set_version,is_balanced,debit_total,credit_total) values ($1,$2,$3,$4::date,'hr-payroll-recorded-facts-1',true,$5,$5) returning id",
        [
          i.organizationId,
          run.legal_entity_id,
          doc.rows[0]!.id,
          run.payroll_month,
          t.employer_cost,
        ],
      );
      for (const [lineNo, line] of defaults.entries()) {
        const [accountingKey, expectedSide, fallback, amount] = line;
        if (!nonZero(String(amount))) continue;
        const mapping = await tx.query<{ account_code: string; side: string }>(
          `select account_code,side from app.payroll_account_mapping where legal_entity_id=$1 and accounting_key=$2 and valid_from <= $3::date and (valid_to is null or valid_to >= $3::date) order by valid_from desc,id asc limit 1`,
          [run.legal_entity_id, accountingKey, run.payroll_month],
        );
        if (mapping.rows[0] && mapping.rows[0].side !== expectedSide) fail();
        await tx.query(
          'insert into app.economic_event_line (organization_id,event_id,line_no,account_code,side,amount,effective_date,description) values ($1,$2,$3,$4,$5,$6,$7::date,$8)',
          [
            i.organizationId,
            event.rows[0]!.id,
            lineNo + 1,
            mapping.rows[0]?.account_code ?? fallback,
            expectedSide,
            amount,
            run.payroll_month,
            'Payroll run',
          ],
        );
      }
      await tx.query(
        "update app.payroll_run set status='finalized',document_id=$1,finalized_by=$2,finalized_at=now() where id=$3",
        [doc.rows[0]!.id, i.userId, run.id],
      );
      await tx.query(
        "insert into app.payroll_approval (organization_id,payroll_run_id,action,actor_user_id,created_by,acted_at) values ($1,$2,'finalized',$3,$3,now())",
        [i.organizationId, run.id, i.userId],
      );
      for (const [kind, amount] of [
        ['net_wages', t.net_wages],
        ['social', t.social],
        ['health', t.health],
        ['income_tax', t.income_tax],
        ['other', t.other],
      ] as const)
        if (nonZero(String(amount)))
          await tx.query(
            "insert into app.payroll_liability (organization_id,payroll_run_id,kind,amount,due_on,created_by) values ($1,$2,$3,$4,($5::date + interval '1 month - 1 day')::date,$6)",
            [
              i.organizationId,
              run.id,
              kind,
              amount,
              run.payroll_month,
              i.userId,
            ],
          );
      if (run.supersedes_payroll_run_id)
        await tx.query(
          "update app.payroll_run set status='superseded' where id=$1 and status in ('finalized','paid')",
          [run.supersedes_payroll_run_id],
        );
    }
    await tx.query(
      'insert into app.payroll_command_receipt (organization_id,payroll_run_id,command,idempotency_key,request_hash,result_payroll_run_id,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        i.organizationId,
        i.id,
        i.command,
        i.idempotencyKey,
        requestHash,
        resultId,
        i.body.reason ?? null,
        i.userId,
      ],
    );
    await audit(tx, `payroll_run.${i.command}`, 'payroll_run', i.id);
    const final = await tx.query<Row>(
      `select ${payrollColumns} from app.payroll_run where id=$1`,
      [resultId],
    );
    return payrollRun(tx, final.rows[0]!);
  });
}
export async function listComponents(
  pool: DatabasePool,
  i: PayrollScope & { query: ComponentListQuery },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const q = i.query;
    if (
      q.legalEntityId &&
      !(await visible(tx, q.legalEntityId, i.legalEntityIds))
    )
      return null;
    const p = [
      entityFilter(i.legalEntityIds),
      q.legalEntityId ?? null,
      q.active ?? null,
      q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null,
    ];
    const w =
      "where ($1::uuid[] is null or legal_entity_id=any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::boolean is null or active=$3) and ($4::text is null or code ilike $4 escape '\\' or name ilike $4 escape '\\')";
    const [c, r] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.payroll_component_definition ${w}`,
        p,
      ),
      tx.query<Row>(
        `select ${componentColumns} from app.payroll_component_definition ${w} order by code asc,id asc limit $5 offset $6`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: r.rows.map(component),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(c.rows[0]?.count ?? 0),
    };
  });
}
export async function createComponent(
  pool: DatabasePool,
  i: PayrollScope & { body: CreateComponent },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const b = i.body;
    if (!(await visible(tx, b.legalEntityId, i.legalEntityIds))) return null;
    const r = await tx.query<Row>(
      `insert into app.payroll_component_definition (organization_id,legal_entity_id,code,name,kind,recurrence,accounting_key,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${componentColumns}`,
      [
        i.organizationId,
        b.legalEntityId,
        b.code,
        b.name,
        b.kind,
        b.recurrence,
        b.accountingKey,
        i.userId,
      ],
    );
    await audit(
      tx,
      'payroll_component_definition.created',
      'payroll_component_definition',
      String(r.rows[0]!.id),
    );
    return component(r.rows[0]!);
  });
}
export async function updateComponent(
  pool: DatabasePool,
  i: PayrollScope & { id: string; body: UpdateComponent },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const f = Object.entries(i.body).filter(([, v]) => v !== undefined);
    const r = await tx.query<Row>(
      `update app.payroll_component_definition set ${f.map(([k], n) => `${k === 'name' ? 'name' : 'active'}=$${n + 1}`).join(',')} where id=$${f.length + 1} and ($${f.length + 2}::uuid[] is null or legal_entity_id=any($${f.length + 2}::uuid[])) returning ${componentColumns}`,
      [...f.map(([, v]) => v), i.id, entityFilter(i.legalEntityIds)],
    );
    if (!r.rows[0]) return null;
    await audit(
      tx,
      'payroll_component_definition.updated',
      'payroll_component_definition',
      i.id,
    );
    return component(r.rows[0]);
  });
}
export async function listCompensation(
  pool: DatabasePool,
  i: PayrollScope & {
    employeeId: string;
    page: number;
    pageSize: number;
    relationshipId?: string;
  },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const exists = await tx.query(
      'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
      [i.employeeId, entityFilter(i.legalEntityIds)],
    );
    if (!exists.rowCount) return null;
    const p = [
      i.employeeId,
      i.relationshipId ?? null,
      i.pageSize,
      (i.page - 1) * i.pageSize,
    ];
    const [c, r] = await Promise.all([
      tx.query<{ count: string }>(
        'select count(*)::text count from app.employee_compensation_component where employee_id=$1 and ($2::uuid is null or relationship_id=$2)',
        p.slice(0, 2),
      ),
      tx.query<Row>(
        `select ${compensationColumns} from app.employee_compensation_component where employee_id=$1 and ($2::uuid is null or relationship_id=$2) order by valid_from desc,id asc limit $3 offset $4`,
        p,
      ),
    ]);
    return {
      items: r.rows.map(compensation),
      page: i.page,
      pageSize: i.pageSize,
      total: Number(c.rows[0]?.count ?? 0),
    };
  });
}
export async function createCompensation(
  pool: DatabasePool,
  i: PayrollScope & { employeeId: string; body: CreateCompensation },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const b = i.body;
    const refs = await tx.query<{ legal_entity_id: string }>(
      `select e.legal_entity_id from app.employee e join app.employment_relationship r on r.id=$2 and r.employee_id=e.id join app.payroll_component_definition d on d.id=$3 and d.legal_entity_id=e.legal_entity_id where e.id=$1 and ($4::uuid[] is null or e.legal_entity_id=any($4::uuid[]))`,
      [
        i.employeeId,
        b.relationshipId,
        b.componentDefinitionId,
        entityFilter(i.legalEntityIds),
      ],
    );
    if (!refs.rowCount) return null;
    await lock(
      tx,
      `compensation:${b.relationshipId}:${b.componentDefinitionId}`,
    );
    if (
      await overlaps(
        tx,
        'employee_compensation_component',
        'relationship_id=$1 and component_definition_id=$2',
        [b.relationshipId, b.componentDefinitionId],
        b.validFrom,
        b.validTo,
      )
    )
      throw new PayrollConflictError();
    const r = await tx.query<Row>(
      `insert into app.employee_compensation_component (organization_id,employee_id,relationship_id,component_definition_id,valid_from,valid_to,amount,currency,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${compensationColumns}`,
      [
        i.organizationId,
        i.employeeId,
        b.relationshipId,
        b.componentDefinitionId,
        b.validFrom,
        b.validTo,
        b.amount,
        b.currency,
        i.userId,
      ],
    );
    await audit(
      tx,
      'employee_compensation_component.created',
      'employee_compensation_component',
      String(r.rows[0]!.id),
    );
    return compensation(r.rows[0]!);
  });
}
export async function updateCompensation(
  pool: DatabasePool,
  i: PayrollScope & {
    employeeId: string;
    id: string;
    body: UpdateCompensation;
  },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const old = await tx.query<Row>(
      `select c.id,c.employee_id,c.relationship_id,c.component_definition_id,c.valid_from,c.valid_to,c.amount,c.currency,c.created_at,c.updated_at from app.employee_compensation_component c join app.employee e on e.id=c.employee_id where c.id=$1 and c.employee_id=$2 and ($3::uuid[] is null or e.legal_entity_id=any($3::uuid[])) for update`,
      [i.id, i.employeeId, entityFilter(i.legalEntityIds)],
    );
    if (!old.rows[0]) return null;
    const o = compensation(old.rows[0]);
    const b = i.body;
    await lock(
      tx,
      `compensation:${o.relationshipId}:${o.componentDefinitionId}`,
    );
    if (
      b.validFrom <= o.validFrom ||
      (o.validTo !== null && b.validFrom > o.validTo) ||
      (await overlaps(
        tx,
        'employee_compensation_component',
        'relationship_id=$1 and component_definition_id=$2',
        [o.relationshipId, o.componentDefinitionId],
        b.validFrom,
        b.validTo,
        o.id,
      ))
    )
      throw new PayrollConflictError();
    const closed = await tx.query(
      `update app.employee_compensation_component set valid_to=($1::date - interval '1 day')::date where id=$2 and valid_to is not distinct from $3::date`,
      [b.validFrom, o.id, o.validTo],
    );
    if (!closed.rowCount) throw new PayrollConflictError();
    const r = await tx.query<Row>(
      `insert into app.employee_compensation_component (organization_id,employee_id,relationship_id,component_definition_id,valid_from,valid_to,amount,currency,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${compensationColumns}`,
      [
        i.organizationId,
        i.employeeId,
        o.relationshipId,
        o.componentDefinitionId,
        b.validFrom,
        b.validTo,
        b.amount,
        b.currency,
        i.userId,
      ],
    );
    await audit(
      tx,
      'employee_compensation_component.versioned',
      'employee_compensation_component',
      String(r.rows[0]!.id),
    );
    return compensation(r.rows[0]!);
  });
}
export async function listMappings(
  pool: DatabasePool,
  i: PayrollScope & { query: MappingListQuery },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const q = i.query;
    if (
      q.legalEntityId &&
      !(await visible(tx, q.legalEntityId, i.legalEntityIds))
    )
      return null;
    const p = [
      entityFilter(i.legalEntityIds),
      q.legalEntityId ?? null,
      q.accountingKey ?? null,
    ];
    const w =
      'where ($1::uuid[] is null or legal_entity_id=any($1::uuid[])) and ($2::uuid is null or legal_entity_id=$2) and ($3::text is null or accounting_key=$3)';
    const [c, r] = await Promise.all([
      tx.query<{ count: string }>(
        `select count(*)::text count from app.payroll_account_mapping ${w}`,
        p,
      ),
      tx.query<Row>(
        `select ${mappingColumns} from app.payroll_account_mapping ${w} order by accounting_key asc,valid_from desc,id asc limit $4 offset $5`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      ),
    ]);
    return {
      items: r.rows.map(mapping),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(c.rows[0]?.count ?? 0),
    };
  });
}
export async function createMapping(
  pool: DatabasePool,
  i: PayrollScope & { body: CreateMapping },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const b = i.body;
    if (!(await visible(tx, b.legalEntityId, i.legalEntityIds))) return null;
    await lock(tx, `mapping:${b.legalEntityId}:${b.accountingKey}`);
    if (
      await overlaps(
        tx,
        'payroll_account_mapping',
        'legal_entity_id=$1 and accounting_key=$2',
        [b.legalEntityId, b.accountingKey],
        b.validFrom,
        b.validTo,
      )
    )
      throw new PayrollConflictError();
    const r = await tx.query<Row>(
      `insert into app.payroll_account_mapping (organization_id,legal_entity_id,accounting_key,account_code,side,valid_from,valid_to,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${mappingColumns}`,
      [
        i.organizationId,
        b.legalEntityId,
        b.accountingKey,
        b.accountCode,
        b.side,
        b.validFrom,
        b.validTo,
        i.userId,
      ],
    );
    await audit(
      tx,
      'payroll_account_mapping.created',
      'payroll_account_mapping',
      String(r.rows[0]!.id),
    );
    return mapping(r.rows[0]!);
  });
}
export async function updateMapping(
  pool: DatabasePool,
  i: PayrollScope & { id: string; body: UpdateMapping },
) {
  return runInTenantContext(pool, i, async (tx) => {
    const old = await tx.query<Row>(
      `select ${mappingColumns} from app.payroll_account_mapping where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) for update`,
      [i.id, entityFilter(i.legalEntityIds)],
    );
    if (!old.rows[0]) return null;
    const o = mapping(old.rows[0]),
      b = i.body;
    await lock(tx, `mapping:${o.legalEntityId}:${o.accountingKey}`);
    if (
      b.validFrom <= o.validFrom ||
      (o.validTo !== null && b.validFrom > o.validTo) ||
      (await overlaps(
        tx,
        'payroll_account_mapping',
        'legal_entity_id=$1 and accounting_key=$2',
        [o.legalEntityId, o.accountingKey],
        b.validFrom,
        b.validTo,
        o.id,
      ))
    )
      throw new PayrollConflictError();
    const closed = await tx.query(
      `update app.payroll_account_mapping set valid_to=($1::date - interval '1 day')::date where id=$2 and valid_to is not distinct from $3::date`,
      [b.validFrom, o.id, o.validTo],
    );
    if (!closed.rowCount) throw new PayrollConflictError();
    const r = await tx.query<Row>(
      `insert into app.payroll_account_mapping (organization_id,legal_entity_id,accounting_key,account_code,side,valid_from,valid_to,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${mappingColumns}`,
      [
        i.organizationId,
        o.legalEntityId,
        o.accountingKey,
        b.accountCode,
        b.side,
        b.validFrom,
        b.validTo,
        i.userId,
      ],
    );
    await audit(
      tx,
      'payroll_account_mapping.versioned',
      'payroll_account_mapping',
      String(r.rows[0]!.id),
    );
    return mapping(r.rows[0]!);
  });
}
@Injectable()
export class DatabasePayrollRepository
  extends PayrollRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise) await (await this.poolPromise).end();
  }
  private pool() {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
  async listRuns(
    i: PayrollScope & {
      query: {
        page: number;
        pageSize: number;
        legalEntityId?: string;
        month?: string;
      };
    },
  ) {
    return listRuns(await this.pool(), i);
  }
  async listEmployeePayrollResults(
    i: PayrollScope & {
      employeeId: string;
      query: EmployeePayrollResultsQuery;
    },
  ) {
    return listEmployeePayrollResults(await this.pool(), i);
  }
  async readRun(i: PayrollScope & { id: string }) {
    return readRun(await this.pool(), i);
  }
  async createRun(
    i: PayrollScope & { body: CreatePayrollRun; idempotencyKey: string },
  ) {
    return createRun(await this.pool(), i);
  }
  async command(
    i: PayrollScope & {
      id: string;
      command:
        | 'validate'
        | 'submit'
        | 'approve'
        | 'reject'
        | 'finalize'
        | 'record_payment'
        | 'correct';
      body: Record<string, unknown>;
      idempotencyKey: string;
    },
  ) {
    return commandRun(await this.pool(), i);
  }
  async approvals(i: PayrollScope & { id: string }) {
    return runInTenantContext(await this.pool(), i, async (tx) => {
      const visibleRun = await tx.query(
        'select 1 from app.payroll_run where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
        [i.id, entityFilter(i.legalEntityIds)],
      );
      if (!visibleRun.rowCount) return null;
      return (
        await tx.query<Row>(
          'select action,reason,actor_user_id,acted_at from app.payroll_approval where payroll_run_id=$1 order by acted_at,id',
          [i.id],
        )
      ).rows;
    });
  }
  async liabilities(i: PayrollScope & { id: string }) {
    return runInTenantContext(await this.pool(), i, async (tx) => {
      const visibleRun = await tx.query(
        'select 1 from app.payroll_run where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
        [i.id, entityFilter(i.legalEntityIds)],
      );
      if (!visibleRun.rowCount) return null;
      return (
        await tx.query<Row>(
          'select kind,creditor_reference,amount,due_on,status,paid_at from app.payroll_liability where payroll_run_id=$1 order by kind,creditor_reference,id',
          [i.id],
        )
      ).rows;
    });
  }
  async listComponents(i: PayrollScope & { query: ComponentListQuery }) {
    return listComponents(await this.pool(), i);
  }
  async createComponent(i: PayrollScope & { body: CreateComponent }) {
    return createComponent(await this.pool(), i);
  }
  async updateComponent(
    i: PayrollScope & { id: string; body: UpdateComponent },
  ) {
    return updateComponent(await this.pool(), i);
  }
  async listCompensation(
    i: PayrollScope & {
      employeeId: string;
      page: number;
      pageSize: number;
      relationshipId?: string;
    },
  ) {
    return listCompensation(await this.pool(), i);
  }
  async createCompensation(
    i: PayrollScope & { employeeId: string; body: CreateCompensation },
  ) {
    return createCompensation(await this.pool(), i);
  }
  async updateCompensation(
    i: PayrollScope & {
      employeeId: string;
      id: string;
      body: UpdateCompensation;
    },
  ) {
    return updateCompensation(await this.pool(), i);
  }
  async listMappings(i: PayrollScope & { query: MappingListQuery }) {
    return listMappings(await this.pool(), i);
  }
  async createMapping(i: PayrollScope & { body: CreateMapping }) {
    return createMapping(await this.pool(), i);
  }
  async updateMapping(i: PayrollScope & { id: string; body: UpdateMapping }) {
    return updateMapping(await this.pool(), i);
  }
}
