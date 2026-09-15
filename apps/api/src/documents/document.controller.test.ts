import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  SubjectRateLimiter,
  type EntityScope,
  type ResourceJwtVerifier,
} from '@bap/security';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
import type {
  DirectiveAccount,
  DocumentDetail,
  DocumentLink,
} from './contract.js';
import { DocumentController } from './document.controller.js';
import {
  DocumentRepository,
  type CreateDocumentInput,
  type ListDocumentsInput,
  type UpdateDocumentInput,
} from './document-repository.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_ENTITY_ID = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';
const DOCUMENT_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const OTHER_DOCUMENT_ID = '7d5e0f41-2c8a-4f6d-be54-912ca08d7f62';
const UNKNOWN_DOCUMENT_ID = '8e6f1052-3d9b-4a7e-8f65-a23db19e8073';
const DUPLICATE_DOCUMENT_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const PARTNER_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const INVOICE_LINE_ID = 'b1924385-60ce-4da1-b298-d560e4c1b3a6';
const EVENT_ID = 'c2035496-71df-4eb2-8349-e671f5d2c4b7';
const LINK_ID = 'd3146507-82e0-4fc3-9450-f782061e3d5c';
// The one title the repository answers with a check violation, so the mapping to 400 is observable.
const REFUSED_TITLE = 'Placeholder refused by the database';

// A neutral placeholder register entry: the API never invents business data.
const detail: DocumentDetail = {
  attributes: { placeholder_key: 'placeholder value' },
  document: {
    createdAt: '2026-09-14T06:00:00.000Z',
    currencyCode: 'CZK',
    documentDate: '2026-09-14',
    hasEvent: true,
    id: DOCUMENT_ID,
    isBalanced: true,
    isCurrent: true,
    kind: 'issued_invoice',
    legalEntityId: ENTITY_ID,
    openIssueCount: 0,
    partnerId: PARTNER_ID,
    partnerName: 'Placeholder Partner',
    reference: 'PLACEHOLDER-1',
    source: 'manual',
    status: 'registered',
    title: 'Placeholder document',
    totalAmount: '1210.0000',
    updatedAt: '2026-09-14T06:00:00.000Z',
    validFrom: null,
    validTo: null,
    version: 1,
  },
  event: {
    creditTotal: '1210.0000',
    debitTotal: '1210.0000',
    derivedAt: '2026-09-14T06:00:00.000Z',
    eventDate: '2026-09-14',
    id: EVENT_ID,
    isBalanced: true,
    lines: [
      {
        accountCode: '311',
        accountName: 'Trade receivables',
        activityCode: null,
        amount: '1210.0000',
        description: 'placeholder line',
        effectiveDate: '2026-09-14',
        invoiceLineId: INVOICE_LINE_ID,
        lineNo: 1,
        partnerId: PARTNER_ID,
        side: 'debit',
      },
    ],
    ruleSetVersion: 'cz-default-2026-09.1',
  },
  invoice: {
    advanceTotal: '0.0000',
    amountDue: '1210.0000',
    baseTotal: '1000.0000',
    dueDate: null,
    fxRate: null,
    grossTotal: '1210.0000',
    lines: [
      {
        activityCode: null,
        baseAmount: '1000.0000',
        category: 'services',
        description: 'placeholder line',
        id: INVOICE_LINE_ID,
        lineKind: 'item',
        lineNo: 1,
        periodEnd: null,
        periodStart: null,
        quantity: null,
        sourceAccountCode: null,
        taxPointDate: null,
        unit: null,
        unitPrice: null,
        vatAmount: '210.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
    ],
    receivedDate: null,
    roundingAmount: '0.0000',
    taxPointDate: null,
    variableSymbol: null,
    vatTotal: '210.0000',
  },
  issues: [],
  links: [],
};

const documentLink: DocumentLink = {
  createdAt: '2026-09-14T06:00:00.000Z',
  fromDocumentId: DOCUMENT_ID,
  id: LINK_ID,
  kind: 'relates',
  toDocumentId: OTHER_DOCUMENT_ID,
};

const directiveAccount: DirectiveAccount = {
  class: 3,
  code: '311',
  groupCode: '31',
  nameCs: 'Placeholder account',
  nameEn: 'Trade receivables',
  nature: 'ASSET',
};

function duplicateLinkError(): Error {
  return Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'document_link_unique',
  });
}

// What pg raises when a check constraint refuses a value the schema let through.
function checkViolationError(): Error {
  return Object.assign(new Error('check violation'), {
    code: '23514',
    constraint: 'invoice_line_vat_tolerance_check',
  });
}

