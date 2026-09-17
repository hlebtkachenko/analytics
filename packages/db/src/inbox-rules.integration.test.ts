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

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

// One legal entity, partner and channel per organization, and the items the definers sort through.
const ownedEntityId = '00000000-0000-4000-8000-0000000000e1';
const foreignEntityId = '00000000-0000-4000-8000-0000000000e2';
const ownedPartnerId = '00000000-0000-4000-8000-0000000000a1';
const foreignPartnerId = '00000000-0000-4000-8000-0000000000a2';
const ownedChannelId = '00000000-0000-4000-8000-0000000000c1';
const foreignChannelId = '00000000-0000-4000-8000-0000000000c4';
const documentId = '00000000-0000-4000-8000-0000000000d1';
const reviewItemId = '00000000-0000-4000-8000-000000001001';
const routedItemId = '00000000-0000-4000-8000-000000001002';
const foreignReviewItemId = '00000000-0000-4000-8000-000000001003';
const decidedItemId = '00000000-0000-4000-8000-000000001004';
// Rules seeded outside the API for the definer: one per author situation.
const ownerRuleId = '00000000-0000-4000-8000-000000004001';
const memberRuleId = '00000000-0000-4000-8000-000000004002';
const unverifiedRuleId = '00000000-0000-4000-8000-000000004003';
const removedRuleId = '00000000-0000-4000-8000-000000004004';
const outsiderRuleId = '00000000-0000-4000-8000-000000004005';
const disabledRuleId = '00000000-0000-4000-8000-000000004006';
const deletedRuleId = '00000000-0000-4000-8000-000000004007';
const adminRuleId = '00000000-0000-4000-8000-000000004008';
const demotedRuleId = '00000000-0000-4000-8000-000000004009';
const foreignRuleId = '00000000-0000-4000-8000-000000004010';

const orgOneOwner: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const orgOneAdmin: TenantContext = {
  organizationId: 'org-1',
  role: 'admin',
  userId: 'user-4',
};
const orgOneMember: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-3',
};
const orgOneChannel: TenantContext = {
  organizationId: 'org-1',
  role: 'channel',
  userId: `channel_${ownedChannelId}`,
};
// The read-only subject of the route job: a member role that no write policy admits.
const orgOneAutomation: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'system_automation',
};
const orgTwoAutomation: TenantContext = {
  organizationId: 'org-2',
  role: 'member',
  userId: 'system_automation',
};

let apiPool: Pool;
let container: StartedPostgreSqlContainer;
let migratorPool: Pool;
let reportingPool: Pool;
let rootPool: Pool;

