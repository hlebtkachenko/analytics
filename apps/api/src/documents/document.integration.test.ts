import { BadRequestException } from '@nestjs/common';
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

import {
  createDocumentRequestSchema,
  documentListQuerySchema,
} from './contract.js';
import type { CreateDocumentRequest, DocumentListQuery } from './contract.js';
import {
  createDocument,
  createDocumentLink,
  deleteDocument,
  deleteDocumentLink,
  isDuplicateDocumentLink,
  listDirectiveAccounts,
  listDocuments,
  readDocument,
  updateDocument,
} from './document-repository.js';
import {
  createPartner,
  isDuplicatePartnerRegistration,
  listPartners,
  updatePartner,
} from './partner-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;

// Neutral placeholder tenants: an owner, a restricted member beside it, and a stranger in another organization.
const creator: TenantContext = {
  organizationId: 'org-1',
  role: 'owner',
  userId: 'user-1',
};
const reader: TenantContext = {
  organizationId: 'org-1',
  role: 'member',
  userId: 'user-2',
};
// An admin may write documents, so it is the caller that reaches the partner patch with a narrow entity scope.
const deputy: TenantContext = {
  organizationId: 'org-1',
  role: 'admin',
  userId: 'user-4',
};
const stranger: TenantContext = {
  organizationId: 'org-2',
  role: 'owner',
  userId: 'user-3',
};
// The absence of an entity filter is the "all entities" view.
const allEntities = { legalEntityIds: null };

let foreignEntityId = '';
let ownedEntityId = '';
let secondEntityId = '';
let partnerId = '';
let issuedDocumentId = '';
let reverseChargeDocumentId = '';
let unattributedDocumentId = '';
let contractDocumentId = '';
let foreignDocumentId = '';

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

