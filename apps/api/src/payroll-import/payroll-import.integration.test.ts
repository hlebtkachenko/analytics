import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createEmployee } from '../hr/hr-repository.js';
import { resolveStagedFilePath } from '../ingestion/staging.js';
import { createComponent } from '../payroll/payroll-repository.js';
import {
  DatabasePayrollImportRepository,
  PayrollImportEntityNotFoundError,
} from './payroll-import-repository.js';
import { validatePayrollImport } from './validate-payroll-import.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const owner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const specialist: TenantContext = {
  organizationId: 'org-1',
  role: 'admin',
  userId: 'user-2',
};
const allEntities = { legalEntityIds: null };
const header =
  'employeeNumber,grossPay,employeeSocial,employeeHealth,incomeTax,otherDeductions,netPay,employerSocial,employerHealth,employerCost,component:BONUS';
const validRow = 'EMP-ONE,100,10,5,15,0,70,20,10,130,5';
const stagingEnvironmentKey = ['BAP', 'UPLOAD', 'STAGING', 'DIR'].join('_');
let apiPool: DatabasePool;
let migratorPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let stagingDirectory = '';
let priorStagingDirectory: string | undefined;
let entityId = '';
let otherEntityId = '';
let repository: DatabasePayrollImportRepository;

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
  operation: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();
  try {
    return await withTenantContext(client, tenant, operation);
  } finally {
    client.release();
  }
}
async function ownerSql<T>(
  operation: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const tx = await migratorPool.connect();
  try {
    await tx.query('begin');
    await tx.query('set local role bap_owner');
    const value = await operation(tx);
    await tx.query('commit');
    return value;
  } catch (error) {
    await tx.query('rollback');
    throw error;
  } finally {
    tx.release();
  }
}
async function createEntity(name: string) {
  return asTenant(
    owner,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "insert into app.legal_entity(organization_id,name,kind,created_by) values($1,$2,'company',$3) returning id",
          [owner.organizationId, name, owner.userId],
        )
      ).rows[0]!.id,
  );
}
async function stageImport(
  contents: string,
  options: { user?: TenantContext; month?: string; entity?: string } = {},
) {
  const uploadId = randomUUID();
  await writeFile(resolveStagedFilePath(stagingDirectory, uploadId), contents);
  const caller = options.user ?? owner;
  const created = await repository.create({
    ...caller,
    legalEntityId: options.entity ?? entityId,
    payrollMonth: options.month ?? '2026-03-01',
    format: 'csv',
    filename: 'payroll.csv',
    byteSize: Buffer.byteLength(contents),
    idempotencyKey: randomUUID(),
    uploadId,
  });
  return {
    id: created.import.id,
    uploadId,
    payrollMonth: created.import.payrollMonth,
  };
}
async function validate(id: string, user = owner) {
  return validatePayrollImport({
    data: {
      organizationId: user.organizationId,
      payrollImportId: id,
      userId: user.userId,
    },
    pool: apiPool,
    stagingDirectory,
  });
}
async function importState(id: string) {
  return asTenant(
    owner,
    async (tx) =>
      (
        await tx.query<{
          status: string;
          row_count: number;
          error_count: number;
          error_report: unknown;
          payroll_run_id: string | null;
        }>(
          'select status,row_count,error_count,error_report,payroll_run_id from app.payroll_import where id=$1',
          [id],
        )
      ).rows[0]!,
  );
}
async function uploadStatus(id: string) {
  return asTenant(
    owner,
    async (tx) =>
      (
        await tx.query<{ status: string }>(
          'select status from app.upload where id=$1',
          [id],
        )
      ).rows[0]!.status,
  );
}
async function count(table: string, id: string) {
  return asTenant(owner, async (tx) =>
    Number(
      (
        await tx.query<{ count: string }>(
          table === 'payroll_result_component'
            ? `select count(*)::text as count from app.payroll_result_component component
               join app.payroll_result result on result.id=component.payroll_result_id
               where result.payroll_run_id=$1`
            : `select count(*)::text as count from app.${table} where payroll_run_id=$1`,
          [id],
        )
      ).rows[0]!.count,
    ),
  );
}

