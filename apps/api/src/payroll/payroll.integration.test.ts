import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  runMigrations,
  withTenantContext,
} from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabaseConfiguration, DatabaseRole } from '@bap/db/config';
import type { DatabasePool } from '@bap/db/pool';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEmployee, createRelationship } from '../hr/hr-repository.js';
import {
  createCompensation,
  createComponent,
  createMapping,
  createRun,
  commandRun,
  listEmployeePayrollResults,
  readRun,
  PayrollConflictError,
  updateCompensation,
  updateComponent,
  updateMapping,
} from './payroll-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const allEntities = { legalEntityIds: null };

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let entityId = '';
let secondEntityId = '';
let employeeId = '';
let relationshipId = '';
let componentId = '';
let foreignEmployeeId = '';
let foreignRelationshipId = '';
let foreignComponentId = '';
let commandSequence = 100;

const commandKey = () =>
  `00000000-0000-4000-8000-${String(commandSequence++).padStart(12, '0')}`;
const recordedResult = (employeeIdValue = employeeId) => ({
  employeeId: employeeIdValue,
  grossPay: '1000.0000',
  employeeSocial: '100.0000',
  employeeHealth: '50.0000',
  incomeTax: '100.0000',
  otherDeductions: '10.0000',
  netPay: '740.0000',
  employerSocial: '200.0000',
  employerHealth: '100.0000',
  totalEmployerCost: '1300.0000',
});

async function payrollRun(month: string, key = commandKey()) {
  const run = await createRun(apiPool, {
    ...owner,
    ...allEntities,
    idempotencyKey: key,
    body: { legalEntityId: entityId, month, results: [recordedResult()] },
  });
  if (!run) throw new Error('Payroll run seed failed.');
  return run;
}

async function command(
  id: string,
  commandName: Parameters<typeof commandRun>[1]['command'],
  body: Record<string, unknown> = {},
  key = commandKey(),
  user = owner,
) {
  return commandRun(apiPool, {
    ...user,
    ...allEntities,
    id,
    command: commandName,
    body,
    idempotencyKey: key,
  });
}

async function ready(id: string, approver = owner) {
  await command(id, 'validate');
  await command(id, 'submit');
  await command(id, 'approve', {}, commandKey(), approver);
}

function configurationFor(role: DatabaseRole): DatabaseConfiguration {
  return {
    database: container.getDatabase(),
    host: container.getHost(),
    password: testPassword,
    port: container.getPort(),
    role,
    ssl: false,
    user: role,
  };
}

async function asTenant<T>(
  tenant: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();
  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}