async function createLegalEntity(
  tenant: TenantContext,
  name: string,
): Promise<string> {
  return asTenant(tenant, async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, $2, 'company', $3)
       returning id`,
      [tenant.organizationId, name, tenant.userId],
    );
    return created.rows[0]?.id ?? '';
  });
}

function listQuery(overrides: Record<string, unknown> = {}): DocumentListQuery {
  return documentListQuerySchema.parse(overrides);
}

function createBody(overrides: Record<string, unknown>): CreateDocumentRequest {
  return createDocumentRequestSchema.parse(overrides);
}

async function register(
  tenant: TenantContext,
  overrides: Record<string, unknown>,
): Promise<string> {
  const created = await createDocument(apiPool, {
    ...tenant,
    ...allEntities,
    body: createBody(overrides),
  });

  if (created === null) {
    throw new Error('The document was not created.');
  }

  return created.document.id;
}

// The published account shape of one event, which is what a P&L or a payables view reads.
function accountShape(
  lines: readonly { accountCode: string; amount: string; side: string }[],
): { accountCode: string; amount: string; side: string }[] {
  return lines.map((line) => ({
    accountCode: line.accountCode,
    amount: line.amount,
    side: line.side,
  }));
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
    await migrator.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Creator', 'creator@example.test', true),
             ('user-2', 'Grantee', 'grantee@example.test', true),
             ('user-3', 'Stranger', 'stranger@example.test', true),
             ('user-4', 'Deputy', 'deputy@example.test', true)
    `);
    await migrator.query(`
      insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one'), ('org-2', 'Two', 'two')
    `);
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner'),
             ('member-2', 'org-1', 'user-2', 'member'),
             ('member-3', 'org-2', 'user-3', 'owner'),
             ('member-4', 'org-1', 'user-4', 'admin')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = createDatabasePool(configurationFor('bap_api'));
  ownedEntityId = await createLegalEntity(creator, 'Placeholder Holding');
  secondEntityId = await createLegalEntity(creator, 'Placeholder Trader');
  foreignEntityId = await createLegalEntity(stranger, 'Placeholder Foreign');

  const partner = await createPartner(apiPool, {
    ...creator,
    ...allEntities,
    countryCode: 'CZ',
    legalEntityId: null,
    name: 'Placeholder Partner',
    registrationNumber: 'AB-123456',
    vatNumber: 'CZ12345678',
  });
  partnerId = partner?.id ?? '';

  // Two standard lines at 21 per cent: the receivable is gross per line and the revenue splits by category.
  issuedDocumentId = await register(creator, {
    documentDate: '2026-03-01',
    invoice: {
      lines: [
        {
          baseAmount: '1000.0000',
          category: 'services',
          description: 'placeholder service line',
          vatAmount: '210.0000',
          vatMode: 'standard',
          vatRate: '21.00',
        },
        {
          baseAmount: '500.0000',
          category: 'goods',
          description: 'placeholder goods line',
          vatAmount: '105.0000',
          vatMode: 'standard',
          vatRate: '21.00',
        },
      ],
    },
    kind: 'issued_invoice',
    legalEntityId: ownedEntityId,
    partnerId,
    reference: 'PLACEHOLDER-ALPHA',
    title: 'Placeholder alpha',
  });
  reverseChargeDocumentId = await register(creator, {
    documentDate: '2026-04-15',
    invoice: {
      lines: [
        {
          baseAmount: '2000.0000',
          category: 'services',
          description: 'placeholder reverse charge line',
          vatMode: 'reverse_charge',
          vatRate: '21.00',
        },
      ],
    },
    kind: 'received_invoice',
    legalEntityId: ownedEntityId,
    partnerId,
    reference: 'PLACEHOLDER-BETA',
    title: 'Placeholder beta',
  });
  unattributedDocumentId = await register(creator, {
    currencyCode: 'EUR',
    documentDate: '2026-05-20',
    invoice: {
      lines: [
        {
          baseAmount: '100.0000',
          category: 'services',
          description: 'placeholder exempt line',
          vatMode: 'exempt',
        },
      ],
    },
    kind: 'issued_invoice',
    legalEntityId: ownedEntityId,
    reference: 'PLACEHOLDER-GAMMA',
    title: 'Placeholder gamma',
  });
  contractDocumentId = await register(creator, {
    attributes: { counterparty_role: 'placeholder' },
    documentDate: '2026-06-10',
    kind: 'contract',
    legalEntityId: secondEntityId,
    reference: 'PLACEHOLDER-DELTA',
    title: 'Placeholder delta',
    totalAmount: '50.0000',
  });
  foreignDocumentId = await register(stranger, {
    documentDate: '2026-03-02',
    kind: 'contract',
    legalEntityId: foreignEntityId,
    title: 'Placeholder foreign',
  });

  // The member and the admin deputy are both restricted to the second entity only, which the API resolver reads back.
  await asTenant(creator, async (transaction) => {
    for (const restricted of [reader, deputy]) {
      await transaction.query(
        `insert into app.member_entity_scope (organization_id, user_id, mode, updated_by)
         values ($1, $2, 'restricted', $3)`,
        [creator.organizationId, restricted.userId, creator.userId],
      );
      await transaction.query(
        `insert into app.legal_entity_access (organization_id, user_id, legal_entity_id, created_by)
         values ($1, $2, $3, $4)`,
        [
          creator.organizationId,
          restricted.userId,
          secondEntityId,
          creator.userId,
        ],
      );
    }
  });
});

afterAll(async () => {
  await Promise.all([apiPool.end(), migratorPool.end()]);
  await container.stop();
});

