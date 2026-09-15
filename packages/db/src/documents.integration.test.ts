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

afterAll(async () => {
  await Promise.all([
    apiPool.end(),
    backupPool.end(),
    migratorPool.end(),
    reportingPool.end(),
    rootPool.end(),
  ]);
  await container.stop();
});

describe('documents register isolation', () => {
  it('applies the documents migration and records the compatible version', async () => {
    const result = await runMigrations(migratorPool);
    const compatibility = await checkMigrationCompatibility(apiPool);

    expect(result.applied).toEqual([]);
    expect(result.currentVersion).toBe('20260915.0001');
    expect(DATABASE_MIGRATION_COMPATIBILITY).toBe('20260915.0001');
    expect(compatibility).toEqual({
      compatible: true,
      expectedVersion: '20260915.0001',
      version: '20260915.0001',
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
    const poolOn = (user: string): Pool =>
      new Pool({
        database: backfillDatabase,
        host: container.getHost(),
        password: testPassword,
        port: container.getPort(),
        user,
      });
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

      // Everything except the migration under test, so the register is populated the way an existing database is.
      for (const entry of await readdir(source)) {
        if (entry.endsWith('.sql') && !entry.startsWith('20260915.0001')) {
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
});