async function asOwner(operation: (client: PoolClient) => Promise<void>) {
  const client = await migratorPool.connect();
  try {
    await client.query('begin');
    await client.query('set local role bap_owner');
    await client.query("set local bap.organization_id='org-1'");
    await client.query("set local bap.user_id='user-1'");
    await operation(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createLegalEntity(tenant: TenantContext, name: string) {
  return asTenant(tenant, async (tx) => {
    const result = await tx.query<{ id: string }>(
      "insert into app.legal_entity (organization_id,name,kind,created_by) values ($1,$2,'company',$3) returning id",
      [tenant.organizationId, name, tenant.userId],
    );
    return result.rows[0]!.id;
  });
}

async function seedEmployee(
  tenant: TenantContext,
  legalEntityId: string,
  suffix: string,
) {
  const employee = await createEmployee(apiPool, {
    ...tenant,
    ...allEntities,
    body: {
      legalEntityId,
      employeeNumber: `EMP-${suffix}`,
      firstName: 'Test',
      lastName: suffix,
      workEmail: null,
      workPhone: null,
    },
  });
  if (!employee) throw new Error('Employee seed failed.');
  const relationship = await createRelationship(apiPool, {
    ...tenant,
    ...allEntities,
    employeeId: employee.id,
    body: {
      kind: 'employment',
      position: 'Tester',
      department: null,
      costCentre: null,
      weeklyHours: '40',
      startDate: '2026-01-01',
      endDate: null,
    },
  });
  if (!relationship) throw new Error('Relationship seed failed.');
  return { employeeId: employee.id, relationshipId: relationship.id };
}

async function component(
  legalEntityId: string,
  code: string,
  name = 'Base salary',
) {
  const created = await createComponent(apiPool, {
    ...owner,
    ...allEntities,
    body: {
      legalEntityId,
      code,
      name,
      kind: 'earning',
      recurrence: 'recurring',
      accountingKey: code,
    },
  });
  if (!created) throw new Error('Component seed failed.');
  return created;
}

async function count(table: string, where: string, params: unknown[]) {
  return asTenant(owner, async (tx) =>
    Number(
      (
        await tx.query<{ count: string }>(
          `select count(*)::text count from app.${table} where ${where}`,
          params,
        )
      ).rows[0]!.count,
    ),
  );
}

async function workflowCounts(runId: string) {
  return asTenant(owner, async (tx) => {
    const result = await tx.query<Record<string, string>>(
      `select
        (select count(*)::text from app.document d where d.id=(select document_id from app.payroll_run where id=$1) or d.id in (select document_id from app.payroll_result_document where payroll_result_id in (select id from app.payroll_result where payroll_run_id=$1))) documents,
        (select count(*)::text from app.payroll_result_document where payroll_result_id in (select id from app.payroll_result where payroll_run_id=$1)) result_links,
        (select count(*)::text from app.economic_event where document_id=(select document_id from app.payroll_run where id=$1)) events,
        (select count(*)::text from app.economic_event_line where event_id in (select id from app.economic_event where document_id=(select document_id from app.payroll_run where id=$1))) lines,
        (select count(*)::text from app.payroll_liability where payroll_run_id=$1) liabilities,
        (select count(*)::text from app.payroll_approval where payroll_run_id=$1) approvals,
        (select count(*)::text from app.payroll_command_receipt where payroll_run_id=$1) receipts,
        (select count(*)::text from app.audit_log where resource_type='payroll_run' and resource_id=$1::text) audits`,
      [runId],
    );
    return result.rows[0]!;
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  const rootPool = createDatabasePool(configurationFor('postgres'));
  const root = await rootPool.connect();
  try {
    await bootstrapDatabaseRoles(root, {
      bap_api: testPassword,
      bap_auth: testPassword,
      bap_backup: testPassword,
      bap_migrator: testPassword,
      bap_reporting: testPassword,
    });
  } finally {
    root.release();
  }
  migratorPool = createDatabasePool(configurationFor('bap_migrator'));
  await runMigrations(migratorPool);
  const migrator = await migratorPool.connect();
  try {
    await migrator.query('begin');
    await migrator.query('set local role bap_owner');
    await migrator.query(
      "insert into auth.\"user\" (id,name,email,email_verified) values ('user-1','Owner','owner@example.test',true),('user-2','Stranger','stranger@example.test',true)",
    );
    await migrator.query(
      "insert into auth.organization (id,name,slug) values ('org-1','One','one'),('org-2','Two','two')",
    );
    await migrator.query(
      "insert into auth.member (id,organization_id,user_id,role) values ('member-1','org-1','user-1','owner'),('member-2','org-2','user-2','owner'),('member-3','org-1','user-2','admin')",
    );
    await migrator.query('commit');
  } finally {
    migrator.release();
    await rootPool.end();
  }
  apiPool = createDatabasePool(configurationFor('bap_api'));
  entityId = await createLegalEntity(owner, 'Primary');
  secondEntityId = await createLegalEntity(owner, 'Second');
  await asTenant(owner, (tx) =>
    tx.query(
      "insert into app.hr_access_assignment (organization_id,legal_entity_id,user_id,access_role,created_by) values ('org-1',$1,'user-2','payroll_specialist','user-1'),('org-1',$2,'user-2','payroll_specialist','user-1')",
      [entityId, secondEntityId],
    ),
  );
  const employee = await seedEmployee(owner, entityId, 'PRIMARY');
  employeeId = employee.employeeId;
  relationshipId = employee.relationshipId;
  componentId = (await component(entityId, 'BASE')).id;
  const foreignEmployee = await seedEmployee(owner, secondEntityId, 'SECOND');
  foreignEmployeeId = foreignEmployee.employeeId;
  foreignRelationshipId = foreignEmployee.relationshipId;
  foreignComponentId = (await component(secondEntityId, 'SECOND')).id;
});

afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('payroll repositories against PostgreSQL as bap_api', () => {
  it('returns every visible employee run version with range paging and only finalized payslips', async () => {
    const initial = await payrollRun(
      '2028-03',
      '00000000-0000-4000-8000-000000000900',
    );
    await command(
      initial.id,
      'validate',
      {},
      '00000000-0000-4000-8000-000000000901',
    );
    await command(
      initial.id,
      'submit',
      {},
      '00000000-0000-4000-8000-000000000902',
    );
    await command(
      initial.id,
      'approve',
      {},
      '00000000-0000-4000-8000-000000000903',
      { ...owner, userId: 'user-2' },
    );
    const finalized = await command(
      initial.id,
      'finalize',
      {},
      '00000000-0000-4000-8000-000000000904',
    );
    expect(finalized?.status).toBe('finalized');
    const correction = await command(
      initial.id,
      'correct',
      {
        reason: 'Correction for history proof',
      },
      '00000000-0000-4000-8000-000000000905',
    );
    if (!correction) throw new Error('Correction seed failed.');
    const history = await listEmployeePayrollResults(apiPool, {
      ...owner,
      ...allEntities,
      employeeId,
      query: { fromMonth: '2028-03', toMonth: '2028-03', page: 1, pageSize: 1 },
    });
    expect(history).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(history?.items).toHaveLength(1);
    expect(history?.items[0]).toMatchObject({
      payrollRunId: correction.id,
      version: 2,
      supersedesPayrollRunId: initial.id,
      payslipDocumentId: null,
      finalizedAt: null,
      paidAt: null,
    });
    const secondPage = await listEmployeePayrollResults(apiPool, {
      ...owner,
      ...allEntities,
      employeeId,
      query: { fromMonth: '2028-03', toMonth: '2028-03', page: 2, pageSize: 1 },
    });
    expect(secondPage?.items[0]).toMatchObject({
      payrollRunId: initial.id,
      version: 1,
      status: 'finalized',
      payslipDocumentId: expect.any(String),
      finalizedAt: expect.any(String),
    });
    expect(
      await listEmployeePayrollResults(apiPool, {
        ...owner,
        legalEntityIds: [secondEntityId],
        employeeId,
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
    expect(
      await listEmployeePayrollResults(apiPool, {
        organizationId: 'org-2',
        role: 'owner',
        userId: 'user-2',
        ...allEntities,
        employeeId,
        query: { page: 1, pageSize: 25 },
      }),
    ).toBeNull();
  });
  it('updates only mutable component fields without requiring updated_at access', async () => {
    const created = await component(entityId, 'MUTABLE', 'Before');
    const updated = await updateComponent(apiPool, {
      ...owner,
      ...allEntities,
      id: created.id,
      body: { name: 'After', active: false },
    });
    expect(updated).toMatchObject({
      id: created.id,
      name: 'After',
      active: false,
    });
    await expect(
      asTenant(owner, (tx) =>
        tx.query(
          'update app.payroll_component_definition set code=$1 where id=$2',
          ['IMMUTABLE', created.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('versions compensation by closing only valid_to and rejects overlap', async () => {
    const created = await createCompensation(apiPool, {
      ...owner,
      ...allEntities,
      employeeId,
      body: {
        relationshipId,
        componentDefinitionId: componentId,
        validFrom: '2026-01-01',
        validTo: null,
        amount: '100.0000',
        currency: 'CZK',
      },
    });
    if (!created) throw new Error('Compensation creation failed.');
    await expect(
      asTenant(owner, (tx) =>
        tx.query(
          'update app.employee_compensation_component set amount=$1 where id=$2',
          ['999.0000', created.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    const successor = await updateCompensation(apiPool, {
      ...owner,
      ...allEntities,
      employeeId,
      id: created.id,
      body: {
        validFrom: '2026-02-01',
        validTo: null,
        amount: '125.5000',
        currency: 'CZK',
      },
    });
    expect(successor).toMatchObject({
      validFrom: '2026-02-01',
      validTo: null,
      amount: '125.5000',
    });
    const versions = await asTenant(owner, (tx) =>
      tx.query<{ valid_from: string; valid_to: string | null; amount: string }>(
        'select valid_from::text,valid_to::text,amount::text from app.employee_compensation_component where relationship_id=$1 and component_definition_id=$2 order by valid_from',
        [relationshipId, componentId],
      ),
    );
    expect(versions.rows).toEqual([
      { valid_from: '2026-01-01', valid_to: '2026-01-31', amount: '100.0000' },
      { valid_from: '2026-02-01', valid_to: null, amount: '125.5000' },
    ]);
    await expect(
      createCompensation(apiPool, {
        ...owner,
        ...allEntities,
        employeeId,
        body: {
          relationshipId,
          componentDefinitionId: componentId,
          validFrom: '2026-01-15',
          validTo: null,
          amount: '1.0000',
          currency: 'CZK',
        },
      }),
    ).rejects.toBeInstanceOf(PayrollConflictError);
  });

  it('versions mappings by closing only valid_to and rejects overlap', async () => {
    const created = await createMapping(apiPool, {
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        accountingKey: 'WAGES',
        accountCode: '521',
        side: 'debit',
        validFrom: '2026-01-01',
        validTo: null,
      },
    });
    if (!created) throw new Error('Mapping creation failed.');
    await expect(
      asTenant(owner, (tx) =>
        tx.query(
          'update app.payroll_account_mapping set account_code=$1 where id=$2',
          ['999', created.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    const successor = await updateMapping(apiPool, {
      ...owner,
      ...allEntities,
      id: created.id,
      body: {
        accountCode: '522',
        side: 'credit',
        validFrom: '2026-02-01',
        validTo: null,
      },
    });
    expect(successor).toMatchObject({
      validFrom: '2026-02-01',
      validTo: null,
      accountCode: '522',
      side: 'credit',
    });
    const versions = await asTenant(owner, (tx) =>
      tx.query<{
        valid_from: string;
        valid_to: string | null;
        account_code: string;
        side: string;
      }>(
        'select valid_from::text,valid_to::text,account_code,side from app.payroll_account_mapping where legal_entity_id=$1 and accounting_key=$2 order by valid_from',
        [entityId, 'WAGES'],
      ),
    );
    expect(versions.rows).toEqual([
      {
        valid_from: '2026-01-01',
        valid_to: '2026-01-31',
        account_code: '521',
        side: 'debit',
      },
      {
        valid_from: '2026-02-01',
        valid_to: null,
        account_code: '522',
        side: 'credit',
      },
    ]);
    await expect(
      createMapping(apiPool, {
        ...owner,
        ...allEntities,
        body: {
          legalEntityId: entityId,
          accountingKey: 'WAGES',
          accountCode: '999',
          side: 'debit',
          validFrom: '2026-01-15',
          validTo: null,
        },
      }),
    ).rejects.toBeInstanceOf(PayrollConflictError);
  });

  it('serializes concurrent compensation successors', async () => {
    const definition = await component(entityId, 'CONCURRENT-COMP');
    const predecessor = await createCompensation(apiPool, {
      ...owner,
      ...allEntities,
      employeeId,
      body: {
        relationshipId,
        componentDefinitionId: definition.id,
        validFrom: '2026-03-01',
        validTo: null,
        amount: '1.0000',
        currency: 'CZK',
      },
    });
    if (!predecessor) throw new Error('Compensation creation failed.');
    const update = (amount: string) =>
      updateCompensation(apiPool, {
        ...owner,
        ...allEntities,
        employeeId,
        id: predecessor.id,
        body: {
          validFrom: '2026-04-01',
          validTo: null,
          amount,
          currency: 'CZK',
        },
      });
    const results = await Promise.allSettled([
      update('2.0000'),
      update('3.0000'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof PayrollConflictError,
      ),
    ).toHaveLength(1);
    expect(
      await count(
        'employee_compensation_component',
        'relationship_id=$1 and component_definition_id=$2',
        [relationshipId, definition.id],
      ),
    ).toBe(2);
    const closed = await asTenant(owner, (tx) =>
      tx.query<{ valid_to: string }>(
        'select valid_to::text from app.employee_compensation_component where id=$1',
        [predecessor.id],
      ),
    );
    expect(closed.rows[0]?.valid_to).toBe('2026-03-31');
  });

  it('serializes concurrent mapping successors', async () => {
    const predecessor = await createMapping(apiPool, {
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        accountingKey: 'CONCURRENT-MAPPING',
        accountCode: '521',
        side: 'debit',
        validFrom: '2026-03-01',
        validTo: null,
      },
    });
    if (!predecessor) throw new Error('Mapping creation failed.');
    const update = (accountCode: string) =>
      updateMapping(apiPool, {
        ...owner,
        ...allEntities,
        id: predecessor.id,
        body: {
          accountCode,
          side: 'debit',
          validFrom: '2026-04-01',
          validTo: null,
        },
      });
    const results = await Promise.allSettled([update('522'), update('523')]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof PayrollConflictError,
      ),
    ).toHaveLength(1);
    expect(
      await count(
        'payroll_account_mapping',
        'legal_entity_id=$1 and accounting_key=$2',
        [entityId, 'CONCURRENT-MAPPING'],
      ),
    ).toBe(2);
    const closed = await asTenant(owner, (tx) =>
      tx.query<{ valid_to: string }>(
        'select valid_to::text from app.payroll_account_mapping where id=$1',
        [predecessor.id],
      ),
    );
    expect(closed.rows[0]?.valid_to).toBe('2026-03-31');
  });

  it('returns null for cross-entity references and writes no compensation row', async () => {
    const before = await count(
      'employee_compensation_component',
      'employee_id=$1',
      [employeeId],
    );
    await expect(
      createCompensation(apiPool, {
        ...owner,
        ...allEntities,
        employeeId,
        body: {
          relationshipId: foreignRelationshipId,
          componentDefinitionId: componentId,
          validFrom: '2026-05-01',
          validTo: null,
          amount: '1.0000',
          currency: 'CZK',
        },
      }),
    ).resolves.toBeNull();
    await expect(
      createCompensation(apiPool, {
        ...owner,
        ...allEntities,
        employeeId,
        body: {
          relationshipId,
          componentDefinitionId: foreignComponentId,
          validFrom: '2026-05-01',
          validTo: null,
          amount: '1.0000',
          currency: 'CZK',
        },
      }),
    ).resolves.toBeNull();
    await expect(
      createCompensation(apiPool, {
        ...owner,
        ...allEntities,
        employeeId: foreignEmployeeId,
        body: {
          relationshipId,
          componentDefinitionId: componentId,
          validFrom: '2026-05-01',
          validTo: null,
          amount: '1.0000',
          currency: 'CZK',
        },
      }),
    ).resolves.toBeNull();
    expect(
      await count('employee_compensation_component', 'employee_id=$1', [
        employeeId,
      ]),
    ).toBe(before);
  });

  it('writes identifier-only audit rows and rolls back if audit execution fails', async () => {
    const created = await component(entityId, 'AUDITED');
    const audit = await asTenant(owner, (tx) =>
      tx.query<{
        action: string;
        resource_type: string;
        resource_id: string;
        metadata: object;
      }>(
        'select action,resource_type,resource_id,metadata from app.audit_log where resource_id=$1 order by created_at desc limit 1',
        [created.id],
      ),
    );
    expect(audit.rows[0]).toEqual({
      action: 'payroll_component_definition.created',
      resource_type: 'payroll_component_definition',
      resource_id: created.id,
      metadata: {},
    });
    const client = await migratorPool.connect();
    try {
      await client.query('begin');
      await client.query('set local role bap_owner');
      await client.query(
        'revoke execute on function app.record_audit(text,text,text,jsonb) from bap_api',
      );
      await client.query('commit');
      await expect(component(entityId, 'AUDIT-ROLLBACK')).rejects.toThrow(
        /permission denied/i,
      );
      expect(
        await count(
          'payroll_component_definition',
          "code='AUDIT-ROLLBACK'",
          [],
        ),
      ).toBe(0);
    } finally {
      await client.query('begin');
      await client.query('set local role bap_owner');
      await client.query(
        'grant execute on function app.record_audit(text,text,text,jsonb) to bap_api',
      );
      await client.query('commit');
      client.release();
    }
  });

  it('executes the W2.5 run workflow atomically through the production repository', async () => {
    const before = await Promise.all([
      count('document', "kind='payroll'", []),
      count('economic_event', 'true', []),
      count('payroll_liability', 'true', []),
      count('payroll_approval', 'true', []),
    ]);
    const draft = await payrollRun('2026-03', commandKey());
    expect(draft).toMatchObject({
      status: 'draft',
      origin: 'calculated',
      version: 1,
      documentId: null,
    });
    expect(
      await Promise.all([
        count('document', "kind='payroll'", []),
        count('economic_event', 'true', []),
        count('payroll_liability', 'true', []),
        count('payroll_approval', 'true', []),
      ]),
    ).toEqual(before);
    const replay = await createRun(apiPool, {
      ...owner,
      ...allEntities,
      idempotencyKey: '00000000-0000-4000-8000-000000000100',
      body: {
        legalEntityId: entityId,
        month: '2026-03',
        results: [recordedResult()],
      },
    });
    expect(replay?.id).toBe(draft.id);
    await expect(
      createRun(apiPool, {
        ...owner,
        ...allEntities,
        idempotencyKey: '00000000-0000-4000-8000-000000000100',
        body: {
          legalEntityId: entityId,
          month: '2026-03',
          results: [{ ...recordedResult(), netPay: '739.0000' }],
        },
      }),
    ).rejects.toBeInstanceOf(PayrollConflictError);

    await createMapping(apiPool, {
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        accountingKey: 'gross_pay',
        accountCode: '521',
        side: 'credit',
        validFrom: '2026-02-01',
        validTo: '2026-02-28',
      },
    });
    const invalid = await payrollRun('2026-02');
    expect(await command(invalid.id, 'validate')).toMatchObject({
      status: 'draft',
      validationSummary: {
        valid: false,
        issues: [{ code: 'invalid_account_mapping', count: 1 }],
      },
    });
    await expect(command(invalid.id, 'submit')).rejects.toBeInstanceOf(
      PayrollConflictError,
    );

    await ready(draft.id, { ...owner, userId: 'user-2' });
    await expect(command(draft.id, 'approve')).rejects.toBeInstanceOf(
      PayrollConflictError,
    );
    const finalizeKey = commandKey();
    const finalized = await command(draft.id, 'finalize', {}, finalizeKey);
    if (!finalized) throw new Error('Finalization unexpectedly returned null.');
    expect(finalized).toMatchObject({
      status: 'finalized',
      finalizedBy: 'user-1',
      approvedBy: 'user-2',
      ruleSetId: null,
    });
    const facts = await asTenant(owner, (tx) =>
      tx.query<{
        documents: string;
        links: string;
        entries: string;
        debit: string;
        credit: string;
        rule_set_version: string;
        liabilities: string;
        due_on: string;
      }>(
        `select
          (select count(*)::text from app.document where id=$1 or id in (select document_id from app.payroll_result_document where payroll_result_id in (select id from app.payroll_result where payroll_run_id=$2))) documents,
          (select count(*)::text from app.payroll_result_document where payroll_result_id in (select id from app.payroll_result where payroll_run_id=$2) and kind='payslip') links,
          (select count(*)::text from app.economic_event_line l join app.economic_event e on e.id=l.event_id where e.document_id=$1) entries,
          (select debit_total::text from app.economic_event where document_id=$1) debit,
          (select credit_total::text from app.economic_event where document_id=$1) credit,
          (select rule_set_version from app.economic_event where document_id=$1) rule_set_version,
          (select count(*)::text from app.payroll_liability where payroll_run_id=$2 and amount<>0 and status='open') liabilities,
          (select max(due_on)::text from app.payroll_liability where payroll_run_id=$2) due_on`,
        [finalized.documentId, draft.id],
      ),
    );
    expect(facts.rows[0]).toMatchObject({
      documents: '2',
      links: '1',
      entries: '6',
      debit: '1300.0000',
      credit: '1300.0000',
      rule_set_version: 'hr-payroll-recorded-facts-1',
      liabilities: '5',
      due_on: '2026-03-31',
    });
    const approvalCount = await count('payroll_approval', 'payroll_run_id=$1', [
      draft.id,
    ]);
    const finalReplay = await command(draft.id, 'finalize', {}, finalizeKey);
    expect(finalReplay?.status).toBe('finalized');
    expect(
      await count('payroll_approval', 'payroll_run_id=$1', [draft.id]),
    ).toBe(approvalCount);
    const paid = await command(draft.id, 'record_payment', {
      paidAt: '2026-04-01T12:00:00.000Z',
      paymentReference: 'PAY-2026-03',
    });
    if (!paid) throw new Error('Payment unexpectedly returned null.');
    expect(paid).toMatchObject({
      status: 'paid',
      paidBy: 'user-1',
      paymentReference: 'PAY-2026-03',
    });
    expect(
      await count('payroll_liability', "payroll_run_id=$1 and status='paid'", [
        draft.id,
      ]),
    ).toBe(5);

    const correction = await command(draft.id, 'correct', {
      reason: 'Correct recorded input',
    });
    if (!correction) throw new Error('Correction unexpectedly returned null.');
    expect(correction).toMatchObject({
      status: 'draft',
      version: 2,
      supersedesPayrollRunId: draft.id,
    });
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: draft.id }))
        ?.status,
    ).toBe('paid');
    expect(correction.results).toEqual(draft.results);
    await ready(correction.id, { ...owner, userId: 'user-2' });
    const correctedFinalization = await command(correction.id, 'finalize');
    expect(correctedFinalization?.status).toBe('finalized');
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: draft.id }))
        ?.status,
    ).toBe('superseded');
    expect(
      await readRun(apiPool, {
        organizationId: 'org-2',
        role: 'owner',
        userId: 'user-2',
        ...allEntities,
        id: correction.id,
      }),
    ).toBeNull();
  });

  it('reports exact recorded-fact validation issues and leaves failed finalization side-effect free', async () => {
    const missing = await payrollRun('2026-04');
    await asOwner(async (tx) => {
      await tx.query(
        'alter table app.payroll_result no force row level security',
      );
      await tx.query('delete from app.payroll_result where payroll_run_id=$1', [
        missing.id,
      ]);
      await tx.query('alter table app.payroll_result force row level security');
    });
    expect(await command(missing.id, 'validate')).toMatchObject({
      status: 'draft',
      validationSummary: {
        valid: false,
        issues: [{ code: 'missing_results', count: 1 }],
      },
    });

    const unbalanced = await payrollRun('2026-05');
    await asOwner(async (tx) => {
      await tx.query(
        'alter table app.payroll_result no force row level security',
      );
      await tx.query(
        'alter table app.payroll_result drop constraint payroll_result_arithmetic_check',
      );
      await tx.query(
        'update app.payroll_result set net_pay=net_pay+1 where payroll_run_id=$1',
        [unbalanced.id],
      );
      await tx.query(
        'alter table app.payroll_result add constraint payroll_result_arithmetic_check check (net_pay = gross_pay - employee_social - employee_health - income_tax - other_deductions and employer_cost = gross_pay + employer_social + employer_health) not valid',
      );
      await tx.query('alter table app.payroll_result force row level security');
    });
    expect(await command(unbalanced.id, 'validate')).toMatchObject({
      status: 'draft',
      validationSummary: {
        valid: false,
        issues: [{ code: 'unbalanced_accounting', count: 1 }],
      },
    });

    const rollback = await payrollRun('2026-06');
    await ready(rollback.id, { ...owner, userId: 'user-2' });
    const before = await Promise.all([
      count('document', "kind='payroll'", []),
      count('payroll_result_document', 'true', []),
      count('economic_event', 'true', []),
      count('economic_event_line', 'true', []),
      count('payroll_liability', 'true', []),
      count('payroll_approval', 'true', []),
      count('payroll_command_receipt', 'true', []),
      count('audit_log', "resource_type='payroll_run'", []),
    ]);
    await asOwner(async (tx) => {
      await tx.query(
        'revoke execute on function app.record_audit(text,text,text,jsonb) from bap_api',
      );
    });
    try {
      await expect(command(rollback.id, 'finalize')).rejects.toThrow(
        /permission denied/i,
      );
      expect(
        await Promise.all([
          count('document', "kind='payroll'", []),
          count('payroll_result_document', 'true', []),
          count('economic_event', 'true', []),
          count('economic_event_line', 'true', []),
          count('payroll_liability', 'true', []),
          count('payroll_approval', 'true', []),
          count('payroll_command_receipt', 'true', []),
          count('audit_log', "resource_type='payroll_run'", []),
        ]),
      ).toEqual(before);
      expect(
        (await readRun(apiPool, { ...owner, ...allEntities, id: rollback.id }))
          ?.status,
      ).toBe('approved');
    } finally {
      await asOwner(async (tx) => {
        await tx.query(
          'grant execute on function app.record_audit(text,text,text,jsonb) to bap_api',
        );
      });
    }

    const concurrent = await payrollRun('2026-07');
    await ready(concurrent.id, { ...owner, userId: 'user-2' });
    const settled = await Promise.allSettled([
      command(concurrent.id, 'finalize', {}, commandKey()),
      command(concurrent.id, 'finalize', {}, commandKey()),
    ]);
    expect(
      settled.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await count(
        'document',
        "kind='payroll' and document_date='2026-07-01'",
        [],
      ),
    ).toBe(2);
    expect(await count('economic_event', "event_date='2026-07-01'", [])).toBe(
      1,
    );
  });

  it('preserves fixed-scale precision, omits zero accounting lines, and rejects mapping drift', async () => {
    const precisionKey = commandKey();
    const precise = await createRun(apiPool, {
      ...owner,
      ...allEntities,
      idempotencyKey: precisionKey,
      body: {
        legalEntityId: entityId,
        month: '2026-08',
        results: [
          {
            ...recordedResult(),
            grossPay: '900719925474099.9999',
            employeeSocial: '1.0000',
            employeeHealth: '1.0000',
            incomeTax: '1.0000',
            otherDeductions: '1.0000',
            netPay: '900719925474095.9999',
            employerSocial: '1.0000',
            employerHealth: '1.0000',
            totalEmployerCost: '900719925474101.9999',
          },
        ],
      },
    });
    expect(precise?.results[0]?.totalEmployerCost).toBe('900719925474101.9999');
    if (!precise) throw new Error('Precision run seed failed.');
    await asOwner(async (tx) => {
      await tx.query('alter table app.payroll_run no force row level security');
      await tx.query(
        'update app.payroll_run set idempotency_request_hash=null where id=$1',
        [precise.id],
      );
      await tx.query('alter table app.payroll_run force row level security');
    });
    await expect(
      createRun(apiPool, {
        ...owner,
        ...allEntities,
        idempotencyKey: precisionKey,
        body: {
          legalEntityId: entityId,
          month: '2026-08',
          results: [precise.results[0]!],
        },
      }),
    ).rejects.toBeInstanceOf(PayrollConflictError);

    const zero = await createRun(apiPool, {
      ...owner,
      ...allEntities,
      idempotencyKey: commandKey(),
      body: {
        legalEntityId: entityId,
        month: '2026-09',
        results: [
          {
            ...recordedResult(),
            employeeSocial: '0.0000',
            employeeHealth: '0.0000',
            incomeTax: '0.0000',
            otherDeductions: '0.0000',
            netPay: '1000.0000',
            employerSocial: '0.0000',
            employerHealth: '0.0000',
            totalEmployerCost: '1000.0000',
          },
        ],
      },
    });
    if (!zero) throw new Error('Zero-value run seed failed.');
    await ready(zero.id, { ...owner, userId: 'user-2' });
    const zeroFinal = await command(zero.id, 'finalize');
    expect(zeroFinal?.status).toBe('finalized');
    expect(
      await asTenant(owner, async (tx) =>
        Number(
          (
            await tx.query<{ count: string }>(
              'select count(*)::text count from app.economic_event_line l join app.economic_event e on e.id=l.event_id where e.document_id=$1',
              [zeroFinal?.documentId],
            )
          ).rows[0]?.count,
        ),
      ),
    ).toBe(2);

    const drift = await payrollRun('2026-10');
    await ready(drift.id, { ...owner, userId: 'user-2' });
    await createMapping(apiPool, {
      ...owner,
      ...allEntities,
      body: {
        legalEntityId: entityId,
        accountingKey: 'gross_pay',
        accountCode: '521',
        side: 'credit',
        validFrom: '2026-10-01',
        validTo: null,
      },
    });
    const before = await Promise.all([
      count('document', "kind='payroll'", []),
      count('economic_event', 'true', []),
    ]);
    await expect(command(drift.id, 'finalize')).rejects.toBeInstanceOf(
      PayrollConflictError,
    );
    expect(
      await Promise.all([
        count('document', "kind='payroll'", []),
        count('economic_event', 'true', []),
      ]),
    ).toEqual(before);
  });

  it('rejects ready-for-approval runs back to draft with their valid summary and exact reason', async () => {
    const run = await payrollRun('2025-01');
    await command(run.id, 'validate');
    await command(run.id, 'submit');
    const rejected = await command(run.id, 'reject', {
      reason: 'Recorded facts need correction',
    });
    expect(rejected).toMatchObject({
      status: 'draft',
      validationSummary: { valid: true, issues: [] },
    });
    expect(
      await asTenant(owner, (tx) =>
        tx.query<{ action: string; reason: string | null }>(
          'select action,reason from app.payroll_approval where payroll_run_id=$1 order by acted_at,id',
          [run.id],
        ),
      ),
    ).toMatchObject({
      rows: [
        { action: 'submitted', reason: null },
        { action: 'rejected', reason: 'Recorded facts need correction' },
      ],
    });
  });

  it('replays a command exactly and rejects idempotency-key body command and run collisions without duplicates', async () => {
    const run = await payrollRun('2025-02');
    await ready(run.id, { ...owner, userId: 'user-2' });
    const otherRun = await payrollRun('2025-03');
    await ready(otherRun.id, { ...owner, userId: 'user-2' });
    const key = commandKey();
    const finalized = await command(run.id, 'finalize', {}, key);
    expect(finalized?.status).toBe('finalized');
    const before = await workflowCounts(run.id);
    expect(before).toEqual({
      documents: '2',
      result_links: '1',
      events: '1',
      lines: '6',
      liabilities: '5',
      approvals: '3',
      receipts: '4',
      audits: '5',
    });
    expect((await command(run.id, 'finalize', {}, key))?.id).toBe(run.id);
    await expect(
      command(run.id, 'finalize', { retry: true }, key),
    ).rejects.toBeInstanceOf(PayrollConflictError);
    await expect(
      command(run.id, 'record_payment', {}, key),
    ).rejects.toBeInstanceOf(PayrollConflictError);
    await expect(
      command(otherRun.id, 'finalize', {}, key),
    ).rejects.toBeInstanceOf(PayrollConflictError);
    expect(await workflowCounts(run.id)).toEqual(before);
  });

  it('enforces segregation of duties only when another eligible manager exists', async () => {
    const denied = await payrollRun('2025-04');
    await command(denied.id, 'validate');
    await command(denied.id, 'submit');
    await command(denied.id, 'approve');
    await expect(command(denied.id, 'finalize')).rejects.toBeInstanceOf(
      PayrollConflictError,
    );
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: denied.id }))
        ?.status,
    ).toBe('approved');

    const orgTwoOwner: TenantContext = {
      organizationId: 'org-2',
      role: 'owner',
      userId: 'user-2',
    };
    const soloEntity = await createLegalEntity(orgTwoOwner, 'Solo manager');
    const soloEmployee = await seedEmployee(orgTwoOwner, soloEntity, 'SOLO');
    const solo = await createRun(apiPool, {
      ...orgTwoOwner,
      ...allEntities,
      idempotencyKey: commandKey(),
      body: {
        legalEntityId: soloEntity,
        month: '2025-05',
        results: [recordedResult(soloEmployee.employeeId)],
      },
    });
    if (!solo) throw new Error('Solo run seed failed.');
    await command(solo.id, 'validate', {}, commandKey(), orgTwoOwner);
    await command(solo.id, 'submit', {}, commandKey(), orgTwoOwner);
    await command(solo.id, 'approve', {}, commandKey(), orgTwoOwner);
    expect(
      (await command(solo.id, 'finalize', {}, commandKey(), orgTwoOwner))
        ?.status,
    ).toBe('finalized');
  });

  it('copies result components into corrections and supersedes only the direct predecessor on finalization', async () => {
    const run = await payrollRun('2025-06');
    const sourceResult = await asTenant(owner, async (tx) => {
      const result = await tx.query<{ id: string }>(
        'select id from app.payroll_result where payroll_run_id=$1',
        [run.id],
      );
      await tx.query(
        "insert into app.payroll_result_component (organization_id,payroll_result_id,component_definition_id,amount,source,description,created_by) values ('org-1',$1,$2,'12.3400','adjustment','Manual correction','user-1')",
        [result.rows[0]!.id, componentId],
      );
      return result.rows[0]!.id;
    });
    await ready(run.id, { ...owner, userId: 'user-2' });
    await command(run.id, 'finalize');
    const correction = await command(run.id, 'correct', {
      reason: 'Correct component',
    });
    if (!correction) throw new Error('Correction unexpectedly returned null.');
    expect(correction.supersedesPayrollRunId).toBe(run.id);
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: run.id }))
        ?.results,
    ).toEqual(run.results);
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: run.id }))
        ?.status,
    ).toBe('finalized');
    const copied = await asTenant(owner, (tx) =>
      tx.query<{
        amount: string;
        source: string;
        description: string;
        source_result: string;
      }>(
        `select c.amount::text,c.source,c.description,$2::text source_result from app.payroll_result_component c join app.payroll_result r on r.id=c.payroll_result_id where r.payroll_run_id=$1`,
        [correction.id, sourceResult],
      ),
    );
    expect(copied.rows).toEqual([
      {
        amount: '12.3400',
        source: 'adjustment',
        description: 'Manual correction',
        source_result: sourceResult,
      },
    ]);
    expect(correction.results).toEqual(run.results);
    await ready(correction.id, { ...owner, userId: 'user-2' });
    await command(correction.id, 'finalize');
    expect(
      (await readRun(apiPool, { ...owner, ...allEntities, id: run.id }))
        ?.status,
    ).toBe('superseded');
  });

  it('writes exact non-zero accounting lines, a non-identifying result title, and five payable liabilities', async () => {
    const grossMapping = await asTenant(owner, (tx) =>
      tx.query<{ id: string }>(
        "select id from app.payroll_account_mapping where legal_entity_id=$1 and accounting_key='gross_pay' order by valid_from desc,id asc limit 1",
        [entityId],
      ),
    );
    await updateMapping(apiPool, {
      ...owner,
      ...allEntities,
      id: grossMapping.rows[0]!.id,
      body: {
        accountCode: '522',
        side: 'debit',
        validFrom: '2027-11-01',
        validTo: null,
      },
    });
    const run = await payrollRun('2027-11');
    await ready(run.id, { ...owner, userId: 'user-2' });
    const finalized = await command(run.id, 'finalize');
    if (!finalized?.documentId)
      throw new Error('Finalization unexpectedly returned no document.');
    const facts = await asTenant(owner, async (tx) => ({
      lines: (
        await tx.query<{
          line_no: number;
          account_code: string;
          side: string;
          amount: string;
        }>(
          'select line_no,account_code,side,amount::text from app.economic_event_line where event_id=(select id from app.economic_event where document_id=$1) order by line_no',
          [finalized.documentId],
        )
      ).rows,
      totals: (
        await tx.query<{ debit: string; credit: string }>(
          'select debit_total::text debit,credit_total::text credit from app.economic_event where document_id=$1',
          [finalized.documentId],
        )
      ).rows[0],
      titles: (
        await tx.query<{ title: string }>(
          'select d.title from app.document d join app.payroll_result_document l on l.document_id=d.id join app.payroll_result r on r.id=l.payroll_result_id where r.payroll_run_id=$1',
          [run.id],
        )
      ).rows,
      liabilities: (
        await tx.query<{
          kind: string;
          creditor_reference: string | null;
          amount: string;
          due_on: string;
          status: string;
          paid_at: string | null;
        }>(
          'select kind,creditor_reference,amount::text,due_on::text,status,paid_at::text from app.payroll_liability where payroll_run_id=$1 order by kind',
          [run.id],
        )
      ).rows,
    }));
    expect(facts.lines).toEqual([
      { line_no: 1, account_code: '522', side: 'debit', amount: '1000.0000' },
      { line_no: 2, account_code: '524', side: 'debit', amount: '300.0000' },
      { line_no: 3, account_code: '331', side: 'credit', amount: '740.0000' },
      { line_no: 4, account_code: '336', side: 'credit', amount: '450.0000' },
      { line_no: 5, account_code: '342', side: 'credit', amount: '100.0000' },
      { line_no: 6, account_code: '333', side: 'credit', amount: '10.0000' },
    ]);
    expect(facts.totals).toEqual({ debit: '1300.0000', credit: '1300.0000' });
    expect(facts.titles).toEqual([{ title: 'Payroll result' }]);
    expect(facts.liabilities).toEqual([
      {
        kind: 'health',
        creditor_reference: null,
        amount: '150.0000',
        due_on: '2027-11-30',
        status: 'open',
        paid_at: null,
      },
      {
        kind: 'income_tax',
        creditor_reference: null,
        amount: '100.0000',
        due_on: '2027-11-30',
        status: 'open',
        paid_at: null,
      },
      {
        kind: 'net_wages',
        creditor_reference: null,
        amount: '740.0000',
        due_on: '2027-11-30',
        status: 'open',
        paid_at: null,
      },
      {
        kind: 'other',
        creditor_reference: null,
        amount: '10.0000',
        due_on: '2027-11-30',
        status: 'open',
        paid_at: null,
      },
      {
        kind: 'social',
        creditor_reference: null,
        amount: '300.0000',
        due_on: '2027-11-30',
        status: 'open',
        paid_at: null,
      },
    ]);
    const paid = await command(run.id, 'record_payment', {
      paidAt: '2027-12-01T12:00:00.000Z',
      paymentReference: 'PAY-2027-11',
    });
    expect(paid).toMatchObject({
      status: 'paid',
      paymentReference: 'PAY-2027-11',
    });
    expect(
      await count(
        'payroll_liability',
        "payroll_run_id=$1 and status='paid' and paid_at='2027-12-01T12:00:00.000Z'::timestamptz",
        [run.id],
      ),
    ).toBe(5);
  });

  it('returns null for a restricted entity command without creating a command receipt', async () => {
    const run = await payrollRun('2025-08');
    const before = await count('payroll_command_receipt', 'true', []);
    expect(
      await commandRun(apiPool, {
        ...owner,
        legalEntityIds: [],
        id: run.id,
        command: 'validate',
        body: {},
        idempotencyKey: commandKey(),
      }),
    ).toBeNull();
    expect(await count('payroll_command_receipt', 'true', [])).toBe(before);
  });
});
