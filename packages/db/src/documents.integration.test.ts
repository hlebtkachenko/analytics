import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapDatabaseRoles,
  checkMigrationCompatibility,
  DATABASE_MIGRATION_COMPATIBILITY,
  runMigrations,
  withTenantContext,
} from './index.js';
import type { TenantContext } from './index.js';
import { endPools } from './integration-support.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

// Every app table the documents migration adds, in the order a reader meets them.
const documentTables = [
  'partner',
  'document',
  'document_attribute',
  'invoice',
  'invoice_line',
  'economic_event',
  'economic_event_line',
  'document_link',
  'data_issue',
] as const;

const waveTwoTenantTables = [
  'hr_access_assignment',
  'payroll_component_definition',
  'employee_compensation_component',
  'payroll_result_component',
  'payroll_liability',
  'payroll_approval',
  'payroll_account_mapping',
  'payroll_result_document',
  'payroll_import',
] as const;

const waveThreeTenantTables = [
  'work_schedule',
  'work_shift',
  'timesheet',
  'time_entry',
  'leave_type',
  'leave_request',
  'leave_ledger',
  'absence',
] as const;

// Neutral legal entity fixtures: two inside org-1, one inside org-2.
const ownedEntityId = '00000000-0000-4000-8000-0000000000e1';
const secondEntityId = '00000000-0000-4000-8000-0000000000e2';
const foreignEntityId = '00000000-0000-4000-8000-0000000000e3';

// Fixed identifiers keep the policy and cascade assertions exact.
const partnerId = '00000000-0000-4000-8000-0000000000b1';
const documentId = '00000000-0000-4000-8000-0000000000a1';
const relatedDocumentId = '00000000-0000-4000-8000-0000000000a2';
const invoiceLineId = '00000000-0000-4000-8000-0000000000c1';
const eventId = '00000000-0000-4000-8000-0000000000f1';
const cascadeDocumentId = '00000000-0000-4000-8000-0000000000a3';
const cascadeLineId = '00000000-0000-4000-8000-0000000000c3';
const cascadeEventId = '00000000-0000-4000-8000-0000000000f3';

const orgOneOwner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const orgOneMember: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-3',
};
const orgTwoOwner: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-2',
};

let apiPool: Pool;
let backupPool: Pool;
let container: StartedPostgreSqlContainer;
let migratorPool: Pool;
let reportingPool: Pool;
let rootPool: Pool;

function poolFor(user: string, password: string): Pool {
  const pool = new Pool({
    database: container.getDatabase(),
    host: container.getHost(),
    password,
    port: container.getPort(),
    user,
  });
  // pg emits 'error' on idle clients when the backend dies at teardown; swallow it so the container shutdown race is not an unhandled error.
  pool.on('error', () => undefined);
  return pool;
}

async function asOwner<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await migratorPool.connect();
  await client.query('begin');
  await client.query('set local role bap_owner');

  try {
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function asEraser<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await migratorPool.connect();
  await client.query('begin');
  await client.query('set local role bap_owner');
  await client.query('set local role bap_eraser');

  try {
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

// One tenant scoped transaction on a fresh connection, so a rejected statement cannot leak into the next assertion.
async function asTenant<T>(
  pool: Pool,
  context: TenantContext,
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await withTenantContext(client, context, operation);
  } finally {
    client.release();
  }
}

async function countRows(table: string): Promise<number> {
  const result = await rootPool.query<{ total: number }>(
    `select count(*)::integer as total from app.${table}`,
  );

  return result.rows[0]?.total ?? -1;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  rootPool = poolFor('postgres', testPassword);
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

  migratorPool = poolFor('bap_migrator', testPassword);
  apiPool = poolFor('bap_api', testPassword);
  reportingPool = poolFor('bap_reporting', testPassword);
  backupPool = poolFor('bap_backup', testPassword);
  await runMigrations(migratorPool);

  await asOwner(async (client) => {
    await client.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Owner', 'owner@example.test', true),
             ('user-2', 'Other', 'other@example.test', true),
             ('user-3', 'Member', 'reader@example.test', true)
    `);
    await client.query(`
      insert into auth.organization (id, name, slug)
      values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await client.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'owner'),
             ('member-3', 'org-1', 'user-3', 'member')
    `);
  });
  await rootPool.query(
    `insert into app.legal_entity (id, organization_id, name, kind, created_by)
     values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1'),
            ($2, 'org-1', 'Placeholder Trader', 'sole_trader', 'user-1'),
            ($3, 'org-2', 'Placeholder Foreign', 'company', 'user-2')`,
    [ownedEntityId, secondEntityId, foreignEntityId],
  );
});

describe('W2.5 payroll command database boundary', () => {
  it('enforces the W2.5 command receipt, payroll mapping, erasure, and manager boundary', async () => {
    const runId = '00000000-0000-4000-8000-000000000901';
    const receiptId = '00000000-0000-4000-8000-000000000902';
    const receiptActor = 'command-receipt-erasure-user';
    const commandHash = 'a'.repeat(64);

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, payroll_month, created_by)
         values ($1, 'org-1', $2, '2027-09-01', 'user-1')`,
        [runId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.payroll_command_receipt (id, organization_id, payroll_run_id, command, idempotency_key, request_hash, created_by)
         values ($1, 'org-1', $2, 'validate', '00000000-0000-4000-8000-000000000903', $3, 'user-1')`,
        [receiptId, runId, commandHash],
      );
    });
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query('savepoint invalid_shift');
      await expect(
        transaction.query(
          "update app.payroll_command_receipt set command = 'approve' where id = $1",
          [receiptId],
        ),
      ).rejects.toThrow(/permission denied/);
    });

    await rootPool.query(
      `insert into app.payroll_command_receipt (organization_id, payroll_run_id, command, idempotency_key, request_hash, created_by)
       values ('org-1', $1, 'correct', '00000000-0000-4000-8000-000000000904', $2, $3)`,
      [runId, commandHash, receiptActor],
    );
    const receiptSchema = await rootPool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'app' and table_name = 'payroll_command_receipt'
       order by ordinal_position`,
    );
    expect(receiptSchema.rows).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'organization_id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'payroll_run_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'command', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'idempotency_key', data_type: 'uuid', is_nullable: 'NO' },
      {
        column_name: 'request_hash',
        data_type: 'character',
        is_nullable: 'NO',
      },
      {
        column_name: 'result_payroll_run_id',
        data_type: 'uuid',
        is_nullable: 'YES',
      },
      {
        column_name: 'reason',
        data_type: 'character varying',
        is_nullable: 'YES',
      },
      { column_name: 'created_by', data_type: 'text', is_nullable: 'NO' },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
    ]);
    await expect(
      rootPool.query<{ definition: string }>(
        `select pg_get_constraintdef(oid) as definition from pg_constraint
         where conrelid = 'app.payroll_command_receipt'::regclass
         order by conname`,
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        {
          definition:
            "CHECK ((command = ANY (ARRAY['validate'::text, 'submit'::text, 'approve'::text, 'reject'::text, 'finalize'::text, 'record_payment'::text, 'correct'::text])))",
        },
        { definition: "CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text))" },
        {
          definition:
            'CHECK (((reason IS NULL) OR ((length((reason)::text) >= 1) AND (length((reason)::text) <= 500))))',
        },
        {
          definition:
            'FOREIGN KEY (payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT',
        },
        {
          definition:
            'FOREIGN KEY (result_payroll_run_id, organization_id) REFERENCES app.payroll_run(id, organization_id) ON DELETE RESTRICT',
        },
        { definition: 'UNIQUE (organization_id, idempotency_key)' },
      ]),
    });
    await expect(
      rootPool.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = 'app'
         and tablename = 'payroll_command_receipt' order by indexname`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { indexname: 'payroll_command_receipt_id_organization_key' },
        { indexname: 'payroll_command_receipt_idempotency_key' },
        { indexname: 'payroll_command_receipt_pkey' },
        { indexname: 'payroll_command_receipt_run_idx' },
      ],
    });
    await expect(
      rootPool.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class
         where oid = 'app.payroll_command_receipt'::regclass`,
      ),
    ).resolves.toMatchObject({
      rows: [{ relrowsecurity: true, relforcerowsecurity: true }],
    });
    await expect(
      rootPool.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
         where table_schema = 'app' and table_name = 'payroll_command_receipt'
           and grantee in ('bap_api', 'bap_reporting', 'bap_backup')
         order by grantee, privilege_type`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { grantee: 'bap_api', privilege_type: 'INSERT' },
        { grantee: 'bap_api', privilege_type: 'SELECT' },
        { grantee: 'bap_backup', privilege_type: 'SELECT' },
        { grantee: 'bap_reporting', privilege_type: 'SELECT' },
      ],
    });
    await expect(
      asTenant(reportingPool, orgOneOwner, (transaction) =>
        transaction.query(
          'select id from app.payroll_command_receipt where id = $1',
          [receiptId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ id: receiptId }] });
    await expect(
      asTenant(backupPool, orgOneOwner, (transaction) =>
        transaction.query(
          'select id from app.payroll_command_receipt where id = $1',
          [receiptId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ id: receiptId }] });
    await expect(
      rootPool.query<{ column_name: string; privilege_type: string }>(
        `select column_name, privilege_type from information_schema.column_privileges
         where table_schema = 'app' and table_name = 'payroll_command_receipt'
           and grantee = 'bap_eraser' order by privilege_type, column_name`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { column_name: 'created_by', privilege_type: 'SELECT' },
        { column_name: 'created_by', privilege_type: 'UPDATE' },
      ],
    });
    const erased = await asEraser((client) =>
      client.query<{ tombstone: string }>(
        'select app.erase_user($1) as tombstone',
        [receiptActor],
      ),
    );
    expect(erased.rows[0]?.tombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(
      rootPool.query(
        'select created_by from app.payroll_command_receipt where created_by = $1',
        [receiptActor],
      ),
    ).resolves.toMatchObject({ rows: [] });

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query(
          `insert into app.payroll_account_mapping (organization_id, legal_entity_id, accounting_key, account_code, side, valid_from, created_by)
           values ('org-1', $1, 'gross_pay', '52', 'debit', '2027-09-01', 'user-1')`,
          [ownedEntityId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_account_mapping_account_code_check',
      });
    });
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query(
          `insert into app.payroll_account_mapping (organization_id, legal_entity_id, accounting_key, account_code, side, valid_from, created_by)
           values ('org-1', $1, 'gross_pay', '999', 'debit', '2027-09-01', 'user-1')`,
          [ownedEntityId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_account_mapping_account_fkey',
      });
    });

    const functionProperties = await rootPool.query<{
      owner: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select owner.rolname as owner, procedure.prosecdef, procedure.proconfig
       from pg_proc procedure join pg_roles owner on owner.oid = procedure.proowner
       where procedure.oid = 'app.has_other_payroll_manager(text,uuid,text)'::regprocedure`,
    );
    expect(functionProperties.rows).toEqual([
      {
        owner: 'bap_owner',
        prosecdef: true,
        proconfig: ['search_path=app, auth, pg_temp'],
      },
    ]);
    await expect(
      rootPool.query<{ api_execute: boolean; public_execute: boolean }>(
        `select has_function_privilege('bap_api', 'app.has_other_payroll_manager(text,uuid,text)', 'EXECUTE') as api_execute,
                has_function_privilege('public', 'app.has_other_payroll_manager(text,uuid,text)', 'EXECUTE') as public_execute`,
      ),
    ).resolves.toMatchObject({
      rows: [{ api_execute: true, public_execute: false }],
    });
    await expect(apiPool.query('select * from auth.member')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      apiPool.query(
        "select app.has_other_payroll_manager('org-1', $1, 'user-1') as eligible",
        [ownedEntityId],
      ),
    ).resolves.toMatchObject({ rows: [{ eligible: false }] });
    await asOwner(async (client) => {
      await client.query(
        `insert into auth."user" (id, name, email, email_verified) values ('command-manager', 'Command Manager', 'command-manager@example.test', true)`,
      );
      await client.query(
        `insert into auth.member (id, organization_id, user_id, role) values ('command-manager-member', 'org-1', 'command-manager', 'member')`,
      );
    });
    await rootPool.query(
      `insert into app.hr_access_assignment (organization_id, legal_entity_id, user_id, access_role, created_by) values ('org-1', $1, 'command-manager', 'payroll_specialist', 'user-1')`,
      [ownedEntityId],
    );
    await expect(
      apiPool.query(
        "select app.has_other_payroll_manager('org-1', $1, 'user-1') as eligible",
        [ownedEntityId],
      ),
    ).resolves.toMatchObject({ rows: [{ eligible: true }] });
    await rootPool.query(
      `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by) values ('org-1', 'command-manager', 'restricted', 'user-1')`,
    );
    await expect(
      apiPool.query(
        "select app.has_other_payroll_manager('org-1', $1, 'user-1') as eligible",
        [ownedEntityId],
      ),
    ).resolves.toMatchObject({ rows: [{ eligible: false }] });
    await rootPool.query(
      `insert into app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by) values ('org-1', 'command-manager', $1, 'user-1')`,
      [ownedEntityId],
    );
    await expect(
      apiPool.query(
        "select app.has_other_payroll_manager('org-1', $1, 'user-1') as eligible",
        [ownedEntityId],
      ),
    ).resolves.toMatchObject({ rows: [{ eligible: true }] });
  });
});

afterAll(async () => {
  await endPools(apiPool, backupPool, migratorPool, reportingPool, rootPool);
  await container.stop();
});

