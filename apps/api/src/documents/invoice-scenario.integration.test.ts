import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
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
  SubjectRateLimiter,
  type EntityScope,
  type ResourceJwtVerifier,
} from '@bap/security';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { PoolClient } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { configureApplication } from '../application.js';
import { MembershipResolver } from '../membership-resolver.js';
import { ServiceMetrics } from '../metrics.js';
import {
  RESOURCE_JWT_VERIFIER,
  ResourceJwtGuard,
} from '../resource-jwt.guard.js';
import {
  SUBJECT_RATE_LIMITER,
  SubjectRateLimitGuard,
} from '../subject-rate-limit.guard.js';
import { endPools } from '../test-support/end-pools.js';
import { readDocumentAnalytics } from './analytics-repository.js';
import { DocumentController } from './document.controller.js';
import {
  createDocument,
  createDocumentLink,
  deleteDocument,
  deleteDocumentLink,
  listDirectiveAccounts,
  listDocuments,
  readDocument,
  updateDocument,
  DocumentRepository,
} from './document-repository.js';
import { createPartner } from './partner-repository.js';

const postgresImage =
  'pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const testPassword = 'test-only-database-credential';
const ORGANIZATION_ID = 'org-1';
// A legal entity the scenario never creates, so a member scoped to it may see nothing.
const OUT_OF_SCOPE_ENTITY_ID = '0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';

let apiPool: DatabasePool;
let container: StartedPostgreSqlContainer;
let migratorPool: DatabasePool;
let application: NestExpressApplication;
let entityId = '';
let partnerId = '';
let documentId = '';
let entityScope: EntityScope = { mode: 'all' };

// The owner of the one organization the scenario uses.
const creator: TenantContext = {
  organizationId: ORGANIZATION_ID,
  role: 'owner',
  userId: 'user-1',
};

// The five months the invoice covers, each with its own tax point, service period and activity.
const months = [
  { activityCode: 'site-a', end: '2026-01-31', start: '2026-01-01' },
  { activityCode: 'site-b', end: '2026-02-28', start: '2026-02-01' },
  { activityCode: 'site-c', end: '2026-03-31', start: '2026-03-01' },
  { activityCode: 'site-d', end: '2026-04-30', start: '2026-04-01' },
  { activityCode: 'site-e', end: '2026-05-31', start: '2026-05-01' },
];

