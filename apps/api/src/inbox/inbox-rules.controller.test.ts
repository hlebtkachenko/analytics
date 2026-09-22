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
import type { InboxRule, UpdateInboxRuleRequest } from './contract.js';
import { InboxRulesController } from './inbox-rules.controller.js';
import { InboxService } from './inbox.service.js';
import {
  type CreateRuleInput,
  type OrderRulesInput,
  type RuleSelector,
  type UpdateRuleInput,
} from './inbox-repository.js';
import { RuleLimitError } from './inbox-rule-repository.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const FOREIGN_ENTITY_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const CHANNEL_ID = '0d3f4c2a-6e1b-4f8a-9c5d-2b7e8a1f3c4d';
const RULE_ID = '1f2e3d4c-5b6a-4798-8c9d-0e1f2a3b4c5d';
const OTHER_RULE_ID = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

const rule: InboxRule = {
  autoRoute: false,
  channelId: null,
  createdAt: '2026-09-17T06:00:00.000Z',
  createdBy: 'user_1',
  detectedType: null,
  discardReason: null,
  enabled: true,
  id: RULE_ID,
  keyword: null,
  name: 'Supplier invoices',
  paused: false,
  priority: 1,
  senderPattern: '@dodavatel.cz',
  setAssigneeId: null,
  setDocumentKind: 'contract',
  setLegalEntityId: ENTITY_ID,
  setPartnerId: null,
  updatedAt: '2026-09-17T06:00:00.000Z',
};

const createBody = {
  name: 'Supplier invoices',
  senderPattern: '@Dodavatel.cz',
  setDocumentKind: 'contract',
  setLegalEntityId: ENTITY_ID,
};