beforeAll(async () => {
  stagingDirectory = await mkdtemp(join(tmpdir(), 'bap-payroll-import-'));
  priorStagingDirectory = process.env[stagingEnvironmentKey];
  process.env[stagingEnvironmentKey] = stagingDirectory;
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
  await ownerSql(async (tx) => {
    await tx.query(
      "insert into auth.\"user\"(id,name,email,email_verified) values ('user-1','Owner','owner@example.test',true),('user-2','Specialist','specialist@example.test',true)",
    );
    await tx.query(
      "insert into auth.organization(id,name,slug) values ('org-1','One','one')",
    );
    await tx.query(
      "insert into auth.member(id,organization_id,user_id,role) values ('member-1','org-1','user-1','owner'),('member-2','org-1','user-2','admin')",
    );
  });
  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  repository = new DatabasePayrollImportRepository();
  (
    repository as unknown as { poolPromise: Promise<DatabasePool> }
  ).poolPromise = Promise.resolve(apiPool);
  entityId = await createEntity('Payroll entity');
  otherEntityId = await createEntity('Other entity');
  const employee = await createEmployee(apiPool, {
    ...owner,
    ...allEntities,
    body: {
      legalEntityId: entityId,
      employeeNumber: 'EMP-ONE',
      firstName: 'One',
      lastName: 'Employee',
      workEmail: null,
      workPhone: null,
    },
  });
  if (!employee) throw new Error('Employee seed failed.');
  const component = await createComponent(apiPool, {
    ...owner,
    ...allEntities,
    body: {
      legalEntityId: entityId,
      code: 'BONUS',
      name: 'Bonus',
      kind: 'earning',
      recurrence: 'one_off',
      accountingKey: 'BONUS',
    },
  });
  if (!component) throw new Error('Component seed failed.');
  await asTenant(owner, (tx) =>
    tx.query(
      "insert into app.hr_access_assignment(organization_id,legal_entity_id,user_id,access_role,created_by) values($1,$2,$3,'payroll_specialist',$4)",
      [owner.organizationId, entityId, specialist.userId, owner.userId],
    ),
  );
});
afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
  await rm(stagingDirectory, { recursive: true, force: true });
  if (priorStagingDirectory === undefined)
    delete process.env[stagingEnvironmentKey];
  else process.env[stagingEnvironmentKey] = priorStagingDirectory;
});