// The four kinds of work the supplier invoices every month, two standard and two under reverse charge.
const monthlyWork = [
  {
    baseAmount: '60000.00',
    category: 'material',
    description: 'placeholder material line',
    vatAmount: '12600.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '50000.00',
    category: 'labour',
    description: 'placeholder labour line',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
  {
    baseAmount: '40000.00',
    category: 'transport',
    description: 'placeholder transport line',
    vatAmount: '8400.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '28999.96',
    category: 'services',
    description: 'placeholder services line',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
];

const itemLines = months.flatMap((month) =>
  monthlyWork.map((work) => ({
    ...work,
    activityCode: month.activityCode,
    periodEnd: month.end,
    periodStart: month.start,
    taxPointDate: month.end,
  })),
);

// Half of the invoice was prepaid, and the paper itemises the deducted advance by VAT regime.
const deductionLines = [
  {
    baseAmount: '200000.00',
    description: 'placeholder standard advance deduction',
    lineKind: 'advance_deduction',
    vatAmount: '42000.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '258000.00',
    description: 'placeholder reverse charge advance deduction',
    lineKind: 'advance_deduction',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
];

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

// Pools for one role.
function poolFor(role: DatabaseRole): DatabasePool {
  return createDatabasePool(configurationFor(role));
}

async function asTenant<T>(
  operation: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await apiPool.connect();

  try {
    return await withTenantContext(client, creator, operation);
  } finally {
    client.release();
  }
}

// Every assertion is one group by against the stored rows, so nothing is recomputed in TypeScript.
async function rows<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[],
): Promise<T[]> {
  return asTenant(async (transaction) => {
    const result = await transaction.query<T>(sql, values);
    return result.rows;
  });
}

function postDocument(body: Record<string, unknown>): request.Test {
  return request(application.getHttpServer())
    .post(`/v1/organizations/${ORGANIZATION_ID}/documents`)
    .set('Authorization', 'Bearer caller')
    .send(body);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage)
    .withDatabase('bap')
    .withUsername('postgres')
    .withPassword(testPassword)
    .start();
  const rootPool = poolFor('postgres');
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

  migratorPool = poolFor('bap_migrator');
  await runMigrations(migratorPool);
  const migrator = await migratorPool.connect();

  try {
    await migrator.query('begin');
    await migrator.query('set local role bap_owner');
    await migrator.query(`
      insert into auth."user" (id, name, email, email_verified)
      values ('user-1', 'Creator', 'creator@example.test', true)
    `);
    await migrator.query(
      "insert into auth.organization (id, name, slug) values ('org-1', 'One', 'one')",
    );
    await migrator.query(`
      insert into auth.member (id, organization_id, user_id, role)
      values ('member-1', 'org-1', 'user-1', 'owner')
    `);
    await migrator.query('commit');
  } finally {
    migrator.release();
  }

  await rootPool.end();
  apiPool = poolFor('bap_api');
  entityId = await asTenant(async (transaction) => {
    const created = await transaction.query<{ id: string }>(
      `insert into app.legal_entity (organization_id, name, kind, created_by)
       values ($1, 'Placeholder Holding', 'company', $2)
       returning id`,
      [creator.organizationId, creator.userId],
    );
    return created.rows[0]?.id ?? '';
  });

  const partner = await createPartner(apiPool, {
    ...creator,
    countryCode: 'CZ',
    legalEntityId: null,
    legalEntityIds: null,
    name: 'Placeholder Supplier',
    registrationNumber: 'AB-123456',
    vatNumber: 'CZ12345678',
  });
  partnerId = partner?.id ?? '';

  const documents: DocumentRepository = {
    createDocument: async (input) => createDocument(apiPool, input),
    createLink: async (input) => createDocumentLink(apiPool, input),
    deleteDocument: async (input) => deleteDocument(apiPool, input),
    deleteLink: async (input) => deleteDocumentLink(apiPool, input),
    listDirectiveAccounts: async (input) =>
      listDirectiveAccounts(apiPool, input),
    listDocuments: async (input) => listDocuments(apiPool, input),
    readAnalytics: async (input) => readDocumentAnalytics(apiPool, input),
    readDocument: async (input) => readDocument(apiPool, input),
    updateDocument: async (input) => updateDocument(apiPool, input),
  };
  const verifier: ResourceJwtVerifier = {
    verifyAuthorizationHeader: vi.fn(async () => ({
      issuedAt: 1_800_000_000,
      subject: creator.userId,
    })),
    verifyToken: vi.fn(),
  };
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
    readEntityScope: vi.fn(async () => entityScope),
    resolve: vi.fn(async () => ({
      emailVerified: true,
      role: 'owner' as const,
    })),
  };
  const module = await Test.createTestingModule({
    controllers: [DocumentController],
    providers: [
      { provide: DocumentRepository, useValue: documents },
      { provide: MembershipResolver, useValue: memberships },
      { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
      {
        provide: SUBJECT_RATE_LIMITER,
        useValue: new SubjectRateLimiter({
          limit: 400,
          maxEntries: 8,
          windowMs: 60_000,
        }),
      },
      ServiceMetrics,
      ResourceJwtGuard,
      SubjectRateLimitGuard,
    ],
  }).compile();

  application = module.createNestApplication<NestExpressApplication>();
  configureApplication(application);
  await application.init();

  const created = await postDocument({
    documentDate: '2026-06-01',
    invoice: {
      dueDate: '2026-07-01',
      lines: [...itemLines, ...deductionLines],
      roundingAmount: '0.20',
      taxPointDate: '2026-05-31',
    },
    kind: 'received_invoice',
    legalEntityId: entityId,
    partnerId,
    reference: 'PLACEHOLDER-SCENARIO',
    title: 'Placeholder five month invoice',
  }).expect(201);

  documentId = created.body.document.id;
});

afterAll(async () => {
  await application.close();
  await endPools(apiPool, migratorPool);
  await container.stop();
});