function poolFor(user: string, password: string): Pool {
  return new Pool({
    database: container.getDatabase(),
    host: container.getHost(),
    password,
    port: container.getPort(),
    user,
  });
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

interface RuleInput {
  autoRoute?: boolean;
  channelId?: string | null;
  deletedAt?: string | null;
  detectedType?: string | null;
  discardReason?: string | null;
  enabled?: boolean;
  keyword?: string | null;
  name?: string;
  priority: number | null;
  senderPattern?: string | null;
  setAssigneeId?: string | null;
  setDocumentKind?: string | null;
  setLegalEntityId?: string | null;
  setPartnerId?: string | null;
}

function ruleValues(
  organizationId: string,
  input: RuleInput,
  createdBy: string,
  id: string | null,
) {
  return [
    id,
    organizationId,
    input.name ?? 'Placeholder rule',
    input.enabled ?? true,
    input.priority,
    input.channelId ?? null,
    input.senderPattern ?? null,
    input.keyword ?? null,
    input.detectedType ?? null,
    input.setLegalEntityId ?? null,
    input.setDocumentKind ?? null,
    input.setPartnerId ?? null,
    input.setAssigneeId ?? null,
    input.discardReason ?? null,
    input.autoRoute ?? false,
    createdBy,
    input.deletedAt ?? null,
  ];
}

const insertRuleSql = `insert into app.inbox_rule
   (id, organization_id, name, enabled, priority, channel_id, sender_pattern, keyword, detected_type,
    set_legal_entity_id, set_document_kind, set_partner_id, set_assignee_id, discard_reason, auto_route,
    created_by, deleted_at)
 values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
 returning id`;

function insertRule(
  context: TenantContext,
  input: RuleInput,
  createdBy: string = context.userId,
) {
  return asTenant(apiPool, context, (transaction) =>
    transaction.query<{ id: string }>(
      insertRuleSql,
      ruleValues(context.organizationId, input, createdBy, null),
    ),
  );
}

// Seeds bypass the API policies: an author situation is a fact about auth, not something a route can write.
function seedRule(
  id: string,
  organizationId: string,
  input: RuleInput,
  createdBy: string,
) {
  return rootPool.query(
    insertRuleSql,
    ruleValues(organizationId, input, createdBy, id),
  );
}

function insertCorrection(
  context: TenantContext,
  field: string,
  source: string,
  createdBy: string = context.userId,
  reason: string | null = null,
) {
  return asTenant(apiPool, context, (transaction) =>
    transaction.query(
      `insert into app.inbox_correction
         (organization_id, inbox_item_id, field, suggested_value, final_value, source, reason, created_by)
       values ($1, $2, $3, 'received_invoice', 'receipt', $4, $5, $6)`,
      [context.organizationId, reviewItemId, field, source, reason, createdBy],
    ),
  );
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
  await runMigrations(migratorPool);

  await asOwner(async (client) => {
    // user-5 is an unverified admin, user-6 was removed, user-7 is demoted mid-test.
    await client.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Owner', 'owner@example.test', true),
             ('user-2', 'Other', 'other@example.test', true),
             ('user-3', 'Member', 'reader@example.test', true),
             ('user-4', 'Admin', 'admin@example.test', true),
             ('user-5', 'Unverified', 'unverified@example.test', false),
             ('user-6', 'Removed', 'removed@example.test', true),
             ('user-7', 'Demoted', 'demoted@example.test', true)
    `);
    await client.query(`
      insert into auth.organization (id, name, slug)
      values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await client.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-2', 'user-2', 'owner'),
             ('member-3', 'org-1', 'user-3', 'member'),
             ('member-4', 'org-1', 'user-4', 'admin'),
             ('member-5', 'org-1', 'user-5', 'admin'),
             ('member-7', 'org-1', 'user-7', 'admin')
    `);
  });
  await rootPool.query(
    `insert into app.legal_entity (id, organization_id, name, kind, created_by)
     values ($1, 'org-1', 'Placeholder Holding', 'company', 'user-1'),
            ($2, 'org-2', 'Placeholder Foreign', 'company', 'user-2')`,
    [ownedEntityId, foreignEntityId],
  );
  await rootPool.query(
    `insert into app.partner (id, organization_id, name, created_by)
     values ($1, 'org-1', 'Placeholder Supplier', 'user-1'),
            ($2, 'org-2', 'Placeholder Foreign Supplier', 'user-2')`,
    [ownedPartnerId, foreignPartnerId],
  );
  await rootPool.query(
    `insert into app.inbox_channel (id, organization_id, kind, name, created_by)
     values ($1, 'org-1', 'email', 'Placeholder mailbox', 'user-1'),
            ($2, 'org-2', 'email', 'Placeholder foreign mailbox', 'user-2')`,
    [ownedChannelId, foreignChannelId],
  );
  await rootPool.query(
    `insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
     values ($1, 'org-1', $2, 'receipt', 'Placeholder receipt', '2026-09-02', 'user-1')`,
    [documentId, ownedEntityId],
  );
  await rootPool.query(
    `insert into app.inbox_item (id, organization_id, channel_kind, payload_kind, status, document_id, created_by)
     values ($1, 'org-1', 'upload', 'file', 'needs_review', null, 'user-1'),
            ($2, 'org-1', 'upload', 'file', 'routed', $5, 'user-1'),
            ($3, 'org-2', 'upload', 'file', 'needs_review', null, 'user-2'),
            ($4, 'org-1', 'upload', 'file', 'needs_review', null, 'user-1')`,
    [
      reviewItemId,
      routedItemId,
      foreignReviewItemId,
      decidedItemId,
      documentId,
    ],
  );
});

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    migratorPool.end(),
    reportingPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('inbox rules', () => {
  it('applies the inbox rules migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260917.0005');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260917.0005');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260917.0005',
      version: '20260917.0005',
    });

    const functions = await rootPool.query<{
      function_name: string;
      grantees: string[];
      owner: string;
      proconfig: string[];
      prosecdef: boolean;
    }>(`select
      namespace.nspname || '.' || function.proname as function_name,
      pg_get_userbyid(function.proowner) as owner,
      function.proconfig,
      function.prosecdef,
      (select array_agg(coalesce(grantee_role.rolname::text, 'PUBLIC') order by grantee_role.rolname)
       from aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as privilege
       left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee) as grantees
    from pg_proc as function
    inner join pg_namespace as namespace on namespace.oid = function.pronamespace
    where function.oid in (
      'app.list_inbox_rules()'::regprocedure,
      'app.record_inbox_automation_skip(uuid, text)'::regprocedure
    )
    order by function_name`);
    expect(functions.rows).toEqual(
      ['app.list_inbox_rules', 'app.record_inbox_automation_skip'].map(
        (functionName) => ({
          function_name: functionName,
          grantees: ['bap_api', 'bap_owner'],
          owner: 'bap_owner',
          proconfig: ['search_path=pg_catalog, app'],
          prosecdef: true,
        }),
      ),
    );

    const policies = await rootPool.query<{
      cmd: string;
      policyname: string;
      roles: string[];
      tablename: string;
    }>(
      `select tablename, policyname, cmd, roles::text[] as roles from pg_policies
        where schemaname = 'app' and tablename in ('inbox_rule', 'inbox_correction')
        order by tablename, policyname`,
    );
    expect(policies.rows).toEqual([
      {
        cmd: 'INSERT',
        policyname: 'inbox_correction_insert',
        roles: ['public'],
        tablename: 'inbox_correction',
      },
      {
        cmd: 'SELECT',
        policyname: 'inbox_correction_select',
        roles: ['public'],
        tablename: 'inbox_correction',
      },
      {
        cmd: 'INSERT',
        policyname: 'inbox_rule_insert',
        roles: ['public'],
        tablename: 'inbox_rule',
      },
      {
        cmd: 'SELECT',
        policyname: 'inbox_rule_maintenance_select',
        roles: ['bap_owner'],
        tablename: 'inbox_rule',
      },
      {
        cmd: 'SELECT',
        policyname: 'inbox_rule_select',
        roles: ['public'],
        tablename: 'inbox_rule',
      },
      {
        cmd: 'UPDATE',
        policyname: 'inbox_rule_update',
        roles: ['public'],
        tablename: 'inbox_rule',
      },
    ]);

    const grants = await rootPool.query<{
      grantee: string;
      privileges: string[];
      table_name: string;
    }>(
      `select table_name, grantee, array_agg(privilege_type::text order by privilege_type) as privileges
       from information_schema.role_table_grants
       where table_schema = 'app'
         and table_name in ('inbox_rule', 'inbox_correction')
         and grantee <> 'bap_owner'
       group by table_name, grantee
       order by table_name, grantee`,
    );
    expect(grants.rows).toEqual([
      {
        grantee: 'bap_api',
        privileges: ['INSERT', 'SELECT'],
        table_name: 'inbox_correction',
      },
      {
        grantee: 'bap_backup',
        privileges: ['SELECT'],
        table_name: 'inbox_correction',
      },
      {
        grantee: 'bap_reporting',
        privileges: ['SELECT'],
        table_name: 'inbox_correction',
      },
      {
        grantee: 'bap_api',
        privileges: ['INSERT', 'SELECT', 'UPDATE'],
        table_name: 'inbox_rule',
      },
      {
        grantee: 'bap_backup',
        privileges: ['SELECT'],
        table_name: 'inbox_rule',
      },
      {
        grantee: 'bap_reporting',
        privileges: ['SELECT'],
        table_name: 'inbox_rule',
      },
    ]);

    // The dangling pointer of 20260916.0001 is now a composite, restricting foreign key.
    await expect(
      rootPool.query<{ condeferrable: boolean; confdeltype: string }>(
        `select confdeltype, condeferrable from pg_constraint
         where conname = 'inbox_item_decided_by_rule_fkey' and conrelid = 'app.inbox_item'::regclass`,
      ),
    ).resolves.toMatchObject({
      rows: [{ condeferrable: false, confdeltype: 'r' }],
    });
    await expect(
      rootPool.query<{ condeferrable: boolean; condeferred: boolean }>(
        `select condeferrable, condeferred from pg_constraint
         where conname = 'inbox_rule_organization_priority_key'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ condeferrable: true, condeferred: true }],
    });
  });

  it('enforces the condition, action, discard, priority and pattern checks', async () => {
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_condition_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        senderPattern: '@dodavatel.test',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_action_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        discardReason: 'spam',
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_discard_exclusive_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        autoRoute: true,
        discardReason: 'spam',
        priority: 1,
        senderPattern: '@dodavatel.test',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_discard_exclusive_check',
    });
    // Priority is null exactly when the rule is soft deleted.
    await expect(
      insertRule(orgOneAdmin, {
        priority: null,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_priority_deleted_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        deletedAt: '2026-09-17T00:00:00Z',
        enabled: false,
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_priority_deleted_check',
    });
    for (const senderPattern of [
      'Faktury@Dodavatel.test',
      'dodavatel.test',
      '@',
      'two words@dodavatel.test',
      `@${'a'.repeat(320)}`,
    ]) {
      await expect(
        insertRule(orgOneAdmin, {
          priority: 1,
          senderPattern,
          setDocumentKind: 'receipt',
        }),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'inbox_rule_sender_pattern_check',
      });
    }
    await expect(
      insertRule(orgOneAdmin, {
        keyword: 'k'.repeat(121),
        priority: 1,
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_keyword_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        detectedType: 'Invoice',
        priority: 1,
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_detected_type_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'newsletter',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_set_document_kind_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        discardReason: 'boring',
        priority: 1,
        senderPattern: '@dodavatel.test',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_discard_reason_check',
    });
    await expect(
      insertRule(orgOneAdmin, {
        name: '',
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_rule_name_check',
    });
    // The composite keys pin every referenced row to the organization.
    await expect(
      insertRule(orgOneAdmin, {
        channelId: foreignChannelId,
        priority: 1,
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_rule_channel_fkey',
    });
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setLegalEntityId: foreignEntityId,
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_rule_set_legal_entity_fkey',
    });
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setPartnerId: foreignPartnerId,
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_rule_set_partner_fkey',
    });
  });

  it('lets owner and admin write a rule as themselves and keeps member and channel out', async () => {
    await expect(
      insertRule(orgOneMember, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      insertRule(orgOneChannel, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({ code: '42501' });
    // The created_by check: an admin cannot author a rule as someone else.
    await expect(
      insertRule(
        orgOneAdmin,
        {
          priority: 1,
          senderPattern: '@dodavatel.test',
          setDocumentKind: 'receipt',
        },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const first = await insertRule(orgOneAdmin, {
      channelId: ownedChannelId,
      name: 'Placeholder first',
      priority: 1,
      setLegalEntityId: ownedEntityId,
      setPartnerId: ownedPartnerId,
    });
    const second = await insertRule(orgOneOwner, {
      keyword: 'Mzdy',
      name: 'Placeholder second',
      priority: 2,
      setAssigneeId: 'user-3',
      setDocumentKind: 'payroll',
    });
    const firstId = first.rows[0]?.id ?? '';
    const secondId = second.rows[0]?.id ?? '';

    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ name: string }>(
          'select name from app.inbox_rule order by priority',
        ),
      ),
    ).resolves.toMatchObject({
      rows: [{ name: 'Placeholder first' }, { name: 'Placeholder second' }],
    });
    await expect(
      asTenant(reportingPool, orgOneMember, (transaction) =>
        transaction.query<{ created_by: string }>(
          'select created_by from app.inbox_rule order by priority',
        ),
      ),
    ).resolves.toMatchObject({
      rows: [{ created_by: 'user-4' }, { created_by: 'user-1' }],
    });
    // The channel holds no SELECT on the rule table: it reads the matcher's columns through the definer only.
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select id from app.inbox_rule'),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    // A member updates nothing; an admin updates, and a reorder swaps priorities in one statement.
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query(
          'update app.inbox_rule set enabled = false where id = $1',
          [firstId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          `update app.inbox_rule
           set priority = case when id = $1 then 2 else 1 end, updated_at = now()
           where id in ($1, $2)`,
          [firstId, secondId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 2 });
    await expect(
      rootPool.query<{ id: string }>(
        `select id from app.inbox_rule where organization_id = 'org-1' order by priority`,
      ),
    ).resolves.toMatchObject({ rows: [{ id: secondId }, { id: firstId }] });
    // The deferred unique still holds at commit.
    await expect(
      insertRule(orgOneAdmin, {
        priority: 1,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      }),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'inbox_rule_organization_priority_key',
    });

    // No DELETE grant and no DELETE policy: the only delete is deleted_at.
    await expect(
      asTenant(apiPool, orgOneOwner, (transaction) =>
        transaction.query('delete from app.inbox_rule where id = $1', [
          firstId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asOwner((client) =>
        client.query('delete from app.inbox_rule where id = $1', [firstId]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          'update app.inbox_rule set deleted_at = now(), enabled = false, priority = null where id = $1',
          [firstId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    // Adoption: created_by moves only to the session user.
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_rule set created_by = 'user-3' where id = $1",
          [secondId],
        ),
      ),
    ).rejects.toMatchObject({
      code: '42501',
      message: 'An inbox rule is adopted only by the session user',
    });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_rule set created_by = 'user-4' where id = $1",
          [secondId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      rootPool.query<{ created_by: string }>(
        'select created_by from app.inbox_rule where id = $1',
        [secondId],
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: 'user-4' }] });
  });

  it('keeps a rule that decided an item and pins the pointer to the organization', async () => {
    await seedRule(
      foreignRuleId,
      'org-2',
      { priority: 1, senderPattern: '@cizi.test', setDocumentKind: 'receipt' },
      'user-2',
    );
    const decidingRule = await rootPool.query<{ id: string }>(
      "select id from app.inbox_rule where organization_id = 'org-1' and deleted_at is null",
    );
    const decidingRuleId = decidingRule.rows[0]?.id ?? '';

    await expect(
      rootPool.query(
        `update app.inbox_item set decided_by_kind = 'rule', decided_by_rule_id = $2 where id = $1`,
        [decidedItemId, foreignRuleId],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'inbox_item_decided_by_rule_fkey',
    });
    await expect(
      rootPool.query(
        `update app.inbox_item set decided_by_kind = 'rule', decided_by_rule_id = $2 where id = $1`,
        [decidedItemId, decidingRuleId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    // No policy admits a delete, so the superuser is the only path that reaches the foreign key.
    await expect(
      rootPool.query('delete from app.inbox_rule where id = $1', [
        decidingRuleId,
      ]),
    ).rejects.toMatchObject({
      code: '23001',
      constraint: 'inbox_item_decided_by_rule_fkey',
    });
  });

  it('records a correction once, as the person who routed, and never lets it change', async () => {
    await expect(
      insertCorrection(orgOneMember, 'kind', 'rule'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      insertCorrection(orgOneChannel, 'kind', 'rule'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      insertCorrection(orgOneAdmin, 'kind', 'rule', 'user-1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      insertCorrection(orgOneAdmin, 'amount', 'rule'),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_correction_field_check',
    });
    await expect(
      insertCorrection(orgOneAdmin, 'kind', 'guess'),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_correction_source_check',
    });
    await expect(
      insertCorrection(orgOneAdmin, 'kind', 'rule', 'user-4', 'r'.repeat(501)),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_correction_reason_check',
    });
    await expect(
      insertCorrection(orgOneAdmin, 'kind', 'rule', 'user-4', 'Not an invoice'),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ field: string; source: string }>(
          'select field, source from app.inbox_correction',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ field: 'kind', source: 'rule' }] });
    await expect(
      asTenant(reportingPool, orgOneMember, (transaction) =>
        transaction.query<{ reason: string }>(
          'select reason from app.inbox_correction',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ reason: 'Not an invoice' }] });
    await expect(
      asTenant(apiPool, orgOneChannel, (transaction) =>
        transaction.query('select id from app.inbox_correction'),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query(
          "update app.inbox_correction set final_value = 'other'",
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneAdmin, (transaction) =>
        transaction.query('delete from app.inbox_correction'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lists the live rules whose author is still a verified owner or admin, in priority order', async () => {
    await seedRule(
      ownerRuleId,
      'org-1',
      {
        priority: 110,
        senderPattern: '@dodavatel.test',
        setDocumentKind: 'receipt',
      },
      'user-1',
    );
    await seedRule(
      memberRuleId,
      'org-1',
      {
        priority: 111,
        senderPattern: '@member.test',
        setDocumentKind: 'receipt',
      },
      'user-3',
    );
    await seedRule(
      unverifiedRuleId,
      'org-1',
      {
        priority: 112,
        senderPattern: '@unverified.test',
        setDocumentKind: 'receipt',
      },
      'user-5',
    );
    await seedRule(
      removedRuleId,
      'org-1',
      {
        priority: 113,
        senderPattern: '@removed.test',
        setDocumentKind: 'receipt',
      },
      'user-6',
    );
    await seedRule(
      outsiderRuleId,
      'org-1',
      {
        priority: 114,
        senderPattern: '@outsider.test',
        setDocumentKind: 'receipt',
      },
      'user-2',
    );
    await seedRule(
      disabledRuleId,
      'org-1',
      {
        enabled: false,
        priority: 115,
        senderPattern: '@disabled.test',
        setDocumentKind: 'receipt',
      },
      'user-4',
    );
    await seedRule(
      deletedRuleId,
      'org-1',
      {
        deletedAt: '2026-09-17T00:00:00Z',
        enabled: false,
        priority: null,
        senderPattern: '@deleted.test',
        setDocumentKind: 'receipt',
      },
      'user-4',
    );
    await seedRule(
      adminRuleId,
      'org-1',
      {
        autoRoute: true,
        channelId: ownedChannelId,
        detectedType: 'isdoc_invoice',
        keyword: 'Faktura',
        priority: 105,
        setAssigneeId: 'user-3',
        setLegalEntityId: ownedEntityId,
        setPartnerId: ownedPartnerId,
      },
      'user-4',
    );
    await seedRule(
      demotedRuleId,
      'org-1',
      { discardReason: 'spam', priority: 116, senderPattern: '@demoted.test' },
      'user-7',
    );

    await expect(
      apiPool.query('select * from app.list_inbox_rules()'),
    ).rejects.toMatchObject({ code: '42501' });

    const listed = await asTenant(apiPool, orgOneChannel, (transaction) =>
      transaction.query<Record<string, unknown>>(
        'select * from app.list_inbox_rules()',
      ),
    );
    // The adopted rule of the write test sits at priority 1 and stays listed: its adopter is an admin.
    expect(listed.rows.map((row) => row['id'])).toEqual([
      secondLiveRuleId(listed.rows),
      adminRuleId,
      ownerRuleId,
      demotedRuleId,
    ]);
    expect(listed.rows[1]).toEqual({
      auto_route: true,
      channel_id: ownedChannelId,
      detected_type: 'isdoc_invoice',
      discard_reason: null,
      id: adminRuleId,
      keyword: 'Faktura',
      priority: 105,
      sender_pattern: null,
      set_assignee_id: 'user-3',
      set_document_kind: null,
      set_legal_entity_id: ownedEntityId,
      set_partner_id: ownedPartnerId,
    });
    expect(listed.rows.at(-1)).toMatchObject({
      discard_reason: 'spam',
      id: demotedRuleId,
      priority: 116,
    });
    for (const row of listed.rows) {
      expect(Object.keys(row)).not.toContain('name');
      expect(Object.keys(row)).not.toContain('created_by');
    }

    // A demoted author pauses the rule at read time, with no write to the rule.
    await rootPool.query(
      "update auth.member set role = 'member' where user_id = 'user-7'",
    );
    await expect(
      asTenant(apiPool, orgOneMember, (transaction) =>
        transaction.query<{ id: string }>(
          'select id from app.list_inbox_rules()',
        ),
      ),
    ).resolves.toMatchObject({
      rows: [
        { id: secondLiveRuleId(listed.rows) },
        { id: adminRuleId },
        { id: ownerRuleId },
      ],
    });
    await expect(
      asTenant(apiPool, orgTwoAutomation, (transaction) =>
        transaction.query<{ id: string }>(
          'select id from app.list_inbox_rules()',
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ id: foreignRuleId }] });
  });

  it('records an automation skip on an item in review of the current organization only', async () => {
    await expect(
      apiPool.query(
        "select app.record_inbox_automation_skip($1, 'rule_author_unavailable')",
        [reviewItemId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant(apiPool, orgOneAutomation, (transaction) =>
        transaction.query(
          "select app.record_inbox_automation_skip($1, 'stalled')",
          [reviewItemId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      asTenant(apiPool, orgOneAutomation, (transaction) =>
        transaction.query(
          "select app.record_inbox_automation_skip($1, 'rule_author_unavailable')",
          [routedItemId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      asTenant(apiPool, orgOneAutomation, (transaction) =>
        transaction.query(
          "select app.record_inbox_automation_skip($1, 'rule_author_unavailable')",
          [foreignReviewItemId],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });

    const recorded = await asTenant(apiPool, orgOneAutomation, (transaction) =>
      transaction.query<{ event_id: string }>(
        "select app.record_inbox_automation_skip($1, 'rule_author_unavailable') as event_id",
        [reviewItemId],
      ),
    );
    await expect(
      rootPool.query<{
        actor_user_id: string | null;
        item_id: string;
        kind: string;
        organization_id: string;
        reason: string;
      }>(
        `select organization_id, item_id, kind, reason, actor_user_id
         from app.inbox_event where id = $1`,
        [recorded.rows[0]?.event_id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          actor_user_id: null,
          item_id: reviewItemId,
          kind: 'failed',
          organization_id: 'org-1',
          reason: 'rule_author_unavailable',
        },
      ],
    });
    // The subject itself writes nothing directly: the member role has no INSERT on inbox_event.
    await expect(
      asTenant(apiPool, orgOneAutomation, (transaction) =>
        transaction.query(
          `insert into app.inbox_event (organization_id, item_id, kind, reason)
           values ('org-1', $1, 'failed', 'rule_author_unavailable')`,
          [reviewItemId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the system namespace out of identities and out of erasure', async () => {
    await expect(
      asOwner((client) =>
        client.query(
          `insert into auth."user" (id, name, email, email_verified)
           values ('system_automation', 'Automation', 'automation@example.test', true)`,
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'user_id_not_system_check',
    });
    await expect(
      asEraser((client) =>
        client.query('select app.erase_user($1)', ['system_automation']),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('erases the rule author, the rule assignee and the correction author', async () => {
    // One rule keeps another action and stays live; the other assigned the subject and nothing else, so it is retired.
    await rootPool.query(
      `insert into app.inbox_rule
         (organization_id, name, priority, sender_pattern, set_document_kind, set_assignee_id, created_by)
       values ('org-2', 'Placeholder erased author', 2, '@erased.test', 'receipt', 'erasure-user', 'erasure-user'),
              ('org-2', 'Placeholder erased assignee', 3, '@erased.test', null, 'erasure-user', 'user-2')`,
    );
    await rootPool.query(
      `insert into app.inbox_correction
         (organization_id, inbox_item_id, field, suggested_value, final_value, source, created_by)
       values ('org-2', $1, 'title', 'a', 'b', 'provider', 'erasure-user')`,
      [foreignReviewItemId],
    );

    const erasure = await asEraser((client) =>
      client.query<{ tombstone: string | null }>(
        'select app.erase_user($1) as tombstone',
        ['erasure-user'],
      ),
    );
    const tombstone = erasure.rows[0]?.tombstone;
    expect(tombstone).toMatch(/^erased_/);

    await expect(
      rootPool.query<{
        created_by: string;
        deleted: boolean;
        enabled: boolean;
        priority: number | null;
        set_assignee_id: string | null;
      }>(
        `select created_by, set_assignee_id, enabled, priority, deleted_at is not null as deleted
         from app.inbox_rule where organization_id = 'org-2' and name like 'Placeholder erased%'
         order by name`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          created_by: 'user-2',
          deleted: true,
          enabled: false,
          priority: null,
          set_assignee_id: null,
        },
        {
          created_by: tombstone,
          deleted: false,
          enabled: true,
          priority: 2,
          set_assignee_id: null,
        },
      ],
    });
    await expect(
      rootPool.query<{ created_by: string }>(
        "select created_by from app.inbox_correction where organization_id = 'org-2'",
      ),
    ).resolves.toMatchObject({ rows: [{ created_by: tombstone }] });
    // A subject with no remaining row is a no-op.
    await expect(
      asEraser((client) =>
        client.query<{ tombstone: string | null }>(
          'select app.erase_user($1) as tombstone',
          ['erasure-user'],
        ),
      ),
    ).resolves.toMatchObject({ rows: [{ tombstone: null }] });
  });
});

// The rule the write test left live at priority 1 after the swap: its id is generated, so it is read back.
function secondLiveRuleId(rows: Record<string, unknown>[]): unknown {
  return rows.find((row) => row['priority'] === 1)?.['id'];
}