describe('application inbox rules routes', () => {
  let application: NestExpressApplication;
  const entityScope: EntityScope = { mode: 'all' };
  const calls: Record<string, unknown[]> = {};
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
      if (header === 'Bearer channel') {
        return { issuedAt: 1_800_000_000, subject: `channel_${CHANNEL_ID}` };
      }
      throw new Error('invalid');
    }),
    verifyToken: vi.fn(),
  };
  // organization_1 is owned, organization_2 is administered, organization_3 is read by a member.
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
  let enabledRules = 0;

  function record<T>(name: string, answer: (input: T) => unknown) {
    return vi.fn(async (input: T) => {
      (calls[name] ??= []).push(input);
      return answer(input);
    });
  }

  const service = {
    adoptRule: record('adoptRule', (input: RuleSelector) =>
      input.ruleId === RULE_ID
        ? { ...rule, createdBy: input.userId, paused: false }
        : null,
    ),
    createRule: record('createRule', (input: CreateRuleInput) => {
      if (input.body.setLegalEntityId === FOREIGN_ENTITY_ID) {
        return null;
      }
      if (enabledRules >= 200) {
        throw new RuleLimitError();
      }
      const fields: Record<string, unknown> = { ...input.body };
      delete fields.applyToExisting;
      return { ...rule, ...fields, id: RULE_ID };
    }),
    deleteRule: record(
      'deleteRule',
      (input: RuleSelector) => input.ruleId === RULE_ID,
    ),
    listRules: record('listRules', () => [
      rule,
      {
        ...rule,
        createdBy: 'user_gone',
        id: OTHER_RULE_ID,
        paused: true,
        priority: 2,
      },
    ]),
    orderRules: record('orderRules', (input: OrderRulesInput) =>
      input.ruleIds.map((ruleId, index) => ({
        ...rule,
        id: ruleId,
        priority: index + 1,
      })),
    ),
    updateRule: record('updateRule', (input: UpdateRuleInput) =>
      input.ruleId === RULE_ID &&
      input.body.setLegalEntityId !== FOREIGN_ENTITY_ID
        ? { ...rule, ...input.body }
        : null,
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InboxRulesController],
      providers: [
        { provide: InboxService, useValue: service },
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
    enabledRules = 0;
    for (const key of Object.keys(calls)) {
      delete calls[key];
    }
  });

  const as = (
    method: 'delete' | 'get' | 'patch' | 'post' | 'put',
    path: string,
    organizationId = 'organization_1',
    token = 'caller',
  ) =>
    request(application.getHttpServer())
      [method](`/v1/organizations/${organizationId}${path}`)
      .set('Authorization', `Bearer ${token}`);

  it('lists the rules with the paused flag for a manager and refuses a member', async () => {
    const response = await as('get', '/inbox/rules').expect(200);

    expect(response.body.rules).toHaveLength(2);
    expect(response.body.rules[1]).toMatchObject({
      id: OTHER_RULE_ID,
      paused: true,
    });
    expect(calls.listRules?.[0]).toEqual({
      organizationId: 'organization_1',
      role: 'owner',
      userId: 'user_1',
    });
    await as('get', '/inbox/rules', 'organization_2').expect(200);
    await as('get', '/inbox/rules', 'organization_3').expect(403);
    await as('get', '/inbox/rules', 'organization_9').expect(403);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/inbox/rules')
      .expect(401);
  });

  it('refuses a channel subject on every route with 403', async () => {
    await as('get', '/inbox/rules', 'organization_1', 'channel').expect(403);
    await as('post', '/inbox/rules', 'organization_1', 'channel')
      .send(createBody)
      .expect(403);
    await as('patch', `/inbox/rules/${RULE_ID}`, 'organization_1', 'channel')
      .send({ enabled: false })
      .expect(403);
    await as(
      'delete',
      `/inbox/rules/${RULE_ID}`,
      'organization_1',
      'channel',
    ).expect(403);
    await as('put', '/inbox/rules/order', 'organization_1', 'channel')
      .send({ ruleIds: [RULE_ID] })
      .expect(403);
    await as(
      'post',
      `/inbox/rules/${RULE_ID}/adopt`,
      'organization_1',
      'channel',
    ).expect(403);
    expect(calls).toEqual({});
  });

  it('creates a rule with the normalised body and the caller entity scope', async () => {
    const response = await as('post', '/inbox/rules')
      .send(createBody)
      .expect(201);

    expect(response.body).toMatchObject({
      id: RULE_ID,
      senderPattern: '@dodavatel.cz',
      setDocumentKind: 'contract',
    });
    const input = calls.createRule?.[0] as CreateRuleInput;
    expect(input.legalEntityIds).toBeNull();
    expect(input.body).toEqual({
      applyToExisting: false,
      autoRoute: false,
      channelId: null,
      detectedType: null,
      discardReason: null,
      enabled: true,
      keyword: null,
      name: 'Supplier invoices',
      senderPattern: '@dodavatel.cz',
      setAssigneeId: null,
      setDocumentKind: 'contract',
      setLegalEntityId: ENTITY_ID,
      setPartnerId: null,
    });
  });

  it('refuses a rule without a condition, without an action, or a discard with another action', async () => {
    await as('post', '/inbox/rules')
      .send({ name: 'x', setDocumentKind: 'contract' })
      .expect(400);
    await as('post', '/inbox/rules')
      .send({ name: 'x', detectedType: 'pdf' })
      .expect(400);
    await as('post', '/inbox/rules')
      .send({
        name: 'x',
        detectedType: 'pdf',
        discardReason: 'spam',
        setDocumentKind: 'contract',
      })
      .expect(400);
    await as('post', '/inbox/rules')
      .send({ name: 'x', senderPattern: 'no-at-sign', discardReason: 'spam' })
      .expect(400);
    await as('post', '/inbox/rules')
      .send({ ...createBody, extra: true })
      .expect(400);
    expect(calls.createRule).toBeUndefined();
  });

  it('answers 422 past the enabled rule cap and for an invoice kind that auto-routes', async () => {
    enabledRules = 200;
    await as('post', '/inbox/rules').send(createBody).expect(422);
    enabledRules = 0;

    const invoice = await as('post', '/inbox/rules')
      .send({
        ...createBody,
        autoRoute: true,
        setDocumentKind: 'received_invoice',
      })
      .expect(422);
    expect(invoice.body).toMatchObject({ code: 'not_available', status: 422 });
    expect(calls.createRule).toHaveLength(1);

    const patched = await as('patch', `/inbox/rules/${RULE_ID}`)
      .send({ autoRoute: true, setDocumentKind: 'issued_invoice' })
      .expect(422);
    expect(patched.body).toMatchObject({ code: 'not_available', status: 422 });
    expect(calls.updateRule).toBeUndefined();
  });

  it('answers 404 for an entity the caller cannot see on create and patch', async () => {
    await as('post', '/inbox/rules')
      .send({ ...createBody, setLegalEntityId: FOREIGN_ENTITY_ID })
      .expect(404);
    await as('patch', `/inbox/rules/${RULE_ID}`)
      .send({ setLegalEntityId: FOREIGN_ENTITY_ID })
      .expect(404);
    await as('patch', `/inbox/rules/${OTHER_RULE_ID}`)
      .send({ enabled: false })
      .expect(404);
  });

  it('patches a rule, never its author, and refuses an empty patch', async () => {
    const body: UpdateInboxRuleRequest = { enabled: false, keyword: 'faktura' };
    const response = await as('patch', `/inbox/rules/${RULE_ID}`)
      .send(body)
      .expect(200);

    expect(response.body).toMatchObject({ enabled: false, keyword: 'faktura' });
    expect(calls.updateRule?.[0]).toMatchObject({
      body,
      ruleId: RULE_ID,
      userId: 'user_1',
    });
    await as('patch', `/inbox/rules/${RULE_ID}`).send({}).expect(400);
    await as('patch', `/inbox/rules/${RULE_ID}`)
      .send({ createdBy: 'user_2' })
      .expect(400);
  });

  it('soft deletes with 204 and answers 404 for an unknown rule', async () => {
    await as('delete', `/inbox/rules/${RULE_ID}`).expect(204);
    expect(calls.deleteRule?.[0]).toMatchObject({ ruleId: RULE_ID });
    await as('delete', `/inbox/rules/${OTHER_RULE_ID}`).expect(404);
  });

  it('orders the rules from the full id list and refuses a repeated id', async () => {
    const response = await as('put', '/inbox/rules/order')
      .send({ ruleIds: [OTHER_RULE_ID, RULE_ID] })
      .expect(200);

    expect(
      response.body.rules.map((r: InboxRule) => [r.id, r.priority]),
    ).toEqual([
      [OTHER_RULE_ID, 1],
      [RULE_ID, 2],
    ]);
    await as('put', '/inbox/rules/order')
      .send({ ruleIds: [RULE_ID, RULE_ID] })
      .expect(400);
    await as('put', '/inbox/rules/order').send({ ruleIds: [] }).expect(400);
  });

  it('adopts a rule as the caller', async () => {
    const response = await as(
      'post',
      `/inbox/rules/${RULE_ID}/adopt`,
      'organization_2',
    ).expect(200);

    expect(response.body).toMatchObject({ createdBy: 'user_1', paused: false });
    expect(calls.adoptRule?.[0]).toEqual({
      legalEntityIds: null,
      organizationId: 'organization_2',
      role: 'admin',
      ruleId: RULE_ID,
      userId: 'user_1',
    });
    await as('post', `/inbox/rules/${OTHER_RULE_ID}/adopt`).expect(404);
  });

  it('publishes the rules routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/inbox/rules',
      '/v1/organizations/{organizationId}/inbox/rules/order',
      '/v1/organizations/{organizationId}/inbox/rules/{ruleId}',
      '/v1/organizations/{organizationId}/inbox/rules/{ruleId}/adopt',
    ]);

    const created = document.paths[
      '/v1/organizations/{organizationId}/inbox/rules'
    ]?.post?.responses['201'] as unknown as {
      content: Record<string, { schema: { required: string[] } }>;
    };
    expect(created.content['application/json']?.schema.required).toContain(
      'paused',
    );
  });
});