// The minimal body an invoice kind accepts; the server computes every total from the lines.
const invoiceBody = {
  documentDate: '2026-09-14',
  invoice: {
    lines: [
      {
        baseAmount: '1000.0000',
        category: 'services',
        description: 'placeholder line',
        vatAmount: '210.0000',
        vatMode: 'standard',
        vatRate: '21.00',
      },
    ],
  },
  kind: 'issued_invoice',
  legalEntityId: ENTITY_ID,
  title: 'Placeholder document',
};

// The minimal advance deduction line: it carries amounts and a VAT mode, never a category.
const deductionLine = {
  baseAmount: '1000.0000',
  description: 'placeholder advance deduction',
  lineKind: 'advance_deduction',
  vatAmount: '210.0000',
  vatMode: 'standard',
  vatRate: '21.00',
};

describe('application document routes', () => {
  let application: NestExpressApplication;
  let entityScope: EntityScope = { mode: 'all' };
  const createCalls: CreateDocumentInput[] = [];
  const listCalls: ListDocumentsInput[] = [];
  const updateCalls: UpdateDocumentInput[] = [];
  const limiter = new SubjectRateLimiter({
    limit: 400,
    maxEntries: 8,
    windowMs: 60_000,
  });
  const verifier: ResourceJwtVerifier = {
    verifyAuthorizationHeader: vi.fn(async (header) => {
      if (header === 'Bearer caller') {
        return { issuedAt: 1_800_000_000, subject: 'user_1' };
      }
      throw new Error('invalid');
    }),
    verifyToken: vi.fn(),
  };
  // The organization selector chooses the caller role, so one token exercises the whole matrix.
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
    readEntityScope: vi.fn(async () => entityScope),
    resolve: vi.fn(async (_subject: string, organizationId: string) => {
      if (organizationId === 'organization_1') {
        return { emailVerified: true, role: 'owner' as const };
      }
      if (organizationId === 'organization_2') {
        return { emailVerified: true, role: 'admin' as const };
      }
      if (organizationId === 'organization_3') {
        return { emailVerified: true, role: 'member' as const };
      }
      return { emailVerified: false, role: null };
    }),
  };
  const documents: DocumentRepository = {
    createDocument: vi.fn(async (input) => {
      createCalls.push(input);

      if (input.body.title === REFUSED_TITLE) {
        throw checkViolationError();
      }

      return input.body.legalEntityId === OTHER_ENTITY_ID ? null : detail;
    }),
    createLink: vi.fn(async (input) => {
      if (input.toDocumentId === DUPLICATE_DOCUMENT_ID) {
        throw duplicateLinkError();
      }
      return input.toDocumentId === UNKNOWN_DOCUMENT_ID
        ? null
        : {
            ...documentLink,
            kind: input.kind,
            toDocumentId: input.toDocumentId,
          };
    }),
    deleteDocument: vi.fn(async (input) => input.documentId === DOCUMENT_ID),
    deleteLink: vi.fn(async (input) => input.linkId === LINK_ID),
    listDirectiveAccounts: vi.fn(async () => [directiveAccount]),
    listDocuments: vi.fn(async (input) => {
      listCalls.push(input);
      return {
        documents: [detail.document],
        page: input.query.page,
        pageSize: input.query.pageSize,
        total: 1,
        totalsByCurrency: [{ currencyCode: 'CZK', totalAmount: '1210.0000' }],
      };
    }),
    readDocument: vi.fn(async (input) =>
      input.documentId === DOCUMENT_ID ? detail : null,
    ),
    updateDocument: vi.fn(async (input) => {
      updateCalls.push(input);
      return input.documentId === DOCUMENT_ID ? detail : null;
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        { provide: DocumentRepository, useValue: documents },
        { provide: MembershipResolver, useValue: memberships },
        { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
        { provide: SUBJECT_RATE_LIMITER, useValue: limiter },
        ServiceMetrics,
        ResourceJwtGuard,
        SubjectRateLimitGuard,
      ],
    }).compile();

    application = module.createNestApplication<NestExpressApplication>();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(() => {
    entityScope = { mode: 'all' };
    createCalls.length = 0;
    listCalls.length = 0;
    updateCalls.length = 0;
  });

  it('lists documents with the defaults and passes the scope to the repository', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/documents')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual({
      documents: [detail.document],
      page: 1,
      pageSize: 25,
      total: 1,
      totalsByCurrency: [{ currencyCode: 'CZK', totalAmount: '1210.0000' }],
    });
    expect(listCalls[0]).toMatchObject({
      legalEntityIds: null,
      organizationId: 'organization_3',
      query: { order: 'desc', page: 1, pageSize: 25, sort: 'documentDate' },
      role: 'member',
      userId: 'user_1',
    });

    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/documents')
      .set('Authorization', 'Bearer caller')
      .expect(200);
    expect(listCalls[1]?.legalEntityIds).toEqual([ENTITY_ID]);
  });

  it('parses the whole filter set into the repository query', async () => {
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/documents')
      .query({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        kind: 'issued_invoice,received_invoice',
        legalEntityId: ENTITY_ID.toUpperCase(),
        order: 'asc',
        page: '2',
        pageSize: '50',
        partnerId: PARTNER_ID,
        q: '  placeholder  ',
        sort: 'totalAmount',
        status: 'registered',
      })
      .set('Authorization', 'Bearer caller')
      .expect(200);

    // Identifiers are lower-cased and the search term is trimmed at the boundary.
    expect(listCalls[0]?.query).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      kind: ['issued_invoice', 'received_invoice'],
      legalEntityId: ENTITY_ID,
      order: 'asc',
      page: 2,
      pageSize: 50,
      partnerId: PARTNER_ID,
      q: 'placeholder',
      sort: 'totalAmount',
      status: ['registered'],
    });
  });

  it('rejects a query outside the fixed contract', async () => {
    for (const query of [
      { pageSize: '101' },
      { pageSize: '0' },
      { pageSize: 'many' },
      { page: '0' },
      // The paging window is bounded, so a deep page is refused instead of scanned.
      { page: '401', pageSize: '25' },
      { kind: 'invoice' },
      { status: 'deleted' },
      { sort: 'notes' },
      { order: 'sideways' },
      { dateFrom: '14-09-2026' },
      { dateFrom: '2026-12-31', dateTo: '2026-01-01' },
      { legalEntityId: 'not-a-uuid' },
      { unknownFilter: 'x' },
    ]) {
      await request(application.getHttpServer())
        .get('/v1/organizations/organization_1/documents')
        .query(query)
        .set('Authorization', 'Bearer caller')
        .expect(400);
    }

    expect(listCalls).toEqual([]);
  });

  it('creates a document for an admin and refuses a member', async () => {
    const created = await request(application.getHttpServer())
      .post('/v1/organizations/organization_2/documents')
      .set('Authorization', 'Bearer caller')
      .send(invoiceBody)
      .expect(201);

    expect(created.body).toEqual(detail);
    expect(createCalls[0]).toMatchObject({
      legalEntityIds: null,
      organizationId: 'organization_2',
      role: 'admin',
    });
    // The currency defaults on the server, so a body that omits it is still explicit downstream.
    expect(createCalls[0]?.body.currencyCode).toBe('CZK');
    expect(createCalls[0]?.body.invoice?.lines[0]?.vatRate).toBe('21.00');

    await request(application.getHttpServer())
      .post('/v1/organizations/organization_3/documents')
      .set('Authorization', 'Bearer caller')
      .send(invoiceBody)
      .expect(403);
    expect(createCalls).toHaveLength(1);
  });

  it('binds invoice content to the two invoice kinds', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({ ...invoiceBody, invoice: undefined })
      .expect(400);
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({ ...invoiceBody, kind: 'contract' })
      .expect(400);

    const contract = await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({
        documentDate: '2026-09-14',
        kind: 'contract',
        legalEntityId: ENTITY_ID,
        title: 'Placeholder document',
      })
      .expect(201);

    expect(contract.body).toEqual(detail);
    expect(createCalls).toHaveLength(1);
  });

  it('rejects a create body outside the fixed contract', async () => {
    for (const body of [
      { ...invoiceBody, kind: 'invoice' },
      { ...invoiceBody, title: '   ' },
      { ...invoiceBody, documentDate: '2026-13-01' },
      { ...invoiceBody, currencyCode: 'CZKK' },
      { ...invoiceBody, totalAmount: '1210.00001' },
      { ...invoiceBody, validFrom: '2026-09-20', validTo: '2026-09-10' },
      { ...invoiceBody, attributes: { 'Bad Key': 'value' } },
      { ...invoiceBody, unknownField: 'x' },
      { ...invoiceBody, invoice: { lines: [] } },
      {
        ...invoiceBody,
        invoice: {
          lines: [
            {
              ...invoiceBody.invoice.lines[0],
              vatAmount: '210.0000',
              vatMode: 'reverse_charge',
            },
          ],
        },
      },
      // An amount is never negative: a refund is a credit note, not a negative line.
      {
        ...invoiceBody,
        invoice: {
          lines: [
            { ...invoiceBody.invoice.lines[0], baseAmount: '-1000.0000' },
          ],
        },
      },
      // A rate above one hundred per cent, and one with more than two decimal places.
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], vatRate: '150' }],
        },
      },
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], vatRate: '21.005' }],
        },
      },
      // A VAT amount the rate cannot explain, outside the half unit of tolerance.
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], vatAmount: '150.0000' }],
        },
      },
      // An exchange rate is greater than zero and carries at most six decimal places.
      {
        ...invoiceBody,
        invoice: { ...invoiceBody.invoice, fxRate: '0' },
      },
      {
        ...invoiceBody,
        invoice: { ...invoiceBody.invoice, fxRate: '-24.5' },
      },
      {
        ...invoiceBody,
        invoice: { ...invoiceBody.invoice, fxRate: '24.5000001' },
      },
      // An item line is categorised and an advance deduction line is not.
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], category: undefined }],
        },
      },
      {
        ...invoiceBody,
        invoice: {
          lines: [
            { ...invoiceBody.invoice.lines[0], lineKind: 'advance_deduction' },
          ],
        },
      },
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], lineKind: 'rounding' }],
        },
      },
      // A service period never ends before it starts.
      {
        ...invoiceBody,
        invoice: {
          lines: [
            {
              ...invoiceBody.invoice.lines[0],
              periodEnd: '2026-09-01',
              periodStart: '2026-09-30',
            },
          ],
        },
      },
      // An activity code is a bounded lower-case identifier, never free text.
      {
        ...invoiceBody,
        invoice: {
          lines: [{ ...invoiceBody.invoice.lines[0], activityCode: 'site a!' }],
        },
      },
      // A rounding difference stays below one unit in both directions.
      {
        ...invoiceBody,
        invoice: { ...invoiceBody.invoice, roundingAmount: '1.00' },
      },
      {
        ...invoiceBody,
        invoice: { ...invoiceBody.invoice, roundingAmount: '-1.00' },
      },
      // An invoice that only deducts an advance invoices no supply at all.
      { ...invoiceBody, invoice: { lines: [deductionLine] } },
      // The deducted advance never exceeds the supplied amount plus the rounding.
      {
        ...invoiceBody,
        invoice: {
          lines: [
            invoiceBody.invoice.lines[0],
            {
              ...deductionLine,
              baseAmount: '1300.0000',
              vatAmount: '0',
              vatMode: 'exempt',
            },
          ],
        },
      },
    ]) {
      await request(application.getHttpServer())
        .post('/v1/organizations/organization_1/documents')
        .set('Authorization', 'Bearer caller')
        .send(body)
        .expect(400);
    }

    expect(createCalls).toEqual([]);
  });

  it('accepts an advance deduction beside an item line and normalises the activity', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({
        ...invoiceBody,
        invoice: {
          lines: [
            {
              ...invoiceBody.invoice.lines[0],
              activityCode: '  SITE-A  ',
              periodEnd: '2026-09-30',
              periodStart: '2026-09-01',
              taxPointDate: '2026-09-30',
            },
            deductionLine,
          ],
          roundingAmount: '0.20',
        },
      })
      .expect(201);

    // The activity is trimmed and lower-cased at the boundary, so grouping never depends on how it was typed.
    expect(createCalls[0]?.body.invoice?.lines[0]).toMatchObject({
      activityCode: 'site-a',
      lineKind: 'item',
      periodEnd: '2026-09-30',
      periodStart: '2026-09-01',
      taxPointDate: '2026-09-30',
    });
    expect(createCalls[0]?.body.invoice?.lines[1]?.lineKind).toBe(
      'advance_deduction',
    );
    expect(createCalls[0]?.body.invoice?.lines[1]?.category).toBeUndefined();
    expect(createCalls[0]?.body.invoice?.roundingAmount).toBe('0.20');
  });

  it('answers a value the database refuses with a bad request, never a server error', async () => {
    const refused = await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({ ...invoiceBody, title: REFUSED_TITLE })
      .expect(400);

    expect(refused.body).toMatchObject({
      status: 400,
      title: 'Invalid request',
      type: 'https://bap.invalid/problems/invalid-request',
    });
  });

  it('narrows a list filtered by an entity outside the scope to nothing', async () => {
    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/documents')
      .query({ legalEntityId: OTHER_ENTITY_ID })
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(listCalls[0]?.legalEntityIds).toEqual([]);

    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/documents')
      .query({ legalEntityId: ENTITY_ID })
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(listCalls[1]?.legalEntityIds).toEqual([ENTITY_ID]);
  });

  it('hides a legal entity outside the scope behind a not found answer', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer caller')
      .send({ ...invoiceBody, legalEntityId: OTHER_ENTITY_ID })
      .expect(404);
    expect(createCalls).toHaveLength(1);
  });

  it('reads one document and answers not found outside the scope', async () => {
    const response = await request(application.getHttpServer())
      .get(`/v1/organizations/organization_3/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual(detail);

    await request(application.getHttpServer())
      .get(`/v1/organizations/organization_3/documents/${UNKNOWN_DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(404);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/documents/not-a-uuid')
      .set('Authorization', 'Bearer caller')
      .expect(400);
  });

  it('changes only the fields the patch names', async () => {
    const updated = await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ reference: null, status: 'verified' })
      .expect(200);

    expect(updated.body).toEqual(detail);
    expect(updateCalls[0]?.body).toEqual({
      reference: null,
      status: 'verified',
    });

    // An empty body changes nothing and is rejected instead of accepted silently.
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({})
      .expect(400);
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ status: 'deleted' })
      .expect(400);
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ validFrom: '2026-09-20', validTo: '2026-09-10' })
      .expect(400);
    await request(application.getHttpServer())
      .patch(
        `/v1/organizations/organization_2/documents/${UNKNOWN_DOCUMENT_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .send({ status: 'verified' })
      .expect(404);
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_3/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ status: 'verified' })
      .expect(403);
    expect(updateCalls).toHaveLength(2);
  });

  it('deletes a document only for a writing role', async () => {
    await request(application.getHttpServer())
      .delete(`/v1/organizations/organization_1/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(204);
    await request(application.getHttpServer())
      .delete(`/v1/organizations/organization_3/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(403);
    await request(application.getHttpServer())
      .delete(
        `/v1/organizations/organization_1/documents/${UNKNOWN_DOCUMENT_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .expect(404);
  });

  it('links two documents, refuses a duplicate and hides an invisible end', async () => {
    const created = await request(application.getHttpServer())
      .post(`/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links`)
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'settles', toDocumentId: OTHER_DOCUMENT_ID })
      .expect(201);

    expect(created.body).toEqual({
      ...documentLink,
      kind: 'settles',
      toDocumentId: OTHER_DOCUMENT_ID,
    });

    const conflict = await request(application.getHttpServer())
      .post(`/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links`)
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'settles', toDocumentId: DUPLICATE_DOCUMENT_ID })
      .expect(409);

    expect(conflict.body).toMatchObject({
      status: 409,
      title: 'Conflict',
      type: 'https://bap.invalid/problems/conflict',
    });

    await request(application.getHttpServer())
      .post(`/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links`)
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'settles', toDocumentId: UNKNOWN_DOCUMENT_ID })
      .expect(404);
    await request(application.getHttpServer())
      .post(`/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links`)
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'mentions', toDocumentId: OTHER_DOCUMENT_ID })
      .expect(400);
    await request(application.getHttpServer())
      .post(`/v1/organizations/organization_3/documents/${DOCUMENT_ID}/links`)
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'settles', toDocumentId: OTHER_DOCUMENT_ID })
      .expect(403);
  });

  it('removes a link the document owns', async () => {
    await request(application.getHttpServer())
      .delete(
        `/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links/${LINK_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .expect(204);
    await request(application.getHttpServer())
      .delete(
        `/v1/organizations/organization_1/documents/${DOCUMENT_ID}/links/${OTHER_DOCUMENT_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .expect(404);
  });

  it('publishes the shared directive chart to every reader', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/directive-accounts')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual({ directiveAccounts: [directiveAccount] });
  });

  it('refuses every route to a caller outside the organization', async () => {
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_9/documents')
      .set('Authorization', 'Bearer caller')
      .expect(403);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/documents')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });

  it('publishes only the versioned document routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/directive-accounts',
      '/v1/organizations/{organizationId}/documents',
      '/v1/organizations/{organizationId}/documents/{documentId}',
      '/v1/organizations/{organizationId}/documents/{documentId}/links',
      '/v1/organizations/{organizationId}/documents/{documentId}/links/{linkId}',
    ]);

    const list = document.paths['/v1/organizations/{organizationId}/documents']
      ?.get?.responses['200'] as unknown as {
      content: Record<string, { schema: { required: string[] } }>;
    };

    // The published list contract must carry the paging and the per-currency totals, or the BFF mirrors a lie.
    expect(list.content['application/json']?.schema.required).toEqual([
      'documents',
      'page',
      'pageSize',
      'total',
      'totalsByCurrency',
    ]);
  });
});