describe('document register and derived events against PostgreSQL', () => {
  it('derives a balanced event with exact accounts for an issued standard invoice', async () => {
    const detail = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: issuedDocumentId,
    });

    expect(accountShape(detail?.event?.lines ?? [])).toEqual([
      { accountCode: '311', amount: '1210.0000', side: 'debit' },
      { accountCode: '602', amount: '1000.0000', side: 'credit' },
      { accountCode: '343', amount: '210.0000', side: 'credit' },
      { accountCode: '311', amount: '605.0000', side: 'debit' },
      { accountCode: '604', amount: '500.0000', side: 'credit' },
      { accountCode: '343', amount: '105.0000', side: 'credit' },
    ]);
    expect(detail?.event).toMatchObject({
      creditTotal: '1815.0000',
      debitTotal: '1815.0000',
      eventDate: '2026-03-01',
      isBalanced: true,
      ruleSetVersion: 'cz-default-2026-09.1',
    });
    // The receivable carries the partner; the revenue and VAT legs do not.
    expect(detail?.event?.lines.map((line) => line.partnerId)).toEqual([
      partnerId,
      null,
      null,
      partnerId,
      null,
      null,
    ]);
    // Every event line names its directive account, which is what makes the chart comparable across entities.
    expect(detail?.event?.lines[0]?.accountName.length).toBeGreaterThan(0);
    // Invoice totals are computed on the server, so the stored trio and the register total agree by construction.
    expect(detail?.invoice).toMatchObject({
      baseTotal: '1500.0000',
      grossTotal: '1815.0000',
      vatTotal: '315.0000',
    });
    expect(detail?.document.totalAmount).toBe('1815.0000');
    expect(detail?.issues).toEqual([]);
  });

  it('self-assesses a received reverse charge on both sides of 343', async () => {
    const detail = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: reverseChargeDocumentId,
    });

    expect(accountShape(detail?.event?.lines ?? [])).toEqual([
      { accountCode: '518', amount: '2000.0000', side: 'debit' },
      { accountCode: '321', amount: '2000.0000', side: 'credit' },
      { accountCode: '343', amount: '420.0000', side: 'debit' },
      { accountCode: '343', amount: '420.0000', side: 'credit' },
    ]);
    expect(detail?.event).toMatchObject({
      creditTotal: '2420.0000',
      debitTotal: '2420.0000',
      isBalanced: true,
    });
    // The line stores no VAT, so the register total is the net amount and the self-assessment nets to nothing.
    expect(detail?.invoice).toMatchObject({
      baseTotal: '2000.0000',
      grossTotal: '2000.0000',
      vatTotal: '0.0000',
    });
    expect(detail?.issues).toEqual([]);
  });

  it('warns about a missing partner and clears the warning once one is set', async () => {
    const before = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: unattributedDocumentId,
    });

    expect(before?.issues.map((issue) => issue.code)).toEqual([
      'missing_partner',
    ]);
    expect(before?.issues[0]?.severity).toBe('warning');
    expect(before?.event?.isBalanced).toBe(true);

    const after = await updateDocument(apiPool, {
      ...creator,
      ...allEntities,
      body: { partnerId },
      documentId: unattributedDocumentId,
    });

    // A changed partner re-derives the event, so the warning and the unattributed receivable go together.
    expect(after?.issues).toEqual([]);
    expect(after?.event?.lines[0]).toMatchObject({
      accountCode: '311',
      partnerId,
    });

    const cleared = await updateDocument(apiPool, {
      ...creator,
      ...allEntities,
      body: { partnerId: null },
      documentId: unattributedDocumentId,
    });

    expect(cleared?.issues.map((issue) => issue.code)).toEqual([
      'missing_partner',
    ]);
    expect(cleared?.event?.lines[0]?.partnerId).toBeNull();
  });

  it('never returns another tenant document or its content', async () => {
    const crossTenantRead = await readDocument(apiPool, {
      ...stranger,
      ...allEntities,
      documentId: issuedDocumentId,
    });
    const ownRead = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: foreignDocumentId,
    });
    const strangerList = await listDocuments(apiPool, {
      ...stranger,
      ...allEntities,
      query: listQuery(),
    });

    expect(crossTenantRead).toBeNull();
    expect(ownRead).toBeNull();
    expect(strangerList.documents.map((entry) => entry.id)).toEqual([
      foreignDocumentId,
    ]);
    expect(strangerList.total).toBe(1);
  });

  it('shows a restricted member only the documents of its allowed entity', async () => {
    const scoped = await listDocuments(apiPool, {
      ...reader,
      legalEntityIds: [secondEntityId],
      query: listQuery(),
    });
    const inScope = await readDocument(apiPool, {
      ...reader,
      documentId: contractDocumentId,
      legalEntityIds: [secondEntityId],
    });
    const outOfScope = await readDocument(apiPool, {
      ...reader,
      documentId: issuedDocumentId,
      legalEntityIds: [secondEntityId],
    });
    // A filter naming an entity outside the scope can only be empty, never a wider query.
    const refused = await listDocuments(apiPool, {
      ...reader,
      legalEntityIds: [secondEntityId],
      query: listQuery({ legalEntityId: ownedEntityId }),
    });
    // An empty list is a caller who may see nothing, which is not the same as no filter at all.
    const nothing = await listDocuments(apiPool, {
      ...reader,
      legalEntityIds: [],
      query: listQuery(),
    });

    expect(scoped.documents.map((entry) => entry.id)).toEqual([
      contractDocumentId,
    ]);
    expect(scoped.total).toBe(1);
    expect(inScope?.attributes).toEqual({ counterparty_role: 'placeholder' });
    // A document outside the scope answers exactly like a missing one.
    expect(outOfScope).toBeNull();
    expect(refused.documents).toEqual([]);
    expect(refused.totalsByCurrency).toEqual([]);
    expect(nothing.total).toBe(0);
  });

  it('refuses a write from the read-only member role', async () => {
    await expect(
      createDocument(apiPool, {
        ...reader,
        legalEntityIds: [secondEntityId],
        body: createBody({
          documentDate: '2026-07-01',
          kind: 'contract',
          legalEntityId: secondEntityId,
          title: 'Placeholder refused',
        }),
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('counts and totals the whole filtered set, not the page', async () => {
    const page = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ pageSize: '2' }),
    });

    // The newest document date first, with the id as the stable tie breaker.
    expect(page.documents.map((entry) => entry.id)).toEqual([
      contractDocumentId,
      unattributedDocumentId,
    ]);
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 4 });
    expect(page.totalsByCurrency).toEqual([
      { currencyCode: 'CZK', totalAmount: '3865.0000' },
      { currencyCode: 'EUR', totalAmount: '100.0000' },
    ]);

    const second = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ page: '2', pageSize: '2' }),
    });

    expect(second.documents.map((entry) => entry.id)).toEqual([
      reverseChargeDocumentId,
      issuedDocumentId,
    ]);
    expect(second.total).toBe(4);
  });

  it('applies every list filter exactly', async () => {
    const byKind = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ kind: 'issued_invoice' }),
    });
    const byRange = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ dateFrom: '2026-04-01', dateTo: '2026-05-31' }),
    });
    const bySearch = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ q: 'alpha' }),
    });
    const byReference = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ q: 'PLACEHOLDER-BETA' }),
    });
    const byPartner = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ partnerId }),
    });
    const byEntity = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ legalEntityId: secondEntityId }),
    });

    expect(byKind.documents.map((entry) => entry.id)).toEqual([
      unattributedDocumentId,
      issuedDocumentId,
    ]);
    expect(byKind.total).toBe(2);
    expect(byKind.totalsByCurrency).toEqual([
      { currencyCode: 'CZK', totalAmount: '1815.0000' },
      { currencyCode: 'EUR', totalAmount: '100.0000' },
    ]);
    expect(byRange.documents.map((entry) => entry.id)).toEqual([
      unattributedDocumentId,
      reverseChargeDocumentId,
    ]);
    expect(bySearch.documents.map((entry) => entry.id)).toEqual([
      issuedDocumentId,
    ]);
    expect(byReference.documents.map((entry) => entry.id)).toEqual([
      reverseChargeDocumentId,
    ]);
    expect(byPartner.documents.map((entry) => entry.id)).toEqual([
      reverseChargeDocumentId,
      issuedDocumentId,
    ]);
    expect(byEntity.documents.map((entry) => entry.id)).toEqual([
      contractDocumentId,
    ]);
    // A search term is data, so its wildcard characters match literally and find nothing.
    const literal = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ q: '%' }),
    });
    expect(literal.total).toBe(0);
  });

  it('filters on the lifecycle status the caller sets', async () => {
    await updateDocument(apiPool, {
      ...creator,
      ...allEntities,
      body: { status: 'verified' },
      documentId: contractDocumentId,
    });
    const verified = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ status: 'verified' }),
    });
    const open = await listDocuments(apiPool, {
      ...creator,
      ...allEntities,
      query: listQuery({ status: 'registered,needs_review' }),
    });

    expect(verified.documents.map((entry) => entry.id)).toEqual([
      contractDocumentId,
    ]);
    expect(open.total).toBe(3);
  });

  it('refuses a second partner with the same registration number', async () => {
    const listed = await listPartners(apiPool, {
      ...creator,
      legalEntityIds: null,
      q: 'placeholder',
    });

    expect(listed.map((entry) => entry.id)).toEqual([partnerId]);

    let caught: unknown;

    try {
      await createPartner(apiPool, {
        ...creator,
        ...allEntities,
        countryCode: null,
        legalEntityId: null,
        name: 'Placeholder Duplicate',
        registrationNumber: 'AB-123456',
        vatNumber: null,
      });
    } catch (error) {
      caught = error;
    }

    expect(isDuplicatePartnerRegistration(caught)).toBe(true);

    // The index is partial, so any number of unidentified partners coexist.
    const unidentified = await createPartner(apiPool, {
      ...creator,
      ...allEntities,
      countryCode: null,
      legalEntityId: null,
      name: 'Placeholder Unidentified',
      registrationNumber: null,
      vatNumber: null,
    });

    expect(unidentified).not.toBeNull();
    // The same number in another organization is a different partner, because the index leads with the tenant.
    const foreign = await createPartner(apiPool, {
      ...stranger,
      ...allEntities,
      countryCode: null,
      legalEntityId: null,
      name: 'Placeholder Foreign Partner',
      registrationNumber: 'AB-123456',
      vatNumber: null,
    });

    expect(foreign).not.toBeNull();
  });

  it('publishes the whole shared directive chart to every tenant', async () => {
    const accounts = await listDirectiveAccounts(apiPool, creator);
    const codes = new Set(accounts.map((account) => account.code));

    // The accounts the rule set books must all exist, or a derived event could not be stored at all.
    for (const code of ['311', '321', '343', '602', '604', '518', '504']) {
      expect(codes.has(code)).toBe(true);
    }
    expect(accounts.length).toBeGreaterThan(200);
  });

  it('links two visible documents once and hides an invisible end', async () => {
    const link = await createDocumentLink(apiPool, {
      ...creator,
      ...allEntities,
      documentId: issuedDocumentId,
      kind: 'settles',
      toDocumentId: reverseChargeDocumentId,
    });

    expect(link).toMatchObject({
      fromDocumentId: issuedDocumentId,
      kind: 'settles',
      toDocumentId: reverseChargeDocumentId,
    });

    // Both ends see the link, so a document detail shows what it settles and what settles it.
    const from = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: issuedDocumentId,
    });
    const to = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: reverseChargeDocumentId,
    });

    expect(from?.links.map((entry) => entry.id)).toEqual([link?.id]);
    expect(to?.links.map((entry) => entry.id)).toEqual([link?.id]);

    let caught: unknown;

    try {
      await createDocumentLink(apiPool, {
        ...creator,
        ...allEntities,
        documentId: issuedDocumentId,
        kind: 'settles',
        toDocumentId: reverseChargeDocumentId,
      });
    } catch (error) {
      caught = error;
    }

    expect(isDuplicateDocumentLink(caught)).toBe(true);

    // A document the caller cannot see is not a valid end, and the answer never reveals that it exists.
    expect(
      await createDocumentLink(apiPool, {
        ...creator,
        ...allEntities,
        documentId: issuedDocumentId,
        kind: 'relates',
        toDocumentId: foreignDocumentId,
      }),
    ).toBeNull();
    expect(
      await createDocumentLink(apiPool, {
        ...reader,
        documentId: contractDocumentId,
        kind: 'relates',
        legalEntityIds: [secondEntityId],
        toDocumentId: issuedDocumentId,
      }),
    ).toBeNull();

    const removed = await deleteDocumentLink(apiPool, {
      ...creator,
      ...allEntities,
      documentId: issuedDocumentId,
      linkId: link?.id ?? '',
    });

    expect(removed).toBe(true);
    expect(
      await deleteDocumentLink(apiPool, {
        ...creator,
        ...allEntities,
        documentId: issuedDocumentId,
        linkId: link?.id ?? '',
      }),
    ).toBe(false);
  });

  it('round-trips an exchange rate at the scale of its column', async () => {
    const documentId = await register(creator, {
      currencyCode: 'EUR',
      documentDate: '2026-07-02',
      invoice: {
        fxRate: '24.5',
        lines: [
          {
            baseAmount: '10.0000',
            category: 'services',
            description: 'placeholder fx line',
            vatMode: 'exempt',
          },
        ],
      },
      kind: 'issued_invoice',
      legalEntityId: ownedEntityId,
      partnerId,
      reference: 'PLACEHOLDER-FX',
      title: 'Placeholder fx',
    });
    const detail = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId,
    });

    // numeric(18,6) always answers with six decimal places, which the response contract accepts as written.
    expect(detail?.invoice?.fxRate).toBe('24.500000');
  });

  it('re-derives the event when the document date moves', async () => {
    const documentId = await register(creator, {
      documentDate: '2026-07-03',
      invoice: {
        lines: [
          {
            baseAmount: '100.0000',
            category: 'services',
            description: 'placeholder dated line',
            vatAmount: '21.0000',
            vatMode: 'standard',
            vatRate: '21.00',
          },
        ],
      },
      kind: 'issued_invoice',
      legalEntityId: ownedEntityId,
      partnerId,
      reference: 'PLACEHOLDER-DATED',
      title: 'Placeholder dated',
    });
    const moved = await updateDocument(apiPool, {
      ...creator,
      ...allEntities,
      body: { documentDate: '2026-08-04' },
      documentId,
    });

    // The event date is the document date, so moving the document moves the event with it.
    expect(moved?.document.documentDate).toBe('2026-08-04');
    expect(moved?.event?.eventDate).toBe('2026-08-04');
    expect(moved?.event?.isBalanced).toBe(true);
  });

  it('refuses a validity range the stored dates would invert', async () => {
    const documentId = await register(creator, {
      documentDate: '2026-07-04',
      kind: 'contract',
      legalEntityId: ownedEntityId,
      title: 'Placeholder validity',
      validFrom: '2026-07-01',
      validTo: '2026-07-31',
    });

    await expect(
      updateDocument(apiPool, {
        ...creator,
        ...allEntities,
        body: { validTo: '2026-06-30' },
        documentId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const widened = await updateDocument(apiPool, {
      ...creator,
      ...allEntities,
      body: { validTo: '2026-09-30' },
      documentId,
    });

    expect(widened?.document.validTo).toBe('2026-09-30');
  });

  it('hides a link whose other end is outside the reader scope', async () => {
    const link = await createDocumentLink(apiPool, {
      ...creator,
      ...allEntities,
      documentId: contractDocumentId,
      kind: 'relates',
      toDocumentId: issuedDocumentId,
    });
    const scoped = await readDocument(apiPool, {
      ...reader,
      documentId: contractDocumentId,
      legalEntityIds: [secondEntityId],
    });
    const whole = await readDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: contractDocumentId,
    });

    // The link names a document the restricted member may not see, so the link itself is not shown either.
    expect(scoped?.links).toEqual([]);
    expect(whole?.links.map((entry) => entry.id)).toEqual([link?.id]);

    // Either end may remove the link, and the scope is checked on the document in the path.
    const removed = await deleteDocumentLink(apiPool, {
      ...creator,
      ...allEntities,
      documentId: issuedDocumentId,
      linkId: link?.id ?? '',
    });

    expect(removed).toBe(true);
    expect(
      (
        await readDocument(apiPool, {
          ...creator,
          ...allEntities,
          documentId: contractDocumentId,
        })
      )?.links,
    ).toEqual([]);
  });

  it('masks an intercompany entity the reader may not see and keeps the partner', async () => {
    const intercompany = await createPartner(apiPool, {
      ...creator,
      ...allEntities,
      countryCode: null,
      legalEntityId: ownedEntityId,
      name: 'Placeholder Intercompany',
      registrationNumber: 'AB-999999',
      vatNumber: null,
    });
    const scoped = await listPartners(apiPool, {
      ...reader,
      legalEntityIds: [secondEntityId],
      q: 'intercompany',
    });
    const whole = await listPartners(apiPool, {
      ...creator,
      legalEntityIds: null,
      q: 'intercompany',
    });

    expect(scoped.map((entry) => entry.id)).toEqual([intercompany?.id]);
    expect(scoped[0]?.legalEntityId).toBeNull();
    expect(whole[0]?.legalEntityId).toBe(ownedEntityId);
  });

  it('keeps a hidden intercompany link out of a restricted patch answer and refuses to change it', async () => {
    const intercompany = await createPartner(apiPool, {
      ...creator,
      ...allEntities,
      countryCode: null,
      legalEntityId: ownedEntityId,
      name: 'Placeholder Hidden Link',
      registrationNumber: null,
      vatNumber: null,
    });
    const restricted = {
      ...deputy,
      legalEntityIds: [secondEntityId],
      partnerId: intercompany?.id ?? '',
    };
    const untouched = {
      countryCode: undefined,
      legalEntityId: undefined,
      registrationNumber: undefined,
      vatNumber: undefined,
    };
    // A patch that leaves the link alone succeeds, and the answer still masks the entity the caller may not see.
    const renamed = await updatePartner(apiPool, {
      ...restricted,
      ...untouched,
      name: 'Placeholder Renamed Link',
    });
    // Clearing or overwriting a link the caller cannot see answers exactly like a missing partner.
    const cleared = await updatePartner(apiPool, {
      ...restricted,
      ...untouched,
      legalEntityId: null,
      name: undefined,
    });
    const overwritten = await updatePartner(apiPool, {
      ...restricted,
      ...untouched,
      legalEntityId: secondEntityId,
      name: undefined,
    });
    const whole = await listPartners(apiPool, {
      ...creator,
      legalEntityIds: null,
      q: 'renamed link',
    });

    expect(renamed?.name).toBe('Placeholder Renamed Link');
    expect(renamed?.legalEntityId).toBeNull();
    expect(cleared).toBeNull();
    expect(overwritten).toBeNull();
    expect(whole.map((entry) => entry.legalEntityId)).toEqual([ownedEntityId]);
  });

  it('takes the derived event and the open issues with the document', async () => {
    const before = await asTenant(creator, async (transaction) => {
      const events = await transaction.query(
        'select 1 from app.economic_event where document_id = $1',
        [unattributedDocumentId],
      );
      const issues = await transaction.query(
        'select 1 from app.data_issue where document_id = $1',
        [unattributedDocumentId],
      );
      const lines = await transaction.query(
        'select 1 from app.invoice_line where document_id = $1',
        [unattributedDocumentId],
      );
      return {
        events: events.rowCount,
        issues: issues.rowCount,
        lines: lines.rowCount,
      };
    });

    expect(before).toEqual({ events: 1, issues: 1, lines: 1 });

    const removed = await deleteDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: unattributedDocumentId,
    });
    const missing = await deleteDocument(apiPool, {
      ...creator,
      ...allEntities,
      documentId: unattributedDocumentId,
    });
    const after = await asTenant(creator, async (transaction) => {
      const events = await transaction.query(
        'select 1 from app.economic_event where document_id = $1',
        [unattributedDocumentId],
      );
      const issues = await transaction.query(
        'select 1 from app.data_issue where document_id = $1',
        [unattributedDocumentId],
      );
      const lines = await transaction.query(
        'select 1 from app.invoice_line where document_id = $1',
        [unattributedDocumentId],
      );
      return {
        events: events.rowCount,
        issues: issues.rowCount,
        lines: lines.rowCount,
      };
    });

    expect(removed).toBe(true);
    expect(missing).toBe(false);
    expect(after).toEqual({ events: 0, issues: 0, lines: 0 });
    expect(
      await readDocument(apiPool, {
        ...creator,
        ...allEntities,
        documentId: unattributedDocumentId,
      }),
    ).toBeNull();
  });
});