describe('documents register isolation', () => {
  it('applies the documents migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260923.0004');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260923.0004');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260923.0004',
      version: '20260923.0004',
    });
  });

  it('enforces Wave 3 time and leave ranges, tenant pinning, immutable approval, and append-only ledger facts', async () => {
    const employeeId = '00000000-0000-4000-8000-000000000931';
    const relationshipId = '00000000-0000-4000-8000-000000000932';
    const scheduleId = '00000000-0000-4000-8000-000000000933';
    const timesheetId = '00000000-0000-4000-8000-000000000934';
    const leaveTypeId = '00000000-0000-4000-8000-000000000935';
    const ledgerId = '00000000-0000-4000-8000-000000000936';
    const leaveRequestId = '00000000-0000-4000-8000-000000000937';
    const successorTimesheetId = '00000000-0000-4000-8000-000000000938';
    const absenceId = '00000000-0000-4000-8000-000000000939';

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
         values ($1, 'org-1', $2, 'W3-FACTS', 'Wave', 'Three', 'user-1')`,
        [employeeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by)
         values ($1, 'org-1', $2, 'employment', 'Wave 3', 40, '2026-01-01', 'user-1')`,
        [relationshipId, employeeId],
      );
      await transaction.query(
        `insert into app.work_schedule (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, created_by)
         values ($1, 'org-1', $2, $3, $4, '2026-10-25', '2026-10-31', 'user-1')`,
        [scheduleId, ownedEntityId, employeeId, relationshipId],
      );
      await transaction.query(
        `insert into app.work_shift (organization_id, schedule_id, starts_at, ends_at, break_minutes, created_by)
         values ('org-1', $1, '2026-10-25 00:30+00', '2026-10-25 02:30+00', 30, 'user-1')`,
        [scheduleId],
      );
      await expect(
        transaction.query<{
          elapsed_minutes: number;
          ends_local: string;
          starts_local: string;
        }>(
          `select extract(epoch from ends_at - starts_at)::integer / 60 as elapsed_minutes,
                  to_char(starts_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as starts_local,
                  to_char(ends_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as ends_local
           from app.work_shift where schedule_id = $1`,
          [scheduleId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            elapsed_minutes: 120,
            starts_local: '2026-10-25 02:30',
            ends_local: '2026-10-25 03:30',
          },
        ],
      });
      await transaction.query('savepoint invalid_shift');
      await expect(
        transaction.query(
          `insert into app.work_shift (organization_id, schedule_id, starts_at, ends_at, created_by)
           values ('org-1', $1, '2026-10-25 02:30+00', '2026-10-25 00:30+00', 'user-1')`,
          [scheduleId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint invalid_shift');
      await transaction.query(
        `insert into app.timesheet (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, created_by)
         values ($1, 'org-1', $2, $3, $4, '2026-10-25', '2026-10-31', 'user-1')`,
        [timesheetId, ownedEntityId, employeeId, relationshipId],
      );
      await transaction.query(
        `insert into app.time_entry (organization_id, timesheet_id, work_date, started_at, ended_at, created_by)
         values ('org-1', $1, '2026-10-25', '2026-10-25 00:30+00', '2026-10-25 02:30+00', 'user-1')`,
        [timesheetId],
      );
      await transaction.query(
        `delete from app.time_entry where timesheet_id = $1`,
        [timesheetId],
      );
      await transaction.query(
        `insert into app.time_entry (organization_id, timesheet_id, work_date, started_at, ended_at, created_by)
         values ('org-1', $1, '2026-10-25', '2026-10-25 00:30+00', '2026-10-25 02:30+00', 'user-1')`,
        [timesheetId],
      );
      await transaction.query('savepoint overlap_entry');
      await expect(
        transaction.query(
          `insert into app.time_entry (organization_id, timesheet_id, work_date, started_at, ended_at, created_by)
           values ('org-1', $1, '2026-10-25', '2026-10-25 01:30+00', '2026-10-25 03:30+00', 'user-1')`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({ code: '23P01' });
      await transaction.query('rollback to savepoint overlap_entry');
      await transaction.query(
        `update app.timesheet set status = 'submitted', submitted_at = now() where id = $1`,
        [timesheetId],
      );
      await transaction.query(
        `update app.timesheet set status = 'approved', approved_by = 'user-1', approved_at = now() where id = $1`,
        [timesheetId],
      );
      await transaction.query('savepoint immutable_time_entry');
      await expect(
        transaction.query(
          `update app.time_entry set ended_at = '2026-10-25 02:45+00' where timesheet_id = $1`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint immutable_time_entry');
      await transaction.query('savepoint immutable_time_entry_delete');
      await expect(
        transaction.query(
          `delete from app.time_entry where timesheet_id = $1`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'time_entry_timesheet_status_check',
      });
      await transaction.query(
        'rollback to savepoint immutable_time_entry_delete',
      );
      await transaction.query('savepoint immutable_timesheet');
      await expect(
        transaction.query(
          `update app.timesheet set period_end = '2026-11-01' where id = $1`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint immutable_timesheet');
      await transaction.query(
        `update app.timesheet set status = 'corrected' where id = $1`,
        [timesheetId],
      );
      await transaction.query('savepoint immutable_corrected_timesheet');
      await expect(
        transaction.query(
          `update app.timesheet set period_end = '2026-11-01' where id = $1`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query(
        'rollback to savepoint immutable_corrected_timesheet',
      );
      await transaction.query(
        'savepoint immutable_corrected_time_entry_delete',
      );
      await expect(
        transaction.query(
          `delete from app.time_entry where timesheet_id = $1`,
          [timesheetId],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'time_entry_timesheet_status_check',
      });
      await transaction.query(
        'rollback to savepoint immutable_corrected_time_entry_delete',
      );
      await transaction.query(
        `insert into app.timesheet (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, version, supersedes_timesheet_id, created_by)
         values ($1, 'org-1', $2, $3, $4, '2026-10-25', '2026-10-31', 2, $5, 'user-1')`,
        [
          successorTimesheetId,
          ownedEntityId,
          employeeId,
          relationshipId,
          timesheetId,
        ],
      );
      await transaction.query(
        `insert into app.leave_type (id, organization_id, legal_entity_id, code, name, unit, paid, created_by)
         values ($1, 'org-1', $2, 'W3', 'Wave 3 leave', 'hours', true, 'user-1')`,
        [leaveTypeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.leave_ledger (id, organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, effective_on, amount, source, created_by)
         values ($1, 'org-1', $2, $3, $4, $5, '2026-10-25', 8, 'opening', 'user-1')`,
        [ledgerId, ownedEntityId, employeeId, relationshipId, leaveTypeId],
      );
      await transaction.query('savepoint ledger_update');
      await expect(
        transaction.query(
          `update app.leave_ledger set amount = 9 where id = $1`,
          [ledgerId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await transaction.query('rollback to savepoint ledger_update');
      await transaction.query('savepoint ledger_delete');
      await expect(
        transaction.query(`delete from app.leave_ledger where id = $1`, [
          ledgerId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await transaction.query('rollback to savepoint ledger_delete');
      await transaction.query('savepoint leave_dates');
      await expect(
        transaction.query(
          `insert into app.leave_request (organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, starts_on, ends_on, requested_amount, created_by)
           values ('org-1', $1, $2, $3, $4, '2026-10-26', '2026-10-25', 1, 'user-1')`,
          [ownedEntityId, employeeId, relationshipId, leaveTypeId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint leave_dates');
      await transaction.query('savepoint leave_pinning');
      await expect(
        transaction.query(
          `insert into app.leave_ledger (organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, effective_on, amount, source, created_by)
           values ('org-1', $1, $2, $3, $4, '2026-10-25', 1, 'opening', 'user-1')`,
          [secondEntityId, employeeId, relationshipId, leaveTypeId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint leave_pinning');
      await transaction.query(
        `insert into app.leave_request (id, organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, starts_on, ends_on, requested_amount, created_by)
         values ($1, 'org-1', $2, $3, $4, $5, '2026-10-26', '2026-10-26', 8, 'user-1')`,
        [
          leaveRequestId,
          ownedEntityId,
          employeeId,
          relationshipId,
          leaveTypeId,
        ],
      );
      await transaction.query('savepoint forbidden_leave_transition');
      await expect(
        transaction.query(
          `update app.leave_request set status = 'taken', decided_by = 'user-1', decided_at = now() where id = $1`,
          [leaveRequestId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query(
        'rollback to savepoint forbidden_leave_transition',
      );
      await transaction.query(
        `update app.leave_request set status = 'approved', decided_by = 'user-1', decided_at = now() where id = $1`,
        [leaveRequestId],
      );
      await transaction.query(
        `update app.leave_request set status = 'taken' where id = $1`,
        [leaveRequestId],
      );
      await transaction.query('savepoint terminal_leave_mutation');
      await expect(
        transaction.query(
          `update app.leave_request set reason = 'changed' where id = $1`,
          [leaveRequestId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await transaction.query('rollback to savepoint terminal_leave_mutation');
      await transaction.query(
        `insert into app.absence (id, organization_id, legal_entity_id, employee_id, relationship_id, kind, starts_on, payroll_code, created_by)
         values ($1, 'org-1', $2, $3, $4, 'unpaid', '2026-10-26', 'UNPAID', 'user-1')`,
        [absenceId, ownedEntityId, employeeId, relationshipId],
      );
    });

    await asTenant(apiPool, orgOneMember, async (transaction) => {
      await expect(
        transaction.query(
          `insert into app.leave_ledger (organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, effective_on, amount, source, created_by)
           values ('org-1', $1, $2, $3, $4, '2026-10-26', 1, 'opening', 'user-3')`,
          [ownedEntityId, employeeId, relationshipId, leaveTypeId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    await expect(
      rootPool.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where oid = any($1::regclass[]) order by relname`,
        [waveThreeTenantTables.map((table) => `app.${table}`)],
      ),
    ).resolves.toMatchObject({
      rows: waveThreeTenantTables
        .map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
        }))
        .sort((left, right) => left.relname.localeCompare(right.relname)),
    });
    await expect(
      rootPool.query<{ indexdef: string }>(
        `select pg_get_indexdef(indexrelid) as indexdef from pg_index
         where indexrelid in (
           'app.timesheet_entity_period_status_idx'::regclass,
           'app.leave_request_entity_status_starts_idx'::regclass
         ) order by indexrelid::regclass::text`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          indexdef:
            'CREATE INDEX leave_request_entity_status_starts_idx ON app.leave_request USING btree (organization_id, legal_entity_id, status, starts_on, id)',
        },
        {
          indexdef:
            'CREATE INDEX timesheet_entity_period_status_idx ON app.timesheet USING btree (organization_id, legal_entity_id, period_start DESC, status, id)',
        },
      ],
    });
    await expect(
      rootPool.query<{ policyname: string; tablename: string }>(
        `select policyname, tablename from pg_policies
         where schemaname = 'app' and tablename = any($1::text[]) and cmd = 'DELETE'`,
        [waveThreeTenantTables],
      ),
    ).resolves.toMatchObject({
      rows: [{ policyname: 'time_entry_delete', tablename: 'time_entry' }],
      rowCount: 1,
    });
    for (const table of waveThreeTenantTables) {
      expect(await countRows(table)).toBeGreaterThan(0);
      await expect(
        asTenant(apiPool, orgTwoOwner, (transaction) =>
          transaction.query(
            `select * from app.${table} where organization_id = 'org-1'`,
          ),
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      const reportingRows = await asTenant(
        reportingPool,
        orgOneOwner,
        (transaction) =>
          transaction.query(
            `select * from app.${table} where organization_id = 'org-1'`,
          ),
      );
      expect(reportingRows.rowCount).toBeGreaterThan(0);
      await expect(
        backupPool.query(`select * from app.${table}`),
      ).resolves.toMatchObject({
        rowCount: expect.any(Number),
      });
      await expect(
        backupPool.query(`delete from app.${table} where false`),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        rootPool.query<{ can_delete: boolean }>(
          `select has_table_privilege('bap_api', $1, 'DELETE') as can_delete`,
          [`app.${table}`],
        ),
      ).resolves.toMatchObject({
        rows: [{ can_delete: table === 'time_entry' }],
      });
    }
  });

  it('tombstones every Wave 3 actor field without changing approved and terminal facts', async () => {
    const subject = 'wave-three-erasure-user';
    const employeeId = '00000000-0000-4000-8000-000000000941';
    const relationshipId = '00000000-0000-4000-8000-000000000942';
    const scheduleId = '00000000-0000-4000-8000-000000000943';
    const timesheetId = '00000000-0000-4000-8000-000000000944';
    const leaveTypeId = '00000000-0000-4000-8000-000000000945';
    const leaveRequestId = '00000000-0000-4000-8000-000000000946';
    const ledgerId = '00000000-0000-4000-8000-000000000947';
    const absenceId = '00000000-0000-4000-8000-000000000948';

    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
       values ($1, 'org-1', $2, 'W3-ERASURE', 'Wave', 'Erasure', 'user-1')`,
      [employeeId, ownedEntityId],
    );
    await rootPool.query(
      `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by)
       values ($1, 'org-1', $2, 'employment', 'Wave 3 erasure', 40, '2026-01-01', 'user-1')`,
      [relationshipId, employeeId],
    );
    await rootPool.query(
      `insert into app.work_schedule (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, created_by)
       values ($1, 'org-1', $2, $3, $4, '2026-11-01', '2026-11-07', $5)`,
      [scheduleId, ownedEntityId, employeeId, relationshipId, subject],
    );
    await rootPool.query(
      `insert into app.work_shift (organization_id, schedule_id, starts_at, ends_at, created_by)
       values ('org-1', $1, '2026-11-01 08:00+00', '2026-11-01 16:00+00', $2)`,
      [scheduleId, subject],
    );
    await rootPool.query(
      `insert into app.timesheet (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, created_by)
       values ($1, 'org-1', $2, $3, $4, '2026-11-01', '2026-11-07', $5)`,
      [timesheetId, ownedEntityId, employeeId, relationshipId, subject],
    );
    await rootPool.query(
      `insert into app.time_entry (organization_id, timesheet_id, work_date, started_at, ended_at, created_by)
       values ('org-1', $1, '2026-11-01', '2026-11-01 08:00+00', '2026-11-01 16:00+00', $2)`,
      [timesheetId, subject],
    );
    await rootPool.query(
      `update app.timesheet set status = 'submitted', submitted_at = '2026-11-08 09:00+00' where id = $1`,
      [timesheetId],
    );
    await rootPool.query(
      `update app.timesheet set status = 'approved', approved_by = $2, approved_at = '2026-11-08 10:00+00' where id = $1`,
      [timesheetId, subject],
    );
    await rootPool.query(
      `insert into app.leave_type (id, organization_id, legal_entity_id, code, name, unit, paid, created_by)
       values ($1, 'org-1', $2, 'W3-ERASURE', 'Wave 3 erasure leave', 'hours', true, $3)`,
      [leaveTypeId, ownedEntityId, subject],
    );
    await rootPool.query(
      `insert into app.leave_request (id, organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, starts_on, ends_on, requested_amount, created_by)
       values ($1, 'org-1', $2, $3, $4, $5, '2026-11-02', '2026-11-02', 8, $6)`,
      [
        leaveRequestId,
        ownedEntityId,
        employeeId,
        relationshipId,
        leaveTypeId,
        subject,
      ],
    );
    await rootPool.query(
      `update app.leave_request set status = 'approved', decided_by = $2, decided_at = '2026-11-01 09:00+00' where id = $1`,
      [leaveRequestId, subject],
    );
    await rootPool.query(
      `update app.leave_request set status = 'taken' where id = $1`,
      [leaveRequestId],
    );
    await rootPool.query(
      `insert into app.leave_ledger (id, organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, effective_on, amount, source, created_by)
       values ($1, 'org-1', $2, $3, $4, $5, '2026-11-02', -8, 'request', $6)`,
      [
        ledgerId,
        ownedEntityId,
        employeeId,
        relationshipId,
        leaveTypeId,
        subject,
      ],
    );
    await rootPool.query(
      `insert into app.absence (id, organization_id, legal_entity_id, employee_id, relationship_id, kind, starts_on, ends_on, payroll_code, created_by)
       values ($1, 'org-1', $2, $3, $4, 'unpaid', '2026-11-02', '2026-11-02', 'UNPAID', $5)`,
      [absenceId, ownedEntityId, employeeId, relationshipId, subject],
    );

    await expect(
      asEraser((client) => client.query('select current_user')),
    ).resolves.toMatchObject({ rows: [{ current_user: 'bap_eraser' }] });
    const erased = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        [subject],
      ),
    );
    const tombstone = erased.rows[0]?.tombstone;
    expect(tombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(
      rootPool.query(
        `select schedule.created_by as schedule_created_by, shift.created_by as shift_created_by, timesheet.created_by as timesheet_created_by, timesheet.approved_by, timesheet.status as timesheet_status, timesheet.submitted_at::text as timesheet_submitted_at, timesheet.approved_at::text as timesheet_approved_at, entry.created_by as entry_created_by, entry.work_date::text as entry_work_date, leave_type.created_by as leave_type_created_by, request.created_by as request_created_by, request.decided_by, request.status as request_status, request.decided_at::text as request_decided_at, ledger.created_by as ledger_created_by, ledger.amount::text as ledger_amount, absence.created_by as absence_created_by, absence.kind as absence_kind
         from app.work_schedule schedule
         join app.work_shift shift on shift.schedule_id = schedule.id
         join app.timesheet timesheet on timesheet.id = $2
         join app.time_entry entry on entry.timesheet_id = timesheet.id
         join app.leave_type leave_type on leave_type.id = $3
         join app.leave_request request on request.id = $4
         join app.leave_ledger ledger on ledger.id = $5
         join app.absence absence on absence.id = $6
         where schedule.id = $1`,
        [
          scheduleId,
          timesheetId,
          leaveTypeId,
          leaveRequestId,
          ledgerId,
          absenceId,
        ],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          schedule_created_by: tombstone,
          shift_created_by: tombstone,
          timesheet_created_by: tombstone,
          approved_by: tombstone,
          timesheet_status: 'approved',
          timesheet_submitted_at: '2026-11-08 09:00:00+00',
          timesheet_approved_at: '2026-11-08 10:00:00+00',
          entry_created_by: tombstone,
          entry_work_date: '2026-11-01',
          leave_type_created_by: tombstone,
          request_created_by: tombstone,
          decided_by: tombstone,
          request_status: 'taken',
          request_decided_at: '2026-11-01 09:00:00+00',
          ledger_created_by: tombstone,
          ledger_amount: '-8.00',
          absence_created_by: tombstone,
          absence_kind: 'unpaid',
        },
      ],
    });
    await expect(
      asEraser((client) =>
        client.query<{ tombstone: string | null }>(
          'select app.erase_user($1) as tombstone',
          [subject],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ tombstone: null }] });
  });

  it('enforces the payroll workflow backfill contract, tenant pinning, and API-role update boundary', async () => {
    const runId = '00000000-0000-4000-8000-0000000007a1';
    const foreignRunId = '00000000-0000-4000-8000-0000000007a2';
    const employeeId = '00000000-0000-4000-8000-0000000007a3';
    const componentId = '00000000-0000-4000-8000-0000000007a4';
    const relationshipId = '00000000-0000-4000-8000-0000000007a5';

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
         values ($1, 'org-1', $2, 'PAY-7A3', 'Payroll', 'Fixture', 'user-1')`,
        [employeeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by)
         values ($1, 'org-1', $2, 'employment', 'Payroll fixture', 40, '2026-01-01', 'user-1')`,
        [relationshipId, employeeId],
      );
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, payroll_month, created_by)
         values ($1, 'org-1', $2, '2026-08-01', 'user-1')`,
        [runId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.payroll_component_definition (id, organization_id, legal_entity_id, code, name, kind, recurrence, accounting_key, created_by)
         values ($1, 'org-1', $2, 'PAY-7A4', 'Payroll fixture', 'earning', 'recurring', 'WAGES', 'user-1')`,
        [componentId, secondEntityId],
      );
    });
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query(
          `insert into app.employee_compensation_component (organization_id, employee_id, relationship_id, component_definition_id, valid_from, amount, created_by)
           values ('org-1', $1, $2, $3, '2026-08-01', 1, 'user-1')`,
          [employeeId, relationshipId, componentId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [runId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [runId],
      );
    });
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query(
          "update app.payroll_run set status = 'finalized' where id = $1",
          [runId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query(
          "update app.payroll_run set payroll_month = '2026-10-01' where id = $1",
          [runId],
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await asTenant(apiPool, orgTwoOwner, async (transaction) => {
      await expect(
        transaction.query('select * from app.payroll_run where id = $1', [
          runId,
        ]),
      ).resolves.toMatchObject({ rows: [] });
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, payroll_month, created_by)
         values ($1, 'org-2', $2, '2026-08-01', 'user-2')`,
        [foreignRunId, foreignEntityId],
      );
    });
    await asTenant(reportingPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query('select id from app.payroll_run where id = $1', [
          runId,
        ]),
      ).resolves.toMatchObject({ rows: [{ id: runId }] });
    });
    await asTenant(backupPool, orgOneOwner, async (transaction) => {
      await expect(
        transaction.query('select id from app.payroll_run where id = $1', [
          runId,
        ]),
      ).resolves.toMatchObject({ rows: [{ id: runId }] });
    });
    await expect(
      rootPool.query<{ columns: string; table_name: string }>(
        `select table_name, string_agg(column_name, ',' order by column_name) as columns
         from information_schema.column_privileges
         where table_schema = 'app' and grantee = 'bap_api' and privilege_type = 'UPDATE'
           and table_name in ('payroll_run', 'payroll_component_definition', 'employee_compensation_component', 'payroll_account_mapping', 'payroll_liability', 'payroll_import', 'hr_access_assignment')
         group by table_name order by table_name`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { table_name: 'employee_compensation_component', columns: 'valid_to' },
        { table_name: 'payroll_account_mapping', columns: 'valid_to' },
        { table_name: 'payroll_component_definition', columns: 'active,name' },
        {
          table_name: 'payroll_import',
          columns:
            'error_count,error_report,payroll_run_id,row_count,status,updated_at',
        },
        { table_name: 'payroll_liability', columns: 'paid_at,status' },
        {
          table_name: 'payroll_run',
          columns:
            'approved_at,approved_by,document_id,finalized_at,finalized_by,paid_at,paid_by,payment_reference,status,validation_summary',
        },
      ],
    });
  });

  it('seeds the shared chart of accounts and exposes it to reporting', async () => {
    await expect(
      reportingPool.query<{ total: number }>(
        'select count(*)::integer as total from app.directive_account',
      ),
    ).resolves.toMatchObject({ rows: [{ total: 218 }] });
    await expect(
      reportingPool.query<{ name_en: string; nature: string }>(
        "select name_en, nature from app.directive_account where code = '311'",
      ),
    ).resolves.toMatchObject({
      rows: [{ nature: 'ASSET' }],
    });
    // Shared reference data carries no tenant column, so it stays outside row level security.
    await expect(
      rootPool.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = 'app.directive_account'::regclass",
      ),
    ).resolves.toMatchObject({ rows: [{ relrowsecurity: false }] });
  });

  it('accepts a full document graph from an owner through bap_api', async () => {
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.partner (id, organization_id, name, registration_number, vat_number, country_code, created_by)
         values ($1, 'org-1', 'Placeholder Supplier', 'CZ-0001', 'CZ12345678', 'CZ', 'user-1')`,
        [partnerId],
      );
      await transaction.query(
        `insert into app.document (
           id, organization_id, legal_entity_id, kind, reference, title, partner_id,
           document_date, currency_code, total_amount, created_by
         )
         values ($1, 'org-1', $2, 'received_invoice', 'REF-0001', 'Placeholder received invoice', $3,
                 '2026-09-01', 'CZK', 121.00, 'user-1')`,
        [documentId, ownedEntityId, partnerId],
      );
      await transaction.query(
        `insert into app.document (
           id, organization_id, legal_entity_id, kind, reference, title, document_date, created_by
         )
         values ($1, 'org-1', $2, 'contract', 'REF-0002', 'Placeholder contract', '2026-08-01', 'user-1')`,
        [relatedDocumentId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.document_attribute (document_id, organization_id, key, value)
         values ($1, 'org-1', 'archive_box', 'placeholder-box')`,
        [documentId],
      );
      await transaction.query(
        `insert into app.invoice (
           document_id, organization_id, tax_point_date, due_date, variable_symbol,
           base_total, vat_total, gross_total
         )
         values ($1, 'org-1', '2026-09-01', '2026-09-15', '1234567890', 100.00, 21.00, 121.00)`,
        [documentId],
      );
      await transaction.query(
        `insert into app.invoice_line (
           id, organization_id, document_id, line_no, description, category,
           base_amount, vat_mode, vat_rate, vat_amount
         )
         values ($1, 'org-1', $2, 1, 'Placeholder line', 'services', 100.00, 'standard', 21.00, 21.00)`,
        [invoiceLineId, documentId],
      );
      await transaction.query(
        `insert into app.economic_event (
           id, organization_id, legal_entity_id, document_id, event_date,
           rule_set_version, is_balanced, debit_total, credit_total
         )
         values ($1, 'org-1', $2, $3, '2026-09-01', 'cz-default-2026-09', true, 121.00, 121.00)`,
        [eventId, ownedEntityId, documentId],
      );
      await transaction.query(
        `insert into app.economic_event_line (
           organization_id, event_id, line_no, account_code, side, amount, effective_date,
           partner_id, invoice_line_id, description
         )
         values ('org-1', $1, 1, '518', 'debit', 100.00, '2026-09-01', null, $2, 'Placeholder line'),
                ('org-1', $1, 2, '343', 'debit', 21.00, '2026-09-01', null, $2, 'Placeholder line'),
                ('org-1', $1, 3, '321', 'credit', 121.00, '2026-09-01', $3, $2, 'Placeholder line')`,
        [eventId, invoiceLineId, partnerId],
      );
      await transaction.query(
        `insert into app.document_link (organization_id, from_document_id, to_document_id, kind, created_by)
         values ('org-1', $1, $2, 'fulfills', 'user-1')`,
        [documentId, relatedDocumentId],
      );
      await transaction.query(
        `insert into app.data_issue (organization_id, document_id, code, severity, detail)
         values ('org-1', $1, 'missing_partner', 'warning', 'Placeholder detail')`,
        [documentId],
      );
    });

    const stored = await asTenant(apiPool, orgOneOwner, async (transaction) => {
      const result = await transaction.query<{
        account_codes: string[];
        attribute_value: string;
        gross_total: string;
        link_kind: string;
      }>(
        `select invoice.gross_total,
                attribute.value as attribute_value,
                link.kind as link_kind,
                array_agg(distinct trim(event_line.account_code) order by trim(event_line.account_code)) as account_codes
         from app.invoice as invoice
         inner join app.document_attribute as attribute on attribute.document_id = invoice.document_id
         inner join app.document_link as link on link.from_document_id = invoice.document_id
         inner join app.economic_event as event on event.document_id = invoice.document_id
         inner join app.economic_event_line as event_line on event_line.event_id = event.id
         where invoice.document_id = $1
         group by invoice.gross_total, attribute.value, link.kind`,
        [documentId],
      );

      return result.rows;
    });

    expect(stored).toEqual([
      {
        account_codes: ['321', '343', '518'],
        attribute_value: 'placeholder-box',
        gross_total: '121.0000',
        link_kind: 'fulfills',
      },
    ]);
  });

  it('hides every documents table from another organization', async () => {
    const visible = await asTenant(
      apiPool,
      orgTwoOwner,
      async (transaction) => {
        const totals: Record<string, number> = {};

        for (const table of documentTables) {
          const result = await transaction.query<{ total: number }>(
            `select count(*)::integer as total from app.${table}`,
          );
          totals[table] = result.rows[0]?.total ?? -1;
        }

        return totals;
      },
    );

    expect(visible).toEqual({
      data_issue: 0,
      document: 0,
      document_attribute: 0,
      document_link: 0,
      economic_event: 0,
      economic_event_line: 0,
      invoice: 0,
      invoice_line: 0,
      partner: 0,
    });
  });

  it('refuses a document write from a member and still allows the read', async () => {
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          `insert into app.document (organization_id, legal_entity_id, kind, title, document_date, created_by)
           values ('org-1', $1, 'receipt', 'Placeholder receipt', '2026-09-02', 'user-3')`,
          [ownedEntityId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.document',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });
  });

  it('refuses a document pinned to an entity of another organization', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.document (organization_id, legal_entity_id, kind, title, document_date, created_by)
           values ('org-1', $1, 'receipt', 'Placeholder foreign receipt', '2026-09-02', 'user-1')`,
          [foreignEntityId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'document_legal_entity_fkey',
    });
  });

  it('refuses invoice lines whose VAT contradicts their mode', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 2, 'Placeholder mismatch', 'services', 100.00, 'standard', 21.00, 15.00)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_vat_tolerance_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 3, 'Placeholder exempt', 'services', 100.00, 'exempt', 0, 21.00)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_vat_zero_check',
    });
    // Half a unit of rounding difference stays inside the tolerance.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 4, 'Placeholder rounded', 'services', 100.00, 'standard', 21.00, 21.40)`,
          [documentId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await rootPool.query('delete from app.invoice_line where line_no = 4');
  });

  it('refuses a negative amount on a line or on the invoice totals', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 5, 'Placeholder refund', 'services', -100.00, 'exempt', 0, 0)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_base_amount_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 6, 'Placeholder negative vat', 'services', 100.00, 'standard', 21.00, -21.00)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_vat_amount_check',
    });
    // Direction lives in the document kind, so a refund is a credit note and never a negative invoice.
    // The VAT offsets the base so the gross stays at zero and the amount due bound is not what refuses the row.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice (document_id, organization_id, base_total, vat_total, gross_total)
           values ($1, 'org-1', -100.00, 100.00, 0)`,
          [relatedDocumentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_totals_sign_check',
    });
    // A negative gross now trips the amount due bound first, because a zero advance already exceeds it.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice (document_id, organization_id, base_total, vat_total, gross_total)
           values ($1, 'org-1', -100.00, 0, -100.00)`,
          [relatedDocumentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_amount_due_check',
    });
  });

  it('refuses a link from a document to itself', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.document_link (organization_id, from_document_id, to_document_id, kind, created_by)
           values ('org-1', $1, $1, 'relates', 'user-1')`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'document_link_distinct_check',
    });
  });

  it('keeps one current document per entity, kind, and reference', async () => {
    const supersedingId = '00000000-0000-4000-8000-0000000000a4';

    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.document (
             id, organization_id, legal_entity_id, kind, reference, title, document_date, created_by
           )
           values ($1, 'org-1', $2, 'received_invoice', 'REF-0001', 'Placeholder duplicate', '2026-09-03', 'user-1')`,
          [supersedingId, ownedEntityId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'document_current_reference_key',
    });

    // Superseding the first version frees the reference, which is what a correction chain needs.
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        'update app.document set is_current = false where id = $1',
        [documentId],
      );
      await transaction.query(
        `insert into app.document (
           id, organization_id, legal_entity_id, kind, reference, title, document_date,
           version, supersedes_document_id, created_by
         )
         values ($1, 'org-1', $2, 'received_invoice', 'REF-0001', 'Placeholder version two', '2026-09-03',
                 2, $3, 'user-1')`,
        [supersedingId, ownedEntityId, documentId],
      );
    });

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query('delete from app.document where id = $1', [
        supersedingId,
      ]);
      await transaction.query(
        'update app.document set is_current = true where id = $1',
        [documentId],
      );
    });
  });

  it('destroys content, events, links, and issues with their document', async () => {
    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.document (
           id, organization_id, legal_entity_id, kind, reference, title, document_date, created_by
         )
         values ($1, 'org-1', $2, 'issued_invoice', 'REF-0003', 'Placeholder issued invoice', '2026-09-04', 'user-1')`,
        [cascadeDocumentId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.document_attribute (document_id, organization_id, key, value)
         values ($1, 'org-1', 'archive_box', 'placeholder-box-two')`,
        [cascadeDocumentId],
      );
      await transaction.query(
        `insert into app.invoice (document_id, organization_id, base_total, vat_total, gross_total)
         values ($1, 'org-1', 200.00, 42.00, 242.00)`,
        [cascadeDocumentId],
      );
      await transaction.query(
        `insert into app.invoice_line (
           id, organization_id, document_id, line_no, description, category,
           base_amount, vat_mode, vat_rate, vat_amount
         )
         values ($1, 'org-1', $2, 1, 'Placeholder sale', 'goods', 200.00, 'standard', 21.00, 42.00)`,
        [cascadeLineId, cascadeDocumentId],
      );
      await transaction.query(
        `insert into app.economic_event (
           id, organization_id, legal_entity_id, document_id, event_date,
           rule_set_version, is_balanced, debit_total, credit_total
         )
         values ($1, 'org-1', $2, $3, '2026-09-04', 'cz-default-2026-09', true, 242.00, 242.00)`,
        [cascadeEventId, ownedEntityId, cascadeDocumentId],
      );
      await transaction.query(
        `insert into app.economic_event_line (
           organization_id, event_id, line_no, account_code, side, amount, effective_date, invoice_line_id
         )
         values ('org-1', $1, 1, '311', 'debit', 242.00, '2026-09-04', $2),
                ('org-1', $1, 2, '604', 'credit', 200.00, '2026-09-04', $2),
                ('org-1', $1, 3, '343', 'credit', 42.00, '2026-09-04', $2)`,
        [cascadeEventId, cascadeLineId],
      );
      await transaction.query(
        `insert into app.document_link (organization_id, from_document_id, to_document_id, kind, created_by)
         values ('org-1', $1, $2, 'relates', 'user-1')`,
        [cascadeDocumentId, relatedDocumentId],
      );
      await transaction.query(
        `insert into app.data_issue (organization_id, document_id, code, severity)
         values ($1, $2, 'total_mismatch', 'warning')`,
        ['org-1', cascadeDocumentId],
      );
    });

    const before = {
      attributes: await countRows('document_attribute'),
      eventLines: await countRows('economic_event_line'),
      events: await countRows('economic_event'),
      invoiceLines: await countRows('invoice_line'),
      invoices: await countRows('invoice'),
      issues: await countRows('data_issue'),
      links: await countRows('document_link'),
    };
    expect(before).toEqual({
      attributes: 2,
      eventLines: 6,
      events: 2,
      invoiceLines: 2,
      invoices: 2,
      issues: 2,
      links: 2,
    });

    await asTenant(apiPool, orgOneOwner, (transaction) =>
      transaction.query('delete from app.document where id = $1', [
        cascadeDocumentId,
      ]),
    );

    const after = {
      attributes: await countRows('document_attribute'),
      eventLines: await countRows('economic_event_line'),
      events: await countRows('economic_event'),
      invoiceLines: await countRows('invoice_line'),
      invoices: await countRows('invoice'),
      issues: await countRows('data_issue'),
      links: await countRows('document_link'),
    };
    expect(after).toEqual({
      attributes: 1,
      eventLines: 3,
      events: 1,
      invoiceLines: 1,
      invoices: 1,
      issues: 1,
      links: 1,
    });
  });

  it('tombstones document, partner, and link attribution on erasure', async () => {
    const erasedPartnerId = '00000000-0000-4000-8000-0000000000b9';
    const erasedDocumentId = '00000000-0000-4000-8000-0000000000a9';
    const erasedLinkId = '00000000-0000-4000-8000-0000000000d9';

    await rootPool.query(
      `insert into app.partner (id, organization_id, name, created_by)
       values ($1, 'org-1', 'Placeholder Erased Supplier', 'erasure-user')`,
      [erasedPartnerId],
    );
    await rootPool.query(
      `insert into app.document (
         id, organization_id, legal_entity_id, kind, title, document_date, created_by
       )
       values ($1, 'org-1', $2, 'other', 'Placeholder erased document', '2026-09-05', 'erasure-user')`,
      [erasedDocumentId, ownedEntityId],
    );
    await rootPool.query(
      `insert into app.document_link (id, organization_id, from_document_id, to_document_id, kind, created_by)
       values ($1, 'org-1', $2, $3, 'relates', 'erasure-user')`,
      [erasedLinkId, erasedDocumentId, relatedDocumentId],
    );

    const erasure = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        ['erasure-user'],
      ),
    );
    const tombstone = erasure.rows[0]?.tombstone ?? null;
    expect(tombstone).toMatch(
      /^erased_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const attribution = await rootPool.query<{
      document_created_by: string;
      link_created_by: string;
      partner_created_by: string;
    }>(
      `select document.created_by as document_created_by,
              partner.created_by as partner_created_by,
              link.created_by as link_created_by
       from app.document as document
       inner join app.partner as partner on partner.id = $2
       inner join app.document_link as link on link.id = $3
       where document.id = $1`,
      [erasedDocumentId, erasedPartnerId, erasedLinkId],
    );
    expect(attribution.rows).toEqual([
      {
        document_created_by: tombstone,
        link_created_by: tombstone,
        partner_created_by: tombstone,
      },
    ]);
    // The owner's own rows keep their attribution: erasure names exactly one subject.
    await expect(
      rootPool.query<{ total: number }>(
        "select count(*)::integer as total from app.document where created_by = 'user-1'",
      ),
    ).resolves.toMatchObject({ rows: [{ total: 2 }] });

    await rootPool.query('delete from app.document where id = $1', [
      erasedDocumentId,
    ]);
    await rootPool.query('delete from app.partner where id = $1', [
      erasedPartnerId,
    ]);
  });

  it('dumps every documents table through bap_backup and refuses reporting writes', async () => {
    for (const table of documentTables) {
      await expect(
        backupPool.query(`select * from app.${table}`),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
    }
    await expect(
      backupPool.query<{ total: number }>(
        'select count(*)::integer as total from app.directive_account',
      ),
    ).resolves.toMatchObject({ rows: [{ total: 218 }] });

    await expect(
      reportingPool.query(
        `insert into app.document (organization_id, legal_entity_id, kind, title, document_date, created_by)
         values ('org-1', $1, 'receipt', 'Placeholder reporting receipt', '2026-09-06', 'user-1')`,
        [ownedEntityId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps payroll facts immutable and isolated while reporting can read them', async () => {
    const employeeId = '00000000-0000-4000-8000-0000000000e4';
    const payrollRunId = '00000000-0000-4000-8000-0000000000f4';
    const payrollResultId = '00000000-0000-4000-8000-0000000000f5';

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.employee (
           id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by
         )
         values ($1, 'org-1', $2, 'EMP-IMMUTABLE', 'Payroll', 'Employee', 'user-1')`,
        [employeeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.payroll_run (
           id, organization_id, legal_entity_id, document_id, payroll_month, created_by
         )
         values ($1, 'org-1', $2, $3, '2026-09-01', 'user-1')`,
        [payrollRunId, ownedEntityId, documentId],
      );
      await transaction.query(
        `insert into app.payroll_result (
           id, organization_id, payroll_run_id, employee_id,
           gross_pay, employee_social, employee_health, income_tax, other_deductions,
           net_pay, employer_social, employer_health, employer_cost
         )
         values ($1, 'org-1', $2, $3, 100, 0, 0, 0, 0, 100, 0, 0, 100)`,
        [payrollResultId, payrollRunId, employeeId],
      );
    });

    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          'update app.payroll_run set version = 2 where id = $1',
          [payrollRunId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('delete from app.payroll_result where id = $1', [
          payrollResultId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(reportingPool, orgOneOwner, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.payroll_run where id = $1',
          [payrollRunId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 1 }] });
    await expect(
      asTenant(apiPool, orgTwoOwner, (transaction) =>
        transaction.query<{ total: number }>(
          'select count(*)::integer as total from app.payroll_run where id = $1',
          [payrollRunId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ total: 0 }] });
  });

  it('enforces every payroll workflow edge, document finalization boundary, and draft side-effect boundary', async () => {
    const run = (suffix: string) =>
      `00000000-0000-4000-8000-0000000008${suffix}`;
    const draftRunId = run('01');
    const finalizedRunId = run('02');
    const paidRunId = run('03');
    const supersededRunId = run('04');
    const documentCount = await countRows('document');
    const eventCount = await countRows('economic_event');

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, payroll_month, created_by)
         values ($1, 'org-1', $2, '2026-11-01', 'user-1')`,
        [draftRunId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, created_by)
         values ($1, 'org-1', $2, $3, '2026-12-01', 'user-1'),
                ($4, 'org-1', $2, $3, '2027-01-01', 'user-1'),
                ($5, 'org-1', $2, $3, '2027-02-01', 'user-1')`,
        [finalizedRunId, ownedEntityId, documentId, paidRunId, supersededRunId],
      );
      for (const to of ['validating', 'draft']) {
        await transaction.query(
          'update app.payroll_run set status = $1 where id = $2',
          [to, draftRunId],
        );
      }
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [draftRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [draftRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'draft' where id = $1",
        [draftRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [draftRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [draftRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'approved' where id = $1",
        [draftRunId],
      );
      await transaction.query('savepoint required_document');
      await expect(
        transaction.query(
          "update app.payroll_run set status = 'finalized' where id = $1",
          [draftRunId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_run_document_finalized_check',
      });
      await transaction.query('rollback to savepoint required_document');
      await transaction.query('savepoint forbidden_draft_approved');
      await expect(
        transaction.query(
          "update app.payroll_run set status = 'approved' where id = $1",
          [finalizedRunId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_run_status_transition_check',
      });
      await transaction.query('rollback to savepoint forbidden_draft_approved');
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [finalizedRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [finalizedRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'approved' where id = $1",
        [finalizedRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'finalized' where id = $1",
        [finalizedRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [paidRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [paidRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'approved' where id = $1",
        [paidRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'finalized' where id = $1",
        [paidRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'paid' where id = $1",
        [paidRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'validating' where id = $1",
        [supersededRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'ready_for_approval' where id = $1",
        [supersededRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'approved' where id = $1",
        [supersededRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'finalized' where id = $1",
        [supersededRunId],
      );
      await transaction.query(
        "update app.payroll_run set status = 'superseded' where id = $1",
        [supersededRunId],
      );
      await transaction.query('savepoint forbidden_paid_finalized');
      await expect(
        transaction.query(
          "update app.payroll_run set status = 'finalized' where id = $1",
          [paidRunId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_run_status_transition_check',
      });
      await transaction.query('rollback to savepoint forbidden_paid_finalized');
      await transaction.query(
        "update app.payroll_run set status = 'superseded' where id = $1",
        [paidRunId],
      );
    });
    for (const [status, id] of [
      ['finalized', '00000000-0000-4000-8000-000000000851'],
      ['paid', '00000000-0000-4000-8000-000000000852'],
      ['superseded', '00000000-0000-4000-8000-000000000853'],
    ] as const) {
      await expect(
        asTenant(apiPool, orgOneOwner, (transaction) =>
          transaction.query(
            `insert into app.payroll_run (id, organization_id, legal_entity_id, payroll_month, status, created_by)
             values ($1, 'org-1', $2, '2027-06-01', $3, 'user-1')`,
            [id, ownedEntityId, status],
          ),
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_run_document_finalized_check',
      });
    }
    expect(await countRows('document')).toBe(documentCount);
    expect(await countRows('economic_event')).toBe(eventCount);
  });

  it('grants only the W2.1 API mutations and preserves append-only payroll facts', async () => {
    const employeeId = '00000000-0000-4000-8000-000000000811';
    const relationshipId = '00000000-0000-4000-8000-000000000812';
    const runId = '00000000-0000-4000-8000-000000000813';
    const resultId = '00000000-0000-4000-8000-000000000814';
    const componentId = '00000000-0000-4000-8000-000000000815';
    let assignmentId = '';
    let compensationId = '';
    let liabilityId = '';
    let approvalId = '';
    let mappingId = '';
    let resultComponentId = '';
    let resultDocumentId = '';
    let importId = '';
    let uploadId = '';

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by) values ($1, 'org-1', $2, 'W21-MUTABLE', 'Wave', 'Two', 'user-1')`,
        [employeeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by) values ($1, 'org-1', $2, 'employment', 'Wave 2', 40, '2026-01-01', 'user-1')`,
        [relationshipId, employeeId],
      );
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, created_by) values ($1, 'org-1', $2, $3, '2027-03-01', 'user-1')`,
        [runId, ownedEntityId, documentId],
      );
      await transaction.query(
        `insert into app.payroll_result (id, organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost) values ($1, 'org-1', $2, $3, 100, 0, 0, 0, 0, 100, 0, 0, 100)`,
        [resultId, runId, employeeId],
      );
      await transaction.query(
        `insert into app.payroll_component_definition (id, organization_id, legal_entity_id, code, name, kind, recurrence, accounting_key, created_by) values ($1, 'org-1', $2, 'W21', 'Wave 2', 'earning', 'recurring', 'WAGES', 'user-1')`,
        [componentId, ownedEntityId],
      );
      assignmentId = (
        await transaction.query<{ id: string }>(
          `insert into app.hr_access_assignment (organization_id, legal_entity_id, user_id, access_role, created_by) values ('org-1', $1, 'user-3', 'hr_admin', 'user-1') returning id`,
          [ownedEntityId],
        )
      ).rows[0]!.id;
      compensationId = (
        await transaction.query<{ id: string }>(
          `insert into app.employee_compensation_component (organization_id, employee_id, relationship_id, component_definition_id, valid_from, amount, created_by) values ('org-1', $1, $2, $3, '2027-03-01', 100, 'user-1') returning id`,
          [employeeId, relationshipId, componentId],
        )
      ).rows[0]!.id;
      liabilityId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_liability (organization_id, payroll_run_id, kind, amount, due_on, created_by) values ('org-1', $1, 'net_wages', 100, '2027-03-15', 'user-1') returning id`,
          [runId],
        )
      ).rows[0]!.id;
      approvalId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_approval (organization_id, payroll_run_id, action, actor_user_id, created_by) values ('org-1', $1, 'submitted', 'user-1', 'user-1') returning id`,
          [runId],
        )
      ).rows[0]!.id;
      mappingId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_account_mapping (organization_id, legal_entity_id, accounting_key, account_code, side, valid_from, created_by) values ('org-1', $1, 'WAGES', '521', 'debit', '2027-03-01', 'user-1') returning id`,
          [ownedEntityId],
        )
      ).rows[0]!.id;
      resultComponentId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_result_component (organization_id, payroll_result_id, component_definition_id, amount, source, created_by) values ('org-1', $1, $2, 100, 'calculated', 'user-1') returning id`,
          [resultId, componentId],
        )
      ).rows[0]!.id;
      resultDocumentId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_result_document (organization_id, payroll_result_id, document_id, kind, created_by) values ('org-1', $1, $2, 'payslip', 'user-1') returning id`,
          [resultId, documentId],
        )
      ).rows[0]!.id;
      uploadId = (
        await transaction.query<{ id: string }>(
          `insert into app.upload (organization_id, legal_entity_id, filename, byte_size) values ('org-1', $1, 'payroll.csv', 1) returning id`,
          [ownedEntityId],
        )
      ).rows[0]!.id;
      importId = (
        await transaction.query<{ id: string }>(
          `insert into app.payroll_import (organization_id, legal_entity_id, source_document_id, upload_id, idempotency_key, payroll_month, format, created_by) values ('org-1', $1, $2, $3, '00000000-0000-4000-8000-000000000816', '2026-09-01', 'csv', 'user-1') returning id`,
          [ownedEntityId, documentId, uploadId],
        )
      ).rows[0]!.id;

      await transaction.query(
        'update app.payroll_component_definition set name = $1, active = false where id = $2',
        ['Renamed', componentId],
      );
      await transaction.query(
        "update app.employee_compensation_component set valid_to = '2027-03-31' where id = $1",
        [compensationId],
      );
      await transaction.query(
        "update app.payroll_account_mapping set valid_to = '2027-03-31' where id = $1",
        [mappingId],
      );
      await transaction.query(
        "update app.payroll_liability set status = 'paid', paid_at = now() where id = $1",
        [liabilityId],
      );
      await transaction.query(
        "update app.payroll_import set status = 'validated', row_count = 1, error_count = 0, error_report = '[]'::jsonb where id = $1",
        [importId],
      );
      await transaction.query(
        'delete from app.hr_access_assignment where id = $1',
        [assignmentId],
      );

      for (const statement of [
        [
          'update app.payroll_component_definition set code = $1 where id = $2',
          ['NOPE', componentId],
        ],
        [
          'update app.employee_compensation_component set amount = 101 where id = $1',
          [compensationId],
        ],
        [
          'update app.payroll_account_mapping set account_code = $1 where id = $2',
          ['999', mappingId],
        ],
        [
          'update app.payroll_liability set amount = 101 where id = $1',
          [liabilityId],
        ],
        [
          'update app.payroll_import set format = $1 where id = $2',
          ['xlsx', importId],
        ],
        [
          'update app.hr_access_assignment set access_role = $1 where id = $2',
          ['hr_auditor', assignmentId],
        ],
        [
          'update app.payroll_result set gross_pay = 101 where id = $1',
          [resultId],
        ],
        ['delete from app.payroll_result where id = $1', [resultId]],
        [
          'update app.payroll_result_component set amount = 101 where id = $1',
          [resultComponentId],
        ],
        [
          'delete from app.payroll_result_component where id = $1',
          [resultComponentId],
        ],
        [
          'update app.payroll_result_document set kind = $1 where id = $2',
          ['supporting', resultDocumentId],
        ],
        [
          'delete from app.payroll_result_document where id = $1',
          [resultDocumentId],
        ],
        [
          'update app.payroll_approval set reason = $1 where id = $2',
          ['changed', approvalId],
        ],
        ['delete from app.payroll_approval where id = $1', [approvalId]],
      ] as const) {
        await transaction.query('savepoint forbidden_mutation');
        await expect(
          transaction.query(statement[0], [...statement[1]]),
        ).rejects.toMatchObject({ code: '42501' });
        await transaction.query('rollback to savepoint forbidden_mutation');
      }
    });
  });

  it('pins compensation, result components, result documents, and imports to their legal entity', async () => {
    const employeeId = '00000000-0000-4000-8000-000000000821';
    const relationshipId = '00000000-0000-4000-8000-000000000822';
    const runId = '00000000-0000-4000-8000-000000000823';
    const resultId = '00000000-0000-4000-8000-000000000824';
    const ownedComponentId = '00000000-0000-4000-8000-000000000825';
    const foreignComponentId = '00000000-0000-4000-8000-000000000826';
    const secondDocumentId = '00000000-0000-4000-8000-000000000827';
    const importUploadId = '00000000-0000-4000-8000-000000000828';

    await asTenant(apiPool, orgOneOwner, async (transaction) => {
      await transaction.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by) values ($1, 'org-1', $2, 'W21-PIN', 'Wave', 'Pin', 'user-1')`,
        [employeeId, ownedEntityId],
      );
      await transaction.query(
        `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by) values ($1, 'org-1', $2, 'employment', 'Wave 2', 40, '2026-01-01', 'user-1')`,
        [relationshipId, employeeId],
      );
      await transaction.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, created_by) values ($1, 'org-1', $2, $3, '2027-04-01', 'user-1')`,
        [runId, ownedEntityId, documentId],
      );
      await transaction.query(
        `insert into app.payroll_result (id, organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost) values ($1, 'org-1', $2, $3, 100, 0, 0, 0, 0, 100, 0, 0, 100)`,
        [resultId, runId, employeeId],
      );
      await transaction.query(
        `insert into app.payroll_component_definition (id, organization_id, legal_entity_id, code, name, kind, recurrence, accounting_key, created_by) values ($1, 'org-1', $2, 'W21PIN', 'Pinned', 'earning', 'recurring', 'WAGES', 'user-1'), ($3, 'org-1', $4, 'W21OTHER', 'Other', 'earning', 'recurring', 'WAGES', 'user-1')`,
        [ownedComponentId, ownedEntityId, foreignComponentId, secondEntityId],
      );
      await transaction.query(
        `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by) values ($1, 'org-1', $2, 'payroll', 'Second entity payroll source', '2027-04-01', 'user-1')`,
        [secondDocumentId, secondEntityId],
      );
      await transaction.query(
        `insert into app.upload (id, organization_id, legal_entity_id, filename, byte_size) values ($1, 'org-1', $2, 'payroll.csv', 1)`,
        [importUploadId, ownedEntityId],
      );
      for (const [statement, parameters, constraint] of [
        [
          `insert into app.employee_compensation_component (organization_id, employee_id, relationship_id, component_definition_id, valid_from, amount, created_by) values ('org-1', $1, $2, $3, '2027-04-01', 1, 'user-1')`,
          [employeeId, relationshipId, foreignComponentId],
          'employee_compensation_component_entity_pinning_check',
        ],
        [
          `insert into app.payroll_result_component (organization_id, payroll_result_id, component_definition_id, amount, source, created_by) values ('org-1', $1, $2, 1, 'calculated', 'user-1')`,
          [resultId, foreignComponentId],
          'payroll_result_component_entity_pinning_check',
        ],
        [
          `insert into app.payroll_result_document (organization_id, payroll_result_id, document_id, kind, created_by) values ('org-1', $1, $2, 'supporting', 'user-1')`,
          [resultId, secondDocumentId],
          'payroll_result_document_entity_pinning_check',
        ],
        [
          `insert into app.payroll_import (organization_id, legal_entity_id, source_document_id, upload_id, idempotency_key, payroll_month, format, created_by) values ('org-1', $1, $2, $3, '00000000-0000-4000-8000-000000000828', '2026-09-01', 'csv', 'user-1')`,
          [ownedEntityId, secondDocumentId, importUploadId],
          'payroll_import_entity_pinning_check',
        ],
      ] as const) {
        await transaction.query('savepoint invalid_entity_pinning');
        await expect(
          transaction.query(statement, [...parameters]),
        ).rejects.toMatchObject({ constraint });
        await transaction.query('rollback to savepoint invalid_entity_pinning');
      }
      await transaction.query(
        `insert into app.payroll_import (organization_id, legal_entity_id, source_document_id, upload_id, idempotency_key, payroll_month, format, created_by) values ('org-1', $1, $2, $3, '00000000-0000-4000-8000-000000000829', '2026-09-01', 'csv', 'user-1')`,
        [ownedEntityId, documentId, importUploadId],
      );
      await transaction.query('savepoint duplicate_import');
      await expect(
        transaction.query(
          `insert into app.payroll_import (organization_id, legal_entity_id, source_document_id, upload_id, idempotency_key, payroll_month, format, created_by) values ('org-1', $1, $2, $3, '00000000-0000-4000-8000-000000000829', '2026-09-01', 'csv', 'user-1')`,
          [ownedEntityId, documentId, importUploadId],
        ),
      ).rejects.toMatchObject({ constraint: 'payroll_import_idempotency_key' });
      await transaction.query('rollback to savepoint duplicate_import');
      await transaction.query('savepoint duplicate_liability');
      await expect(
        transaction.query(
          `insert into app.payroll_liability (organization_id, payroll_run_id, kind, amount, due_on, created_by) values ('org-1', $1, 'social', 1, '2027-04-15', 'user-1'), ('org-1', $1, 'social', 1, '2027-04-16', 'user-1')`,
          [runId],
        ),
      ).rejects.toMatchObject({
        constraint: 'payroll_liability_run_kind_creditor_key',
      });
      await transaction.query('rollback to savepoint duplicate_liability');
    });
  });

  it('isolates every new tenant table and grants reporting and backup read access through catalog loops', async () => {
    const policies = await rootPool.query<{ tablename: string }>(
      `select tablename from pg_policies where schemaname = 'app' and policyname like '%_select' and tablename = any($1) order by tablename`,
      [waveTwoTenantTables],
    );
    expect(policies.rows.map(({ tablename }) => tablename)).toEqual(
      [...waveTwoTenantTables].sort(),
    );
    for (const table of waveTwoTenantTables) {
      await expect(
        asTenant(apiPool, orgTwoOwner, (transaction) =>
          transaction.query(`select * from app.${table}`),
        ),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        asTenant(reportingPool, orgOneOwner, (transaction) =>
          transaction.query(`select * from app.${table}`),
        ),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
      await expect(
        asTenant(backupPool, orgOneOwner, (transaction) =>
          transaction.query(`select * from app.${table}`),
        ),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
    }
  });

  it('erases W2.1 assignment, approval, and payroll-run actor attribution', async () => {
    const subject = 'wave-two-erasure-user';
    const runId = '00000000-0000-4000-8000-000000000831';
    let assignmentId = '';
    let approvalId = '';
    await rootPool.query(
      `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, approved_by, finalized_by, paid_by, created_by) values ($1, 'org-1', $2, $3, '2027-05-01', $4, $4, $4, 'user-1')`,
      [runId, ownedEntityId, documentId, subject],
    );
    assignmentId = (
      await rootPool.query<{ id: string }>(
        `insert into app.hr_access_assignment (organization_id, legal_entity_id, user_id, access_role, created_by) values ('org-1', $1, $2, 'payroll_approver', 'user-1') returning id`,
        [ownedEntityId, subject],
      )
    ).rows[0]!.id;
    approvalId = (
      await rootPool.query<{ id: string }>(
        `insert into app.payroll_approval (organization_id, payroll_run_id, action, actor_user_id, created_by) values ('org-1', $1, 'approved', $2, 'user-1') returning id`,
        [runId, subject],
      )
    ).rows[0]!.id;
    const erased = await asEraser((transaction) =>
      transaction.query<{ tombstone: string }>(
        'select app.erase_user($1) as tombstone',
        [subject],
      ),
    );
    const tombstone = erased.rows[0]!.tombstone;
    expect(tombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(
      rootPool.query<{ user_id: string }>(
        'select user_id from app.hr_access_assignment where id = $1',
        [assignmentId],
      ),
    ).resolves.toMatchObject({ rows: [{ user_id: tombstone }] });
    await expect(
      rootPool.query<{ actor_user_id: string }>(
        'select actor_user_id from app.payroll_approval where id = $1',
        [approvalId],
      ),
    ).resolves.toMatchObject({ rows: [{ actor_user_id: tombstone }] });
    await expect(
      rootPool.query<{
        approved_by: string;
        finalized_by: string;
        paid_by: string;
      }>(
        'select approved_by, finalized_by, paid_by from app.payroll_run where id = $1',
        [runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { approved_by: tombstone, finalized_by: tombstone, paid_by: tombstone },
      ],
    });
  });

  it('enforces Wave 0.3 HR constraints and accepts their boundaries', async () => {
    const employeeId = '00000000-0000-4000-8000-0000000000d1';
    const relationshipId = '00000000-0000-4000-8000-0000000000d2';
    const runId = '00000000-0000-4000-8000-0000000000d3';
    const resultId = '00000000-0000-4000-8000-0000000000d4';
    const boundaryEmployee = (
      firstName: string,
      lastName: string,
      email = 'boundary@example.test',
    ) =>
      rootPool.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, work_email, work_phone, created_by)
         values ($1, 'org-1', $2, $3, $4, $5, $6, $7, 'user-1')`,
        [
          employeeId,
          ownedEntityId,
          `W03-${firstName}-${lastName}`,
          firstName,
          lastName,
          email,
          '1'.repeat(64),
        ],
      );

    await expect(boundaryEmployee(' Trimmed', 'Name')).rejects.toMatchObject({
      constraint: 'employee_name_check',
    });
    await expect(
      boundaryEmployee('Valid', 'Email', 'x'.repeat(255)),
    ).rejects.toMatchObject({ constraint: 'employee_work_email_length_check' });
    await expect(
      rootPool.query(
        `insert into app.employee (organization_id, legal_entity_id, employee_number, first_name, last_name, work_phone, created_by)
       values ('org-1', $1, 'W03-PHONE', 'Valid', 'Phone', $2, 'user-1')`,
        [ownedEntityId, '1'.repeat(65)],
      ),
    ).rejects.toMatchObject({ constraint: 'employee_work_phone_length_check' });
    await expect(
      rootPool.query(
        `insert into app.employment_relationship (organization_id, employee_id, kind, position, department, weekly_hours, start_date, created_by)
       values ('org-1', $1, 'employment', 'Position', $2, 40, '2026-01-01', 'user-1')`,
        [employeeId, 'd'.repeat(201)],
      ),
    ).rejects.toMatchObject({
      constraint: 'employment_relationship_department_check',
    });
    await expect(
      rootPool.query(
        `insert into app.employment_relationship (organization_id, employee_id, kind, position, cost_centre, weekly_hours, start_date, created_by)
       values ('org-1', $1, 'employment', 'Position', $2, 40, '2026-01-01', 'user-1')`,
        [employeeId, 'c'.repeat(65)],
      ),
    ).rejects.toMatchObject({
      constraint: 'employment_relationship_cost_centre_check',
    });

    await boundaryEmployee('Valid', 'Boundary', 'x'.repeat(254));
    await rootPool.query(
      `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, department, cost_centre, weekly_hours, start_date, created_by)
       values ($1, 'org-1', $2, 'employment', 'Position', $3, $4, 40, '2026-01-01', 'user-1')`,
      [relationshipId, employeeId, 'd'.repeat(200), 'c'.repeat(64)],
    );
    await expect(
      rootPool.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, supersedes_payroll_run_id, created_by)
       values ($1, 'org-1', $2, $3, '2026-10-01', $1, 'user-1')`,
        [runId, ownedEntityId, documentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'payroll_run_supersedes_not_self_check',
    });
    await rootPool.query(
      `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, created_by)
       values ($1, 'org-1', $2, $3, '2026-10-01', 'user-1')`,
      [runId, ownedEntityId, documentId],
    );
    await expect(
      rootPool.query(
        `insert into app.payroll_result (id, organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost)
       values ($1, 'org-1', $2, $3, 100, 1, 2, 3, 4, 91, 5, 6, 118)`,
        [resultId, runId, employeeId],
      ),
    ).rejects.toMatchObject({ constraint: 'payroll_result_arithmetic_check' });
    await expect(
      rootPool.query(
        `insert into app.payroll_result (organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost)
       values ('org-1', $1, $2, 100, 1, 2, 3, 4, 90, 5, 6, 111)`,
        [runId, employeeId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      rootPool.query(
        `insert into app.payroll_result (organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost)
       values ('org-2', $1, $2, 100, 0, 0, 0, 0, 100, 0, 0, 100)`,
        [runId, employeeId],
      ),
    ).rejects.toMatchObject({
      constraint: 'payroll_result_tenant_consistency_check',
    });
  });

  it('erases existing and HR attribution through one combined function', async () => {
    const hrEmployeeId = '00000000-0000-4000-8000-0000000000e5';
    const mixedEmployeeId = '00000000-0000-4000-8000-0000000000e6';
    const mixedPartnerId = '00000000-0000-4000-8000-0000000000b6';
    const hrUser = 'hr-erasure-user';
    const oldUser = 'old-erasure-user';
    const mixedUser = 'mixed-erasure-user';

    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
       values ($1, 'org-1', $2, 'EMP-ERASURE-HR', 'Erasure', 'HR', $3),
              ($4, 'org-1', $2, 'EMP-ERASURE-MIXED', 'Erasure', 'Mixed', $5)`,
      [hrEmployeeId, ownedEntityId, hrUser, mixedEmployeeId, mixedUser],
    );
    await rootPool.query(
      `insert into app.partner (id, organization_id, name, created_by)
       values ($1, 'org-1', 'Placeholder mixed supplier', $2),
              ('00000000-0000-4000-8000-0000000000b7', 'org-1', 'Placeholder old supplier', $3)`,
      [mixedPartnerId, mixedUser, oldUser],
    );

    const privileges = await asEraser((client) =>
      client.query<{ helper: string | null; combined: boolean }>(
        `select to_regprocedure('app.erase_user_before_hr(text)')::text as helper,
                has_function_privilege(current_user, 'app.erase_user(text)', 'EXECUTE') as combined`,
      ),
    );
    expect(privileges.rows).toEqual([{ helper: null, combined: true }]);

    const erase = async (subject: string) =>
      asEraser((client) =>
        client.query<{ tombstone: string | null }>(
          'select app.erase_user($1) as tombstone',
          [subject],
        ),
      );
    const hrTombstone = (await erase(hrUser)).rows[0]?.tombstone;
    const oldTombstone = (await erase(oldUser)).rows[0]?.tombstone;
    const mixedTombstone = (await erase(mixedUser)).rows[0]?.tombstone;
    expect(hrTombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    expect(oldTombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    expect(mixedTombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(erase('no-hr-or-existing-attribution')).resolves.toMatchObject(
      {
        rows: [{ tombstone: null }],
      },
    );
    await expect(
      rootPool.query<{ total: number }>(
        `select count(*)::integer as total from app.employee
         where created_by is null or created_by in ($1, $2, $3)`,
        [hrUser, oldUser, mixedUser],
      ),
    ).resolves.toMatchObject({ rows: [{ total: 0 }] });
    await expect(
      rootPool.query<{ created_by: string }>(
        'select created_by from app.employee where id = $1',
        [mixedEmployeeId],
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: mixedTombstone }] });
    await expect(
      rootPool.query<{ created_by: string }>(
        'select created_by from app.partner where id = $1',
        [mixedPartnerId],
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: mixedTombstone }] });
  });

  it('enforces the Wave 1 lifecycle catalog, isolation, and erasure grants', async () => {
    const employeeId = '00000000-0000-4000-8000-0000000000f6';
    const managerId = '00000000-0000-4000-8000-0000000000f7';
    const relationshipId = '00000000-0000-4000-8000-0000000000f8';
    const secondRelationshipId = '00000000-0000-4000-8000-0000000000f0';
    const positionId = '00000000-0000-4000-8000-0000000000f9';
    const foreignPositionId = '00000000-0000-4000-8000-0000000000fa';
    const foreignDocumentId = '00000000-0000-4000-8000-0000000000fb';
    const templateId = '00000000-0000-4000-8000-0000000000fc';
    const foreignTemplateId = '00000000-0000-4000-8000-0000000000fd';
    const checklistId = '00000000-0000-4000-8000-0000000000fe';

    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
       values ($1, 'org-1', $2, 'EMP-LIFECYCLE', 'Lifecycle', 'Employee', 'user-1'),
              ($3, 'org-1', $2, 'EMP-LIFECYCLE-MANAGER', 'Lifecycle', 'Manager', 'user-1')`,
      [employeeId, ownedEntityId, managerId],
    );
    await rootPool.query(
      `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by)
       values ($1, 'org-1', $2, 'employment', 'Legacy lifecycle position', 40, '2026-01-01', 'user-1'),
              ($3, 'org-1', $2, 'employment', 'Second legacy lifecycle position', 40, '2026-01-01', 'user-1')`,
      [relationshipId, employeeId, secondRelationshipId],
    );
    await rootPool.query(
      `insert into app.hr_position (id, organization_id, legal_entity_id, code, name, created_by)
       values ($1, 'org-1', $2, 'LIFECYCLE', 'Lifecycle position', 'user-1'),
              ($3, 'org-1', $4, 'FOREIGN', 'Foreign position', 'user-1')`,
      [positionId, ownedEntityId, foreignPositionId, secondEntityId],
    );
    await rootPool.query(
      `insert into app.employment_term (organization_id, employee_id, relationship_id, effective_from, position_id, manager_employee_id, weekly_hours, working_time_pattern, created_by)
       values ('org-1', $1, $2, '2026-01-01', $3, $4, 40, 'standard', 'user-1')`,
      [employeeId, relationshipId, positionId, managerId],
    );

    await rootPool.query(
      `insert into app.employment_term (organization_id, employee_id, relationship_id, version, supersedes_employment_term_id, effective_from, weekly_hours, working_time_pattern, created_by)
       values ('org-1', $1, $2, 2, (select id from app.employment_term where relationship_id = $2 and version = 1), '2026-02-01', 40, 'standard', 'user-1')`,
      [employeeId, relationshipId],
    );
    await expect(
      rootPool.query(
        `insert into app.employment_term (organization_id, employee_id, relationship_id, version, supersedes_employment_term_id, effective_from, weekly_hours, working_time_pattern, created_by)
         values ('org-1', $1, $2, 3, (select id from app.employment_term where relationship_id = $2 and version = 1), '2026-03-01', 40, 'standard', 'user-1')`,
        [employeeId, relationshipId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employment_term_supersedes_successor_key',
    });
    await expect(
      rootPool.query<{ version: number }>(
        `select term.version from app.employment_term term
         where term.relationship_id = $1
           and term.effective_from <= $2::date
           and (term.effective_to is null or term.effective_to >= $2::date)
           and not exists (select 1 from app.employment_term successor where successor.supersedes_employment_term_id = term.id and successor.effective_from <= $2::date)
         order by term.effective_from desc, term.version desc, term.id
         limit 1`,
        [relationshipId, '2026-01-15'],
      ),
    ).resolves.toMatchObject({ rows: [{ version: 1 }] });
    await expect(
      rootPool.query<{ version: number }>(
        `select term.version from app.employment_term term
         where term.relationship_id = $1
           and term.effective_from <= $2::date
           and (term.effective_to is null or term.effective_to >= $2::date)
           and not exists (select 1 from app.employment_term successor where successor.supersedes_employment_term_id = term.id and successor.effective_from <= $2::date)
         order by term.effective_from desc, term.version desc, term.id
         limit 1`,
        [relationshipId, '2026-02-15'],
      ),
    ).resolves.toMatchObject({ rows: [{ version: 2 }] });
    await expect(
      rootPool.query<{ effective_to: string | null }>(
        'select effective_to::text as effective_to from app.employment_term where relationship_id = $1 and version = 1',
        [relationshipId],
      ),
    ).resolves.toMatchObject({ rows: [{ effective_to: null }] });
    await expect(
      rootPool.query(
        `insert into app.employment_term (organization_id, employee_id, relationship_id, version, effective_from, effective_to, position_id, weekly_hours, working_time_pattern, created_by)
         values ('org-1', $1, $2, 3, '2026-02-01', '2026-02-28', $3, 40, 'standard', 'user-1')`,
        [employeeId, relationshipId, foreignPositionId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employment_term_entity_pinning_check',
    });
    await rootPool.query(
      `insert into app.employment_term (organization_id, employee_id, relationship_id, version, effective_from, effective_to, weekly_hours, working_time_pattern, created_by)
       values ('org-1', $1, $2, 2, '2026-01-01', '2026-01-31', 40, 'standard', 'user-1')`,
      [employeeId, secondRelationshipId],
    );
    await expect(
      rootPool.query(
        `insert into app.employment_term (organization_id, employee_id, relationship_id, version, supersedes_employment_term_id, effective_from, effective_to, weekly_hours, working_time_pattern, created_by)
         values ('org-1', $1, $2, 1, (select id from app.employment_term where relationship_id = $2), '2026-02-01', '2026-02-28', 40, 'standard', 'user-1')`,
        [employeeId, secondRelationshipId],
      ),
    ).rejects.toMatchObject({ constraint: 'employment_term_supersedes_check' });
    await expect(
      rootPool.query(
        `insert into app.employment_term (organization_id, employee_id, relationship_id, version, supersedes_employment_term_id, effective_from, effective_to, weekly_hours, working_time_pattern, created_by)
         values ('org-1', $1, $2, 2, (select id from app.employment_term where relationship_id = $3), '2026-02-01', '2026-02-28', 40, 'standard', 'user-1')`,
        [employeeId, relationshipId, secondRelationshipId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employment_term_supersedes_check',
    });
    await expect(
      rootPool.query(
        `insert into app.hr_position (organization_id, legal_entity_id, code, name, created_by)
         values ('org-1', $1, 'LIFECYCLE', 'Duplicate position', 'user-1')`,
        [ownedEntityId],
      ),
    ).rejects.toMatchObject({ constraint: 'hr_position_entity_code_key' });
    await expect(
      rootPool.query<{ status: string }>(
        'select status from app.employee where id = $1',
        [employeeId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'preboarding' }] });
    await rootPool.query(
      `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
       values ($1, 'org-1', $2, 'hr_document', 'Foreign lifecycle document', '2026-01-01', 'user-1')`,
      [foreignDocumentId, secondEntityId],
    );
    await expect(
      rootPool.query(
        `insert into app.employee_document (organization_id, employee_id, document_id, created_by)
         values ('org-1', $1, $2, 'user-1')`,
        [employeeId, foreignDocumentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employee_document_entity_pinning_check',
    });
    await rootPool.query(
      `insert into app.hr_checklist_template (id, organization_id, legal_entity_id, kind, code, name, created_by)
       values ($1, 'org-1', $2, 'onboarding', 'LIFECYCLE', 'Lifecycle', 'user-1'),
              ($3, 'org-1', $4, 'onboarding', 'FOREIGN', 'Foreign lifecycle', 'user-1')`,
      [templateId, ownedEntityId, foreignTemplateId, secondEntityId],
    );
    await rootPool.query(
      `insert into app.hr_checklist_template_item (organization_id, template_id, position, title, default_due_offset_days, created_by)
       values ('org-1', $1, 1, 'Foreign item', 1, 'user-1')`,
      [foreignTemplateId],
    );
    await rootPool.query(
      `insert into app.hr_checklist (id, organization_id, legal_entity_id, employee_id, template_id, kind, started_on, created_by)
       values ($1, 'org-1', $2, $3, $4, 'onboarding', '2026-01-01', 'user-1')`,
      [checklistId, ownedEntityId, employeeId, templateId],
    );
    await expect(
      rootPool.query(
        `insert into app.hr_checklist_task (organization_id, checklist_id, template_item_id, title, owner_user_id, due_on, created_by)
         values ('org-1', $1, (select id from app.hr_checklist_template_item where template_id = $2), 'Mismatch', 'user-1', '2026-01-02', 'user-1')`,
        [checklistId, foreignTemplateId],
      ),
    ).rejects.toMatchObject({
      constraint: 'hr_checklist_task_entity_pinning_check',
    });
    await expect(
      rootPool.query(
        `insert into app.hr_checklist_task (organization_id, checklist_id, title, owner_user_id, due_on, document_id, created_by)
         values ('org-1', $1, 'Foreign document', 'user-1', '2026-01-02', $2, 'user-1')`,
        [checklistId, foreignDocumentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'hr_checklist_task_entity_pinning_check',
    });
    const categoryId = '00000000-0000-4000-8000-0000000000a1';
    const foreignCategoryId = '00000000-0000-4000-8000-0000000000a2';
    await rootPool.query(
      `insert into app.hr_document_category (id, organization_id, legal_entity_id, code, name, confidentiality, retention_key, created_by)
       values ($1, 'org-1', $2, 'CHECKLIST', 'Checklist', 'operational', 'retention', 'user-1'),
              ($3, 'org-1', $4, 'CHECKLIST-FOREIGN', 'Foreign checklist', 'operational', 'retention', 'user-1')`,
      [categoryId, ownedEntityId, foreignCategoryId, secondEntityId],
    );
    const snapshotItem = await rootPool.query<{ id: string }>(
      `insert into app.hr_checklist_template_item (organization_id, template_id, position, title, default_due_offset_days, document_category_id, created_by)
       values ('org-1', $1, 2, 'Original snapshot title', 7, $2, 'user-1') returning id`,
      [templateId, categoryId],
    );
    await rootPool.query(
      `insert into app.hr_checklist_task (organization_id, checklist_id, template_item_id, title, owner_user_id, due_on, document_category_id, created_by)
       values ('org-1', $1, $2, 'Original snapshot title', 'user-1', '2026-01-08', $3, 'user-1')`,
      [checklistId, snapshotItem.rows[0]!.id, categoryId],
    );
    await rootPool.query(
      `update app.hr_checklist_template_item set title = 'Edited template title', document_category_id = null where id = $1`,
      [snapshotItem.rows[0]!.id],
    );
    await expect(
      rootPool.query(
        `select title, document_category_id from app.hr_checklist_task where checklist_id = $1 and template_item_id = $2`,
        [checklistId, snapshotItem.rows[0]!.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        { title: 'Original snapshot title', document_category_id: categoryId },
      ],
    });
    await expect(
      rootPool.query(
        `insert into app.hr_checklist_task (organization_id, checklist_id, title, owner_user_id, due_on, document_category_id, created_by)
         values ('org-1', $1, 'Foreign category', 'user-1', '2026-01-02', $2, 'user-1')`,
        [checklistId, foreignCategoryId],
      ),
    ).rejects.toMatchObject({
      constraint: 'hr_checklist_task_entity_pinning_check',
    });
    await expect(
      rootPool.query(
        `insert into app.hr_checklist_template_item (organization_id, template_id, position, title, default_due_offset_days, document_category_id, created_by)
         values ('org-1', $1, 99, 'Too early', -3651, $2, 'user-1')`,
        [templateId, categoryId],
      ),
    ).rejects.toMatchObject({
      constraint: 'hr_checklist_template_item_default_due_offset_days_check',
    });
    await expect(
      rootPool.query(
        `insert into app.hr_checklist_template_item (organization_id, template_id, position, title, default_due_offset_days, document_category_id, created_by)
         values ('org-1', $1, 100, 'Too late', 3651, $2, 'user-1')`,
        [templateId, categoryId],
      ),
    ).rejects.toMatchObject({
      constraint: 'hr_checklist_template_item_default_due_offset_days_check',
    });
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          `insert into app.hr_position (organization_id, legal_entity_id, code, name, created_by)
           values ('org-1', $1, 'DENIED', 'Denied', 'user-3')`,
          [ownedEntityId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    for (const statement of [
      `update app.employment_term set weekly_hours = 39 where relationship_id = '${relationshipId}'`,
      `delete from app.employment_term where relationship_id = '${relationshipId}'`,
      `update app.employee_status_change set to_status = 'active' where false`,
      'delete from app.employee_status_change where false',
      `update app.employment_relationship set position = 'Changed' where id = '${relationshipId}'`,
    ]) {
      await expect(
        asTenant(apiPool, orgOneOwner, (transaction) =>
          transaction.query(statement),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    for (const table of ['hr_position', 'employment_term']) {
      await expect(
        asTenant(apiPool, orgTwoOwner, (transaction) =>
          transaction.query<{ total: number }>(
            `select count(*)::integer as total from app.${table} where organization_id = 'org-1'`,
          ),
        ),
      ).resolves.toMatchObject({ rows: [{ total: 0 }] });
    }
    for (const pool of [reportingPool, backupPool]) {
      await expect(
        pool.query('select id from app.employment_term where id is not null'),
      ).resolves.toMatchObject({ rowCount: expect.any(Number) });
    }
    await rootPool.query(
      `insert into app.hr_checklist_task (organization_id, checklist_id, title, owner_user_id, due_on, created_by)
       values ('org-1', $1, 'Owner erasure task', 'task-owner-eraser', '2026-01-03', 'user-1')`,
      [checklistId],
    );
    const ownerErasure = await asEraser((client) =>
      client.query<{ tombstone: string }>(
        'select app.erase_user($1) as tombstone',
        ['task-owner-eraser'],
      ),
    );
    const ownerTombstone = ownerErasure.rows[0]?.tombstone;
    expect(ownerTombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(
      rootPool.query<{ owner_user_id: string }>(
        "select owner_user_id from app.hr_checklist_task where title = 'Owner erasure task'",
      ),
    ).resolves.toMatchObject({ rows: [{ owner_user_id: ownerTombstone }] });
    await rootPool.query(
      `insert into app.hr_workplace (organization_id, legal_entity_id, code, name, created_by)
       values ('org-1', $1, 'ERASURE', 'Erasure workplace', 'wave-one-eraser')`,
      [ownedEntityId],
    );
    const erased = await asEraser((client) =>
      client.query<{ tombstone: string }>(
        'select app.erase_user($1) as tombstone',
        ['wave-one-eraser'],
      ),
    );
    const tombstone = erased.rows[0]?.tombstone;
    expect(tombstone).toMatch(/^erased_[0-9a-f-]{36}$/);
    await expect(
      rootPool.query<{ created_by: string }>(
        "select created_by from app.hr_workplace where code = 'ERASURE'",
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: tombstone }] });
  });

  it('enforces employee-document supersession ownership, category, branches, and cycles', async () => {
    const employeeId = '00000000-0000-4000-8000-0000000001d1';
    const otherEmployeeId = '00000000-0000-4000-8000-0000000001d2';
    const categoryId = '00000000-0000-4000-8000-0000000001d3';
    const otherCategoryId = '00000000-0000-4000-8000-0000000001d4';
    const foreignCategoryId = '00000000-0000-4000-8000-0000000001d5';
    const baseDocumentId = '00000000-0000-4000-8000-0000000001d6';
    const secondDocumentId = '00000000-0000-4000-8000-0000000001d7';
    const branchOneDocumentId = '00000000-0000-4000-8000-0000000001d8';
    const branchTwoDocumentId = '00000000-0000-4000-8000-0000000001d9';
    const concurrentBaseDocumentId = '00000000-0000-4000-8000-0000000001da';
    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by)
       values ($1, 'org-1', $2, 'EMP-DOC-SUPERSESSION', 'Document', 'Owner', 'user-1'),
              ($3, 'org-1', $2, 'EMP-DOC-OTHER', 'Document', 'Other', 'user-1')`,
      [employeeId, ownedEntityId, otherEmployeeId],
    );
    await rootPool.query(
      `insert into app.hr_document_category (id, organization_id, legal_entity_id, code, name, confidentiality, retention_key, created_by)
       values ($1, 'org-1', $2, 'DOC-SUPERSESSION', 'Document supersession', 'operational', 'retention', 'user-1'),
              ($3, 'org-1', $2, 'DOC-OTHER', 'Other category', 'operational', 'retention', 'user-1'),
              ($4, 'org-1', $5, 'DOC-FOREIGN', 'Foreign category', 'operational', 'retention', 'user-1')`,
      [
        categoryId,
        ownedEntityId,
        otherCategoryId,
        foreignCategoryId,
        secondEntityId,
      ],
    );
    await rootPool.query(
      `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
       values ($1, 'org-1', $2, 'hr_document', 'Base', '2026-01-01', 'user-1'),
              ($3, 'org-1', $2, 'hr_document', 'Second', '2026-01-02', 'user-1'),
              ($4, 'org-1', $2, 'hr_document', 'Branch one', '2026-01-03', 'user-1'),
              ($5, 'org-1', $2, 'hr_document', 'Branch two', '2026-01-04', 'user-1'),
              ($6, 'org-1', $2, 'hr_document', 'Concurrent base', '2026-01-05', 'user-1')`,
      [
        baseDocumentId,
        ownedEntityId,
        secondDocumentId,
        branchOneDocumentId,
        branchTwoDocumentId,
        concurrentBaseDocumentId,
      ],
    );
    await rootPool.query(
      `insert into app.employee_document (organization_id, employee_id, document_id, category_id, created_by)
       values ('org-1', $1, $2, $3, 'user-1'), ('org-1', $1, $4, $3, 'user-1'), ('org-1', $1, $5, $3, 'user-1')`,
      [
        employeeId,
        baseDocumentId,
        categoryId,
        secondDocumentId,
        concurrentBaseDocumentId,
      ],
    );
    await expect(
      rootPool.query(
        `update app.employee_document set supersedes_document_id = $1 where employee_id = $2 and document_id = $1`,
        [baseDocumentId, employeeId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employee_document_supersedes_not_self_check',
    });
    await expect(
      rootPool.query(
        `update app.employee_document set category_id = $1 where employee_id = $2 and document_id = $3`,
        [foreignCategoryId, employeeId, baseDocumentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employee_document_entity_pinning_check',
    });
    await expect(
      rootPool.query(
        `update app.employee_document set supersedes_document_id = $1 where employee_id = $2 and document_id = $3`,
        [baseDocumentId, employeeId, secondDocumentId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      rootPool.query(
        `update app.employee_document set supersedes_document_id = $1 where employee_id = $2 and document_id = $3`,
        [secondDocumentId, employeeId, baseDocumentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employee_document_supersedes_cycle_check',
    });
    await expect(
      rootPool.query(
        `insert into app.employee_document (organization_id, employee_id, document_id, category_id, supersedes_document_id, created_by)
       values ('org-1', $1, $2, $3, $4, 'user-1')`,
        [otherEmployeeId, branchOneDocumentId, categoryId, baseDocumentId],
      ),
    ).rejects.toMatchObject({
      constraint: 'employee_document_supersedes_check',
    });
    const branches = await Promise.allSettled([
      rootPool.query(
        `insert into app.employee_document (organization_id, employee_id, document_id, category_id, supersedes_document_id, created_by) values ('org-1', $1, $2, $3, $4, 'user-1')`,
        [employeeId, branchOneDocumentId, categoryId, concurrentBaseDocumentId],
      ),
      rootPool.query(
        `insert into app.employee_document (organization_id, employee_id, document_id, category_id, supersedes_document_id, created_by) values ('org-1', $1, $2, $3, $4, 'user-1')`,
        [employeeId, branchTwoDocumentId, categoryId, concurrentBaseDocumentId],
      ),
    ]);
    expect(
      branches.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      branches.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('reserves the documents organization slug', async () => {
    await expect(
      asOwner((client) =>
        client.query(
          `insert into auth.organization (id, name, slug)
           values ('reserved-documents', 'Reserved documents', 'documents')`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_slug_reserved_check',
    });
  });

  it('ties the line category to the line kind', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 10, 'Placeholder uncategorized supply', 100.00, 'exempt', 0, 0)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_category_kind_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category, line_kind,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 11, 'Placeholder categorized advance', 'services', 'advance_deduction',
                   100.00, 'exempt', 0, 0)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_category_kind_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, line_kind,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 12, 'Placeholder advance deduction', 'advance_deduction',
                   100.00, 'standard', 21.00, 21.00)`,
          [documentId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await rootPool.query('delete from app.invoice_line where line_no = 12');
  });

  it('accepts labour and transport and still refuses an unknown category', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 13, 'Placeholder labour', 'labour', 100.00, 'exempt', 0, 0),
                  ('org-1', $1, 14, 'Placeholder transport', 'transport', 100.00, 'exempt', 0, 0)`,
          [documentId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 2 });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount
           )
           values ('org-1', $1, 15, 'Placeholder unknown', 'consulting', 100.00, 'exempt', 0, 0)`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_category_check',
    });
    await rootPool.query(
      'delete from app.invoice_line where line_no in (13, 14)',
    );
  });

  it('bounds the service period and the activity code on a line', async () => {
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount, period_start, period_end
           )
           values ('org-1', $1, 16, 'Placeholder reversed period', 'services', 100.00, 'exempt', 0, 0,
                   '2026-03-31', '2026-03-01')`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_period_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount, activity_code
           )
           values ('org-1', $1, 17, 'Placeholder loud activity', 'services', 100.00, 'exempt', 0, 0,
                   'March Works')`,
          [documentId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_line_activity_code_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice_line (
             organization_id, document_id, line_no, description, category,
             base_amount, vat_mode, vat_rate, vat_amount,
             tax_point_date, period_start, period_end, activity_code
           )
           values ('org-1', $1, 18, 'Placeholder March supply', 'labour', 100.00, 'exempt', 0, 0,
                   '2026-03-31', '2026-03-01', '2026-03-31', 'march-works_1')`,
          [documentId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await rootPool.query('delete from app.invoice_line where line_no = 18');
  });

  it('generates the amount due and bounds the rounding and the advance', async () => {
    // The related contract carries no invoice row, so it is free to hold these throwaway headers.
    const insertInvoice = async (rounding: string, advance: string) =>
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice (
             document_id, organization_id, base_total, vat_total, gross_total,
             rounding_amount, advance_total
           )
           values ($1, 'org-1', 999999.80, 0, 999999.80, $2, $3)`,
          [relatedDocumentId, rounding, advance],
        ),
      );

    await expect(insertInvoice('1.00', '0')).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_rounding_amount_check',
    });
    await expect(insertInvoice('-1.00', '0')).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_rounding_amount_check',
    });
    await expect(insertInvoice('0', '-1.00')).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_advance_total_check',
    });
    // One hundredth above the printed total is already an overpaid advance, which is a credit note.
    await expect(insertInvoice('0.20', '1000000.01')).rejects.toMatchObject({
      code: '23514',
      constraint: 'invoice_amount_due_check',
    });

    await expect(insertInvoice('0.99', '0')).resolves.toMatchObject({
      rowCount: 1,
    });
    await rootPool.query('delete from app.invoice where document_id = $1', [
      relatedDocumentId,
    ]);
    await expect(insertInvoice('-0.99', '0')).resolves.toMatchObject({
      rowCount: 1,
    });
    await rootPool.query('delete from app.invoice where document_id = $1', [
      relatedDocumentId,
    ]);

    await expect(insertInvoice('0.20', '500000.00')).resolves.toMatchObject({
      rowCount: 1,
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query<{ amount_due: string }>(
          'select amount_due from app.invoice where document_id = $1',
          [relatedDocumentId],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ amount_due: '500000.0000' }] });
    await rootPool.query('delete from app.invoice where document_id = $1', [
      relatedDocumentId,
    ]);

    // PostgreSQL computes the column, so no writer can store a total that disagrees with the parts.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.invoice (
             document_id, organization_id, base_total, vat_total, gross_total, amount_due
           )
           values ($1, 'org-1', 100.00, 0, 100.00, 100.00)`,
          [relatedDocumentId],
        ),
      ),
    ).rejects.toMatchObject({ code: '428C9' });
  });

  it('dates every event line and bounds its activity code', async () => {
    const column = await rootPool.query<{ is_nullable: 'NO' | 'YES' }>(
      `select is_nullable
       from information_schema.columns
       where table_schema = 'app'
         and table_name = 'economic_event_line'
         and column_name = 'effective_date'`,
    );
    expect(column.rows).toEqual([{ is_nullable: 'NO' }]);
    // The migration backfills from the event header, so no leg is left without a date to group by.
    await expect(
      rootPool.query<{ total: number }>(
        'select count(*)::integer as total from app.economic_event_line where effective_date is null',
      ),
    ).resolves.toMatchObject({ rows: [{ total: 0 }] });
    await expect(
      rootPool.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
         where schemaname = 'app'
           and indexname = 'economic_event_line_effective_date_idx'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          indexdef: expect.stringContaining(
            '(organization_id, effective_date, account_code)',
          ),
        },
      ],
    });

    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.economic_event_line (
             organization_id, event_id, line_no, account_code, side, amount, effective_date, activity_code
           )
           values ('org-1', $1, 10, '518', 'debit', 1.00, '2026-03-31', 'March Works')`,
          [eventId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'economic_event_line_activity_code_check',
    });
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query(
          `insert into app.economic_event_line (
             organization_id, event_id, line_no, account_code, side, amount, effective_date, activity_code
           )
           values ('org-1', $1, 10, '518', 'debit', 1.00, '2026-03-31', 'march-works_1')`,
          [eventId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await rootPool.query(
      'delete from app.economic_event_line where line_no = 10',
    );
  });

  // The regression this guards: bap_owner is NOBYPASSRLS and no tenant is set, so a forced policy hid every existing leg.
  it('backfills event lines that already exist and restores forced row level security', async () => {
    const backfillDatabase = 'bap_backfill';
    const source = new URL('../drizzle/', import.meta.url);
    const directory = await mkdtemp(join(tmpdir(), 'bap-migrations-'));
    await rootPool.query(`create database ${backfillDatabase}`);
    const poolOn = (user: string): Pool => {
      const pool = new Pool({
        database: backfillDatabase,
        host: container.getHost(),
        password: testPassword,
        port: container.getPort(),
        user,
      });
      // Same idle-client shutdown guard as poolFor, for the disposable backfill database.
      pool.on('error', () => undefined);
      return pool;
    };
    const backfillRootPool = poolOn('postgres');
    const backfillMigratorPool = poolOn('bap_migrator');
    const backfillApiPool = poolOn('bap_api');

    try {
      const root = await backfillRootPool.connect();

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

      // Everything before the migration under test, so the register is populated the way an existing database is.
      for (const entry of await readdir(source)) {
        if (entry.endsWith('.sql') && entry < '20260915.0001') {
          await copyFile(new URL(entry, source), join(directory, entry));
        }
      }

      const before = await runMigrations(backfillMigratorPool, {
        directory: pathToFileURL(`${directory}/`),
      });

      expect(before.applied).not.toContain('20260915.0001');

      const owner = await backfillMigratorPool.connect();

      try {
        await owner.query('begin');
        await owner.query('set local role bap_owner');
        await owner.query(`
          insert into auth."user" (id, name, email, email_verified)
          values ('user-1', 'Owner', 'owner@example.test', true)
        `);
        await owner.query(`
          insert into auth.organization (id, name, slug)
          values ('org-1', 'One', 'one')
        `);
        await owner.query(`
          insert into auth.member (id, organization_id, user_id, role)
          values ('member-1', 'org-1', 'user-1', 'owner')
        `);
        await owner.query('commit');
      } catch (error) {
        await owner.query('rollback');
        throw error;
      } finally {
        owner.release();
      }

      await backfillRootPool.query(
        `insert into app.legal_entity (id, organization_id, name, kind, created_by)
         values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1')`,
        [ownedEntityId],
      );
      await asTenant(backfillApiPool, orgOneOwner, async (transaction) => {
        await transaction.query(
          `insert into app.document (
             id, organization_id, legal_entity_id, kind, reference, title,
             document_date, currency_code, total_amount, created_by
           )
           values ($1, 'org-1', $2, 'received_invoice', 'REF-0001', 'Placeholder received invoice',
                   '2026-09-02', 'CZK', 121.00, 'user-1')`,
          [documentId, ownedEntityId],
        );
        await transaction.query(
          `insert into app.invoice (
             document_id, organization_id, tax_point_date, base_total, vat_total, gross_total
           )
           values ($1, 'org-1', '2026-08-31', 100.00, 21.00, 121.00)`,
          [documentId],
        );
        await transaction.query(
          `insert into app.economic_event (
             id, organization_id, legal_entity_id, document_id, event_date,
             rule_set_version, is_balanced, debit_total, credit_total
           )
           values ($1, 'org-1', $2, $3, '2026-09-02', 'cz-default-2026-09', true, 121.00, 121.00)`,
          [eventId, ownedEntityId, documentId],
        );
        await transaction.query(
          `insert into app.economic_event_line (
             organization_id, event_id, line_no, account_code, side, amount, description
           )
           values ('org-1', $1, 1, '518', 'debit', 100.00, 'Placeholder line')`,
          [eventId],
        );
      });

      const applied = await runMigrations(backfillMigratorPool);

      expect(applied.applied).toContain('20260915.0001');
      // The invoice tax point wins over the event date, exactly as rule set cz-default-2026-09.1 would derive it.
      await expect(
        backfillRootPool.query<{ effective_date: string }>(
          'select effective_date::text as effective_date from app.economic_event_line',
        ),
      ).resolves.toMatchObject({ rows: [{ effective_date: '2026-08-31' }] });
      await expect(
        backfillRootPool.query<{
          relforcerowsecurity: boolean;
          relname: string;
        }>(
          `select relname, relforcerowsecurity
           from pg_class
           where oid in ('app.economic_event'::regclass, 'app.economic_event_line'::regclass, 'app.invoice'::regclass)
           order by relname`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { relforcerowsecurity: true, relname: 'economic_event' },
          { relforcerowsecurity: true, relname: 'economic_event_line' },
          { relforcerowsecurity: true, relname: 'invoice' },
        ],
      });
      await expect(
        backfillRootPool.query<{ indexname: string }>(
          `select indexname
           from pg_indexes
           where schemaname = 'app'
             and indexname in ('economic_event_line_account_idx', 'economic_event_line_account_date_idx')`,
        ),
      ).resolves.toMatchObject({
        rows: [{ indexname: 'economic_event_line_account_date_idx' }],
      });
    } finally {
      await Promise.all([
        backfillApiPool.end(),
        backfillMigratorPool.end(),
        backfillRootPool.end(),
      ]);
      await rootPool.query(`drop database if exists ${backfillDatabase}`);
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('upgrades Wave 0 relationships into deterministic Wave 1 reference terms', async () => {
    const upgradeDatabase = 'bap_hr_lifecycle_upgrade';
    const source = new URL('../drizzle/', import.meta.url);
    const directory = await mkdtemp(join(tmpdir(), 'bap-hr-lifecycle-'));
    await rootPool.query(`create database ${upgradeDatabase}`);
    const poolOn = (user: string): Pool =>
      new Pool({
        database: upgradeDatabase,
        host: container.getHost(),
        password: testPassword,
        port: container.getPort(),
        user,
      });
    const upgradeRootPool = poolOn('postgres');
    const upgradeMigratorPool = poolOn('bap_migrator');

    try {
      const root = await upgradeRootPool.connect();
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
      for (const entry of await readdir(source)) {
        if (entry.endsWith('.sql') && entry < '20260920.0003_hr_lifecycle.sql')
          await copyFile(new URL(entry, source), join(directory, entry));
      }
      await runMigrations(upgradeMigratorPool, {
        directory: pathToFileURL(`${directory}/`),
      });
      await upgradeRootPool.query(
        `insert into auth.organization (id, name, slug) values ('upgrade-org', 'Upgrade', 'upgrade')`,
      );
      await upgradeRootPool.query(
        `insert into app.legal_entity (id, organization_id, name, kind, created_by) values ('00000000-0000-4000-8000-000000000111', 'upgrade-org', 'Upgrade entity', 'company', 'actor-a')`,
      );
      await upgradeRootPool.query(
        `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by) values ('00000000-0000-4000-8000-000000000112', 'upgrade-org', '00000000-0000-4000-8000-000000000111', 'UP-1', 'Upgrade', 'One', 'actor-a'), ('00000000-0000-4000-8000-000000000113', 'upgrade-org', '00000000-0000-4000-8000-000000000111', 'UP-2', 'Upgrade', 'Two', 'actor-b')`,
      );
      await upgradeRootPool.query(
        `insert into app.employment_relationship (id, organization_id, employee_id, kind, position, department, cost_centre, weekly_hours, start_date, end_date, created_by) values ('00000000-0000-4000-8000-000000000114', 'upgrade-org', '00000000-0000-4000-8000-000000000112', 'employment', 'Shared legacy position', 'Shared legacy department', 'Shared cost centre', 37.5, '2024-01-01', null, 'actor-a'), ('00000000-0000-4000-8000-000000000115', 'upgrade-org', '00000000-0000-4000-8000-000000000113', 'dpp', 'Shared legacy position', 'Shared legacy department', 'Shared cost centre', 12, '2024-02-01', '2024-12-31', 'actor-b')`,
      );
      await copyFile(
        new URL('20260920.0003_hr_lifecycle.sql', source),
        join(directory, '20260920.0003_hr_lifecycle.sql'),
      );
      const applied = await runMigrations(upgradeMigratorPool, {
        directory: pathToFileURL(`${directory}/`),
      });
      expect(applied.applied).toEqual(['20260920.0003']);
      await expect(
        upgradeRootPool.query<{
          effective_from: string;
          effective_to: string | null;
          weekly_hours: string;
          position: string;
          department: string;
          cost_centre: string;
        }>(
          `select term.effective_from::text, term.effective_to::text, term.weekly_hours::text, position.name as position, department.name as department, cost_centre.name as cost_centre from app.employment_term term join app.hr_position position on position.id = term.position_id join app.hr_department department on department.id = term.department_id join app.hr_cost_centre cost_centre on cost_centre.id = term.cost_centre_id order by term.relationship_id`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            effective_from: '2024-01-01',
            effective_to: null,
            weekly_hours: '37.50',
            position: 'Shared legacy position',
            department: 'Shared legacy department',
            cost_centre: 'Shared cost centre',
          },
          {
            effective_from: '2024-02-01',
            effective_to: '2024-12-31',
            weekly_hours: '12.00',
            position: 'Shared legacy position',
            department: 'Shared legacy department',
            cost_centre: 'Shared cost centre',
          },
        ],
      });
      await expect(
        upgradeRootPool.query<{ total: number }>(
          `select count(*)::integer as total from app.hr_position where name = 'Shared legacy position'`,
        ),
      ).resolves.toMatchObject({ rows: [{ total: 1 }] });
      await upgradeRootPool.query(
        `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
         values ('00000000-0000-4000-8000-000000000116', 'upgrade-org', '00000000-0000-4000-8000-000000000111', 'other', 'Legacy payroll document', '2026-08-01', 'actor-payroll')`,
      );
      await upgradeRootPool.query(
        `insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, created_by)
         values ('00000000-0000-4000-8000-000000000117', 'upgrade-org', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000116', '2026-08-01', 'actor-payroll')`,
      );
      await upgradeRootPool.query(
        `insert into app.economic_event (id, organization_id, legal_entity_id, document_id, event_date, rule_set_version, is_balanced, debit_total, credit_total)
         values ('00000000-0000-4000-8000-000000000118', 'upgrade-org', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000116', '2026-08-01', 'legacy', true, 0, 0)`,
      );
      await copyFile(
        new URL('20260920.0004_hr_payroll_workflow.sql', source),
        join(directory, '20260920.0004_hr_payroll_workflow.sql'),
      );
      expect(
        (
          await runMigrations(upgradeMigratorPool, {
            directory: pathToFileURL(`${directory}/`),
          })
        ).applied,
      ).toEqual(['20260920.0004']);
      await expect(
        upgradeRootPool.query(
          `select status, origin, finalized_by, finalized_at = created_at as finalized_at_matches, document_id from app.payroll_run where id = '00000000-0000-4000-8000-000000000117'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            status: 'finalized',
            origin: 'imported',
            finalized_by: 'actor-payroll',
            finalized_at_matches: true,
            document_id: '00000000-0000-4000-8000-000000000116',
          },
        ],
      });
      await expect(
        upgradeRootPool.query(
          `select count(*)::integer as total from app.economic_event where id = '00000000-0000-4000-8000-000000000118'`,
        ),
      ).resolves.toMatchObject({ rows: [{ total: 1 }] });
    } finally {
      await Promise.all([upgradeMigratorPool.end(), upgradeRootPool.end()]);
      await rootPool.query(`drop database if exists ${upgradeDatabase}`);
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('enforces employee binding identity, tenant roles, transitions, and erasure', async () => {
    const employeeId = '00000000-0000-4000-8000-000000000961';
    const otherEmployeeId = '00000000-0000-4000-8000-000000000962';
    const foreignEmployeeId = '00000000-0000-4000-8000-000000000964';
    const bindingId = '00000000-0000-4000-8000-000000000963';
    const pendingBindingId = '00000000-0000-4000-8000-000000000965';
    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by) values ($1, 'org-1', $2, 'W41-A', 'Wave', 'Four', 'binding-actor'), ($3, 'org-1', $4, 'W41-B', 'Wave', 'Other', 'binding-actor')`,
      [employeeId, ownedEntityId, otherEmployeeId, secondEntityId],
    );
    await rootPool.query(
      `insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, created_by) values ($1, 'org-2', $2, 'W41-C', 'Wave', 'Foreign', 'binding-actor')`,
      [foreignEmployeeId, foreignEntityId],
    );
    await rootPool.query(
      `insert into app.employee_user_binding (id, organization_id, legal_entity_id, employee_id, user_id, created_by) values ($1, 'org-1', $2, $3, 'binding-user', 'binding-actor')`,
      [bindingId, ownedEntityId, employeeId],
    );
    await expect(
      rootPool.query(
        `insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by) values ('org-1', $1, $2, 'second-user', 'binding-actor')`,
        [ownedEntityId, employeeId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      rootPool.query(
        `insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by) values ('org-1', $1, $2, 'binding-user', 'binding-actor')`,
        [secondEntityId, otherEmployeeId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      rootPool.query(
        `insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by) values ('org-2', $1, $2, 'binding-user', 'binding-actor')`,
        [foreignEntityId, foreignEmployeeId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      asTenant(apiPool, orgOneOwner, (tx) =>
        tx.query<{ organization_id: string }>(
          `select organization_id from app.employee_user_binding where user_id='binding-user' order by organization_id`,
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ organization_id: 'org-1' }] });
    await expect(
      asTenant(apiPool, orgTwoOwner, (tx) =>
        tx.query<{ organization_id: string }>(
          `select organization_id from app.employee_user_binding where user_id='binding-user' order by organization_id`,
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ organization_id: 'org-2' }] });
    await expect(
      asTenant(apiPool, orgTwoOwner, (tx) =>
        tx.query(
          `update app.employee_user_binding set status='revoked', updated_at=now() where id=$1`,
          [bindingId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      rootPool.query(
        `insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by) values ('org-1', $1, $2, 'wrong-entity-user', 'binding-actor')`,
        [ownedEntityId, otherEmployeeId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await rootPool.query(
      `insert into app.employee_user_binding (id, organization_id, legal_entity_id, employee_id, user_id, created_by) values ($1, 'org-1', $2, $3, 'pending-user', 'binding-actor')`,
      [pendingBindingId, secondEntityId, otherEmployeeId],
    );
    await expect(
      asTenant(apiPool, orgOneOwner, (tx) =>
        tx.query(
          `update app.employee_user_binding set status='revoked', updated_at=now() where id=$1`,
          [pendingBindingId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await asTenant(apiPool, orgOneOwner, async (tx) => {
      await expect(
        tx.query(
          `update app.employee_user_binding set status='active', verified_at=now(), updated_at=now() where id=$1`,
          [pendingBindingId],
        ),
      ).rejects.toMatchObject({
        constraint: 'employee_user_binding_status_check',
      });
    });
    for (const pool of [reportingPool, backupPool]) {
      await asTenant(pool, orgOneOwner, async (tx) => {
        await expect(
          tx.query<{ total: number }>(
            'select count(*)::integer as total from app.employee_user_binding',
          ),
        ).resolves.toMatchObject({ rows: [{ total: expect.any(Number) }] });
      });
      await asTenant(pool, orgOneOwner, async (tx) => {
        await expect(
          tx.query(
            `update app.employee_user_binding set status='revoked' where id=$1`,
            [bindingId],
          ),
        ).rejects.toThrow(/permission denied/);
      });
    }
    await asTenant(apiPool, orgOneOwner, async (tx) => {
      await tx.query(
        "update app.employee_user_binding set status='active', verified_at=now(), updated_at=now() where id=$1",
        [bindingId],
      );
      await expect(
        tx.query(
          "update app.employee_user_binding set user_id='changed' where id=$1",
          [bindingId],
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await asTenant(apiPool, orgOneOwner, async (tx) => {
      await tx.query(
        "update app.employee_user_binding set status='revoked', updated_at=now() where id=$1",
        [bindingId],
      );
      await expect(
        tx.query(
          "update app.employee_user_binding set status='active' where id=$1",
          [bindingId],
        ),
      ).rejects.toMatchObject({
        constraint: 'employee_user_binding_status_check',
      });
    });
    await asTenant(apiPool, orgOneOwner, async (tx) => {
      await expect(
        tx.query(
          "update app.employee_user_binding set status='pending' where id=$1",
          [bindingId],
        ),
      ).rejects.toMatchObject({
        constraint: 'employee_user_binding_status_check',
      });
    });
    await asEraser(async (tx) => {
      const erased = await tx.query<{ tombstone: string }>(
        'select app.erase_user($1) as tombstone',
        ['binding-user'],
      );
      expect(erased.rows[0]?.tombstone).toMatch(/^erased_/);
    });
    await expect(
      rootPool.query<{ user_id: string }>(
        'select user_id from app.employee_user_binding where id=$1',
        [bindingId],
      ),
    ).resolves.toMatchObject({
      rows: [{ user_id: expect.stringMatching(/^erased_/) }],
    });
  });

  it('rejects a legacy payroll account code before the W2.5 narrowing cast can truncate it', async () => {
    const upgradeDatabase = 'bap_payroll_commands_upgrade';
    const source = new URL('../drizzle/', import.meta.url);
    const directory = await mkdtemp(join(tmpdir(), 'bap-payroll-commands-'));
    await rootPool.query(`create database ${upgradeDatabase}`);
    const poolOn = (user: string): Pool =>
      new Pool({
        database: upgradeDatabase,
        host: container.getHost(),
        password: testPassword,
        port: container.getPort(),
        user,
      });
    const upgradeRootPool = poolOn('postgres');
    const upgradeMigratorPool = poolOn('bap_migrator');

    try {
      const root = await upgradeRootPool.connect();
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
      for (const entry of await readdir(source)) {
        if (
          entry.endsWith('.sql') &&
          entry < '20260921.0006_payroll_commands.sql'
        ) {
          await copyFile(new URL(entry, source), join(directory, entry));
        }
      }
      await runMigrations(upgradeMigratorPool, {
        directory: pathToFileURL(`${directory}/`),
      });
      await upgradeRootPool.query(
        `insert into auth.organization (id, name, slug) values ('command-upgrade-org', 'Command upgrade', 'command-upgrade')`,
      );
      await upgradeRootPool.query(
        `insert into app.legal_entity (id, organization_id, name, kind, created_by)
         values ('00000000-0000-4000-8000-000000000921', 'command-upgrade-org', 'Command upgrade entity', 'company', 'actor')`,
      );
      await upgradeRootPool.query(
        `insert into app.payroll_account_mapping (organization_id, legal_entity_id, accounting_key, account_code, side, valid_from, created_by)
         values ('command-upgrade-org', '00000000-0000-4000-8000-000000000921', 'gross_pay', '5210', 'debit', '2027-09-01', 'actor')`,
      );
      await copyFile(
        new URL('20260921.0006_payroll_commands.sql', source),
        join(directory, '20260921.0006_payroll_commands.sql'),
      );
      await expect(
        runMigrations(upgradeMigratorPool, {
          directory: pathToFileURL(`${directory}/`),
        }),
      ).rejects.toThrow(
        /payroll_account_mapping\.account_code must already contain exactly three digits/,
      );
      await expect(
        upgradeRootPool.query<{ account_code: string }>(
          `select account_code from app.payroll_account_mapping where organization_id = 'command-upgrade-org'`,
        ),
      ).resolves.toMatchObject({ rows: [{ account_code: '5210' }] });
    } finally {
      await Promise.all([upgradeMigratorPool.end(), upgradeRootPool.end()]);
      await rootPool.query(`drop database if exists ${upgradeDatabase}`);
      await rm(directory, { force: true, recursive: true });
    }
  });
});