describe('a five month invoice with mixed VAT, a deducted advance and rounding', () => {
  it('stores the printed totals and the generated amount due', async () => {
    expect(
      await rows(
        `select i.gross_total, i.advance_total, i.amount_due::text as amount_due, d.total_amount
           from app.invoice as i
           join app.document as d on d.id = i.document_id
          where i.document_id = $1`,
        [documentId],
      ),
    ).toEqual([
      {
        advance_total: '500000.0000',
        amount_due: '500000.0000',
        gross_total: '999999.8000',
        total_amount: '1000000.0000',
      },
    ]);
  });

  it('keeps the supply and the deducted advance apart by line kind and VAT regime', async () => {
    expect(
      await rows(
        `select line_kind, vat_mode, sum(base_amount)::text as base, sum(vat_amount)::text as vat
           from app.invoice_line
          where document_id = $1
          group by line_kind, vat_mode
          order by line_kind, vat_mode`,
        [documentId],
      ),
    ).toEqual([
      {
        base: '258000.0000',
        line_kind: 'advance_deduction',
        vat: '0.0000',
        vat_mode: 'reverse_charge',
      },
      {
        base: '200000.0000',
        line_kind: 'advance_deduction',
        vat: '42000.0000',
        vat_mode: 'standard',
      },
      {
        base: '394999.8000',
        line_kind: 'item',
        vat: '0.0000',
        vat_mode: 'reverse_charge',
      },
      {
        base: '500000.0000',
        line_kind: 'item',
        vat: '105000.0000',
        vat_mode: 'standard',
      },
    ]);
  });

  it('books the payable of every month under that month, not under the document date', async () => {
    expect(
      await rows(
        `select to_char(date_trunc('month', l.effective_date), 'YYYY-MM') as month,
                sum(l.amount)::text as amount
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
           join app.invoice_line as il on il.id = l.invoice_line_id
          where e.document_id = $1
            and il.line_kind = 'item'
            and l.account_code = '321'
            and l.side = 'credit'
          group by 1
          order by 1`,
        [documentId],
      ),
    ).toEqual([
      { amount: '199999.9600', month: '2026-01' },
      { amount: '199999.9600', month: '2026-02' },
      { amount: '199999.9600', month: '2026-03' },
      { amount: '199999.9600', month: '2026-04' },
      { amount: '199999.9600', month: '2026-05' },
    ]);
  });

  it('groups the booked expense by the activity of its month', async () => {
    expect(
      await rows(
        `select l.activity_code, sum(l.amount)::text as amount
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
          where e.document_id = $1
            and l.activity_code is not null
            and l.side = 'debit'
            and l.account_code in ('501', '518')
          group by 1
          order by 1`,
        [documentId],
      ),
    ).toEqual([
      { activity_code: 'site-a', amount: '178999.9600' },
      { activity_code: 'site-b', amount: '178999.9600' },
      { activity_code: 'site-c', amount: '178999.9600' },
      { activity_code: 'site-d', amount: '178999.9600' },
      { activity_code: 'site-e', amount: '178999.9600' },
    ]);
  });

  it('books every account of the rule set exactly once per side', async () => {
    expect(
      await rows(
        `select l.account_code, l.side, sum(l.amount)::text as amount
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
          where e.document_id = $1
          group by 1, 2
          order by 1, 2`,
        [documentId],
      ),
    ).toEqual([
      { account_code: '314', amount: '458000.0000', side: 'credit' },
      { account_code: '321', amount: '1000000.0000', side: 'credit' },
      { account_code: '321', amount: '500000.0000', side: 'debit' },
      { account_code: '343', amount: '124949.9500', side: 'credit' },
      { account_code: '343', amount: '187949.9500', side: 'debit' },
      { account_code: '501', amount: '300000.0000', side: 'debit' },
      { account_code: '518', amount: '594999.8000', side: 'debit' },
      { account_code: '548', amount: '0.2000', side: 'debit' },
    ]);
  });

  it('balances the whole event and reports no data issue', async () => {
    expect(
      await rows(
        `select debit_total, credit_total, is_balanced, rule_set_version,
                event_date::text as event_date
           from app.economic_event
          where document_id = $1`,
        [documentId],
      ),
    ).toEqual([
      {
        credit_total: '1582949.9500',
        debit_total: '1582949.9500',
        event_date: '2026-06-01',
        is_balanced: true,
        rule_set_version: 'cz-default-2026-09.1',
      },
    ]);
    expect(
      await rows('select id from app.data_issue where document_id = $1', [
        documentId,
      ]),
    ).toEqual([]);
  });

  it('attaches the rounding to the invoice rather than to any line', async () => {
    expect(
      await rows(
        `select l.side, l.amount, l.invoice_line_id, l.activity_code,
                l.effective_date::text as effective_date
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
          where e.document_id = $1 and l.account_code = '548'`,
        [documentId],
      ),
    ).toEqual([
      {
        activity_code: null,
        amount: '0.2000',
        effective_date: '2026-05-31',
        invoice_line_id: null,
        side: 'debit',
      },
    ]);
  });

  it('answers the detail route with the stored totals, periods and dates', async () => {
    const response = await request(application.getHttpServer())
      .get(`/v1/organizations/${ORGANIZATION_ID}/documents/${documentId}`)
      .set('Authorization', 'Bearer caller')
      .expect(200);
    const detail = response.body;

    expect(detail.invoice).toMatchObject({
      advanceTotal: '500000.0000',
      amountDue: '500000.0000',
      grossTotal: '999999.8000',
      roundingAmount: '0.2000',
      taxPointDate: '2026-05-31',
    });
    expect(detail.document.totalAmount).toBe('1000000.0000');
    // The first line of the first month, with its own tax point, period and activity.
    expect(detail.invoice.lines[0]).toMatchObject({
      activityCode: 'site-a',
      category: 'material',
      lineKind: 'item',
      periodEnd: '2026-01-31',
      periodStart: '2026-01-01',
      taxPointDate: '2026-01-31',
    });
    expect(detail.invoice.lines[20]).toMatchObject({
      activityCode: null,
      category: null,
      lineKind: 'advance_deduction',
      periodEnd: null,
      periodStart: null,
      taxPointDate: null,
    });
    expect(detail.event.lines[0]).toMatchObject({
      accountCode: '501',
      activityCode: 'site-a',
      effectiveDate: '2026-01-31',
      side: 'debit',
    });
    expect(
      detail.event.lines.find(
        (line: { accountCode: string }) => line.accountCode === '548',
      ),
    ).toMatchObject({
      activityCode: null,
      effectiveDate: '2026-05-31',
      invoiceLineId: null,
    });
  });

  it('keeps the rounding and the monthly dates when the document date moves', async () => {
    await request(application.getHttpServer())
      .patch(`/v1/organizations/${ORGANIZATION_ID}/documents/${documentId}`)
      .set('Authorization', 'Bearer caller')
      .send({ documentDate: '2026-06-15' })
      .expect(200);

    // The register date moved with the document; the tax point of every leg did not.
    expect(
      await rows(
        `select event_date::text as event_date
           from app.economic_event
          where document_id = $1`,
        [documentId],
      ),
    ).toEqual([{ event_date: '2026-06-15' }]);
    expect(
      await rows(
        `select l.amount, l.effective_date::text as effective_date
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
          where e.document_id = $1 and l.account_code = '548' and l.side = 'debit'`,
        [documentId],
      ),
    ).toEqual([{ amount: '0.2000', effective_date: '2026-05-31' }]);
    expect(
      await rows(
        `select to_char(date_trunc('month', l.effective_date), 'YYYY-MM') as month,
                sum(l.amount)::text as amount
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
           join app.invoice_line as il on il.id = l.invoice_line_id
          where e.document_id = $1
            and il.line_kind = 'item'
            and l.account_code = '321'
            and l.side = 'credit'
          group by 1
          order by 1`,
        [documentId],
      ),
    ).toEqual([
      { amount: '199999.9600', month: '2026-01' },
      { amount: '199999.9600', month: '2026-02' },
      { amount: '199999.9600', month: '2026-03' },
      { amount: '199999.9600', month: '2026-04' },
      { amount: '199999.9600', month: '2026-05' },
    ]);
  });

  it('answers the analytics route from the stored rows and states its cost', async () => {
    const [stored] = await rows<{ count: number }>(
      `select count(*)::int as count
         from app.economic_event_line as l
         join app.economic_event as e on e.id = l.event_id
        where e.document_id = $1`,
      [documentId],
    );
    const response = await request(application.getHttpServer())
      .get(`/v1/organizations/${ORGANIZATION_ID}/documents/analytics`)
      .set('Authorization', 'Bearer caller')
      .expect(200);
    const analytics = response.body;

    expect(analytics.documents).toHaveLength(1);
    expect(analytics.documents[0]).toMatchObject({
      advanceTotal: '500000.0000',
      amountDue: '500000.0000',
      grossTotal: '999999.8000',
      kind: 'received_invoice',
      reference: 'PLACEHOLDER-SCENARIO',
      roundingAmount: '0.2000',
    });

    // The payable of every month sits under that month; the header tax point pulls the settlement into May.
    expect(
      analytics.byMonth
        .filter((row: { accountCode: string }) => row.accountCode === '321')
        .map(
          ({
            credit,
            debit,
            month,
          }: {
            credit: string;
            debit: string;
            month: string;
          }) => ({ credit, debit, month }),
        ),
    ).toEqual([
      { credit: '199999.9600', debit: '0.0000', month: '2026-01-01' },
      { credit: '199999.9600', debit: '0.0000', month: '2026-02-01' },
      { credit: '199999.9600', debit: '0.0000', month: '2026-03-01' },
      { credit: '199999.9600', debit: '0.0000', month: '2026-04-01' },
      // The deducted advance and the rounding both take the invoice tax point, so both land in May.
      { credit: '200000.1600', debit: '500000.0000', month: '2026-05-01' },
    ]);

    // Only the 501 and 518 legs count: the VAT and payable legs carry the activity but are not its cost.
    expect(analytics.byActivity).toEqual(
      ['site-a', 'site-b', 'site-c', 'site-d', 'site-e'].map(
        (activityCode) => ({
          activityCode,
          credit: '0.0000',
          debit: '178999.9600',
          lineCount: 4,
        }),
      ),
    );

    expect(analytics.byVatRegime).toEqual([
      {
        baseAmount: '258000.0000',
        lineCount: 1,
        lineKind: 'advance_deduction',
        vatAmount: '0.0000',
        vatMode: 'reverse_charge',
        vatRate: '21.00',
      },
      {
        baseAmount: '200000.0000',
        lineCount: 1,
        lineKind: 'advance_deduction',
        vatAmount: '42000.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
      {
        baseAmount: '394999.8000',
        lineCount: 10,
        lineKind: 'item',
        vatAmount: '0.0000',
        vatMode: 'reverse_charge',
        vatRate: '21.00',
      },
      {
        baseAmount: '500000.0000',
        lineCount: 10,
        lineKind: 'item',
        vatAmount: '105000.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
    ]);

    expect(
      analytics.byAccount.map(
        (row: { accountCode: string }) => row.accountCode,
      ),
    ).toEqual(['314', '321', '343', '501', '518', '548']);
    expect(
      analytics.byAccount.find(
        (row: { accountCode: string }) => row.accountCode === '548',
      ),
    ).toMatchObject({ credit: '0.0000', debit: '0.2000', nature: 'EXPENSE' });
    expect(
      analytics.byAccount.find(
        (row: { accountCode: string }) => row.accountCode === '314',
      ),
    ).toMatchObject({ credit: '458000.0000', debit: '0.0000' });

    expect(analytics.stats).toMatchObject({
      documentCount: 1,
      eventLineCount: stored?.count,
      invoiceLineCount: 22,
      queryCount: 6,
    });
    expect(analytics.stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('answers a member scoped to another entity with empty aggregates', async () => {
    entityScope = {
      legalEntityIds: [OUT_OF_SCOPE_ENTITY_ID],
      mode: 'restricted',
    };

    try {
      const response = await request(application.getHttpServer())
        .get(`/v1/organizations/${ORGANIZATION_ID}/documents/analytics`)
        .set('Authorization', 'Bearer caller')
        .expect(200);

      expect(response.body).toMatchObject({
        byAccount: [],
        byActivity: [],
        byMonth: [],
        byVatRegime: [],
        documents: [],
        stats: {
          documentCount: 0,
          eventLineCount: 0,
          invoiceLineCount: 0,
          queryCount: 6,
        },
      });
    } finally {
      entityScope = { mode: 'all' };
    }
  });

  it('books a supplier who rounded down as an other revenue', async () => {
    const created = await postDocument({
      documentDate: '2026-06-02',
      invoice: {
        lines: [
          {
            baseAmount: '100.30',
            category: 'material',
            description: 'placeholder rounded down line',
            vatMode: 'exempt',
          },
        ],
        roundingAmount: '-0.30',
      },
      kind: 'received_invoice',
      legalEntityId: entityId,
      partnerId,
      reference: 'PLACEHOLDER-ROUNDED-DOWN',
      title: 'Placeholder rounded down invoice',
    }).expect(201);

    expect(
      await rows(
        `select l.account_code, l.side, l.amount
           from app.economic_event_line as l
           join app.economic_event as e on e.id = l.event_id
          where e.document_id = $1 and l.account_code in ('321', '648')
          order by l.account_code, l.side`,
        [created.body.document.id],
      ),
    ).toEqual([
      { account_code: '321', amount: '100.3000', side: 'credit' },
      { account_code: '321', amount: '0.3000', side: 'debit' },
      { account_code: '648', amount: '0.3000', side: 'credit' },
    ]);
    expect(
      await rows(`select total_amount from app.document where id = $1`, [
        created.body.document.id,
      ]),
    ).toEqual([{ total_amount: '100.0000' }]);
  });
});