describe('payroll import PostgreSQL contract as bap_api', () => {
  it('validates staged bytes and atomically consumes exactly one imported draft with replay', async () => {
    const staged = await stageImport(`${header}\n${validRow}`);
    expect(staged.payrollMonth).toBe('2026-03-01');
    await validate(staged.id);
    expect(await importState(staged.id)).toMatchObject({
      status: 'validated',
      row_count: 1,
      error_count: 0,
      payroll_run_id: null,
    });
    expect(await uploadStatus(staged.uploadId)).toBe('completed');
    const first = await repository.consume({
      ...owner,
      ...allEntities,
      id: staged.id,
    });
    expect(first).toMatchObject({ replay: false, status: 'draft' });
    expect(await count('payroll_result', first!.runId)).toBe(1);
    expect(await count('payroll_result_component', first!.runId)).toBe(1);
    expect(await importState(staged.id)).toMatchObject({
      status: 'consumed',
      payroll_run_id: first!.runId,
    });
    expect(
      await repository.consume({ ...owner, ...allEntities, id: staged.id }),
    ).toEqual({ runId: first!.runId, replay: true, status: 'draft' });
    expect(await count('payroll_result', first!.runId)).toBe(1);
    await expect(
      readFile(resolveStagedFilePath(stagingDirectory, staged.uploadId)),
    ).rejects.toThrow();
  });
  it('records coded malformed, duplicate and cross-entity validation failures', async () => {
    const malformed = await stageImport('not,a,payroll,file');
    await validate(malformed.id);
    expect(await importState(malformed.id)).toMatchObject({
      status: 'failed',
      error_count: 1,
      error_report: [{ row: 1, field: 'header', code: 'invalid_header' }],
    });
    expect(await uploadStatus(malformed.uploadId)).toBe('failed');
    const invalidComponent = await stageImport(
      `${header},component:\n${validRow},1`,
      { month: '2026-01-01' },
    );
    await validate(invalidComponent.id);
    expect(await importState(invalidComponent.id)).toMatchObject({
      status: 'failed',
      error_report: [{ row: 1, field: 'header', code: 'invalid_header' }],
    });
    const duplicate = await stageImport(`${header}\n${validRow}\n${validRow}`, {
      month: '2026-04-01',
    });
    await validate(duplicate.id);
    expect((await importState(duplicate.id)).error_report).toContainEqual({
      row: 3,
      field: 'employeeNumber',
      code: 'duplicate_employee',
    });
    const foreign = await stageImport(
      `${header}\nFOREIGN,100,10,5,15,0,70,20,10,130,5`,
      { month: '2026-05-01', entity: otherEntityId },
    );
    await validate(foreign.id);
    expect((await importState(foreign.id)).error_report).toContainEqual({
      row: 2,
      field: 'employeeNumber',
      code: 'employee_not_found',
    });
  });
  it('rechecks removed assignment and restricted entity scope before validation writes', async () => {
    const noAssignment = await stageImport(`${header}\n${validRow}`, {
      user: specialist,
      month: '2026-06-01',
    });
    await asTenant(owner, (tx) =>
      tx.query(
        'delete from app.hr_access_assignment where user_id=$1 and legal_entity_id=$2',
        [specialist.userId, entityId],
      ),
    );
    await expect(validate(noAssignment.id, specialist)).rejects.toThrow(
      /payroll access/i,
    );
    expect(await importState(noAssignment.id)).toMatchObject({
      status: 'staged',
    });
    await expect(
      readFile(resolveStagedFilePath(stagingDirectory, noAssignment.uploadId)),
    ).resolves.toBeTruthy();
    await asTenant(owner, (tx) =>
      tx.query(
        "insert into app.hr_access_assignment(organization_id,legal_entity_id,user_id,access_role,created_by) values($1,$2,$3,'payroll_specialist',$4)",
        [owner.organizationId, entityId, specialist.userId, owner.userId],
      ),
    );
    const restricted = await stageImport(`${header}\n${validRow}`, {
      user: specialist,
      month: '2026-07-01',
    });
    await asTenant(owner, (tx) =>
      tx.query(
        "insert into app.member_entity_scope(organization_id,user_id,mode,updated_by) values($1,$2,'restricted',$3)",
        [owner.organizationId, specialist.userId, owner.userId],
      ),
    );
    await expect(validate(restricted.id, specialist)).rejects.toThrow(
      /entity scope/i,
    );
    expect(await importState(restricted.id)).toMatchObject({
      status: 'staged',
    });
    await expect(
      readFile(resolveStagedFilePath(stagingDirectory, restricted.uploadId)),
    ).resolves.toBeTruthy();
  });
  it('rejects a revoked membership before touching the staged import', async () => {
    const revoked = await stageImport(`${header}\n${validRow}`, {
      user: specialist,
      month: '2026-09-01',
    });
    await ownerSql((tx) =>
      tx.query("delete from auth.member where id='member-2'"),
    );
    await expect(validate(revoked.id, specialist)).rejects.toThrow(
      /no longer has write membership/i,
    );
    expect(await importState(revoked.id)).toMatchObject({ status: 'staged' });
    expect(await uploadStatus(revoked.uploadId)).toBe('pending');
    await expect(
      readFile(resolveStagedFilePath(stagingDirectory, revoked.uploadId)),
    ).resolves.toBeTruthy();
  });
  it('marks an enqueue failure without inventing a file validation error', async () => {
    const staged = await stageImport(`${header}\n${validRow}`, {
      month: '2026-11-01',
    });
    await repository.failEnqueue({ ...owner, id: staged.id });
    expect(await importState(staged.id)).toMatchObject({
      status: 'failed',
      error_count: 0,
      error_report: [],
    });
    expect(await uploadStatus(staged.uploadId)).toBe('failed');
  });
  it('treats an unknown entity as a controlled repository miss', async () => {
    await expect(
      stageImport(`${header}\n${validRow}`, {
        entity: '00000000-0000-4000-8000-000000000099',
        month: '2026-12-01',
      }),
    ).rejects.toBeInstanceOf(PayrollImportEntityNotFoundError);
  });
  it('leaves a validated import retryable when its staged file disappears', async () => {
    const staged = await stageImport(`${header}\n${validRow}`, {
      month: '2026-10-01',
    });
    await validate(staged.id);
    await unlink(resolveStagedFilePath(stagingDirectory, staged.uploadId));
    await expect(
      repository.consume({ ...owner, ...allEntities, id: staged.id }),
    ).rejects.toThrow(/ENOENT/);
    expect(await importState(staged.id)).toMatchObject({
      status: 'validated',
      payroll_run_id: null,
    });
    expect(await uploadStatus(staged.uploadId)).toBe('completed');
  });
  it('rolls back a forced component insert failure and keeps the validated file retryable', async () => {
    const staged = await stageImport(`${header}\n${validRow}`, {
      month: '2026-08-01',
    });
    await validate(staged.id);
    await ownerSql(async (tx) => {
      await tx.query(
        "create function app.test_payroll_import_failure() returns trigger language plpgsql as $$ begin raise exception 'forced component failure'; end $$",
      );
      await tx.query(
        'create trigger test_payroll_import_failure before insert on app.payroll_result_component for each row execute function app.test_payroll_import_failure()',
      );
    });
    try {
      await expect(
        repository.consume({ ...owner, ...allEntities, id: staged.id }),
      ).rejects.toThrow(/forced component failure/i);
    } finally {
      await ownerSql(async (tx) => {
        await tx.query(
          'drop trigger test_payroll_import_failure on app.payroll_result_component',
        );
        await tx.query('drop function app.test_payroll_import_failure()');
      });
    }
    expect(await importState(staged.id)).toMatchObject({
      status: 'validated',
      payroll_run_id: null,
    });
    expect(
      await asTenant(owner, async (tx) =>
        Number(
          (
            await tx.query<{ count: string }>(
              "select count(*)::text as count from app.payroll_run where payroll_month='2026-08-01'",
              [],
            )
          ).rows[0]!.count,
        ),
      ),
    ).toBe(0);
    await expect(
      readFile(resolveStagedFilePath(stagingDirectory, staged.uploadId)),
    ).resolves.toBeTruthy();
  });
});
