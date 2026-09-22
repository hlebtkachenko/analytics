import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  SubjectRateLimiter,
  type EntityScope,
  type ResourceJwtVerifier,
} from '@bap/security';
import { UnprocessableEntityException } from '@nestjs/common';
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
import { DETECTED_TYPES } from './contract.js';
import type {
  InboxSettings,
  PutInboxRoutingTargetRequest,
} from './contract.js';
import { InboxSettingsController } from './inbox-settings.controller.js';
import { InboxService } from './inbox.service.js';
import { routingTargetFor } from './routing-targets.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const FOREIGN_ENTITY_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const PLATFORM_QUOTA = 1_000_000;

const body: PutInboxRoutingTargetRequest = {
  auto: 'above_threshold',
  autoThreshold: 0.8,
  defaultAssigneeId: 'user_2',
  defaultLegalEntityId: ENTITY_ID,
  destination: 'documents',
  documentKind: 'contract',
  partnerPolicy: 'match_only',
  requiredFields: ['documentDate'],
};

const settings: InboxSettings = {
  blobQuotaBytes: null,
  platformQuotaBytes: PLATFORM_QUOTA,
  usedBytes: 17,
};

describe('application inbox settings routes', () => {
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

  function record<T>(name: string, answer: (input: T) => unknown) {
    return vi.fn(async (input: T) => {
      (calls[name] ??= []).push(input);
      return answer(input);
    });
  }

  const service = {
    deleteRoutingTarget: record(
      'deleteRoutingTarget',
      (input: { detectedType: string }) => input.detectedType === 'pdf',
    ),
    listRoutingTargets: record('listRoutingTargets', () =>
      DETECTED_TYPES.map((type) => routingTargetFor(type)),
    ),
    putRoutingTarget: record(
      'putRoutingTarget',
      (input: { body: PutInboxRoutingTargetRequest; detectedType: string }) =>
        input.body.defaultLegalEntityId === FOREIGN_ENTITY_ID
          ? null
          : routingTargetFor(input.detectedType, {
              [input.detectedType]: input.body,
            }),
    ),
    readSettings: record('readSettings', () => settings),
    updateSettings: record(
      'updateSettings',
      (input: { body: { blobQuotaBytes: number | null } }) => {
        const quota = input.body.blobQuotaBytes;
        if (quota !== null && quota > PLATFORM_QUOTA) {
          throw new UnprocessableEntityException();
        }
        return { ...settings, blobQuotaBytes: quota };
      },
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InboxSettingsController],
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
    for (const key of Object.keys(calls)) {
      delete calls[key];
    }
  });

  const as = (
    method: 'delete' | 'get' | 'patch' | 'put',
    path: string,
    organizationId = 'organization_1',
  ) =>
    request(application.getHttpServer())
      [method](`/v1/organizations/${organizationId}${path}`)
      .set('Authorization', 'Bearer caller');

  it('lists the effective target of every detected type for a manager', async () => {
    const response = await as('get', '/inbox/routing-targets').expect(200);

    expect(response.body.targets).toHaveLength(DETECTED_TYPES.length);
    expect(response.body.targets[0]).toMatchObject({
      detectedType: 'isdoc_invoice',
      documentKind: 'received_invoice',
      source: 'platform',
    });
    expect(calls.listRoutingTargets?.[0]).toEqual({
      organizationId: 'organization_1',
      role: 'owner',
      userId: 'user_1',
    });
    await as('get', '/inbox/routing-targets', 'organization_2').expect(200);
    await as('get', '/inbox/routing-targets', 'organization_3').expect(403);
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/inbox/routing-targets')
      .expect(401);
  });

  it('puts a whole target as the owner and answers the effective target', async () => {
    const response = await as('put', '/inbox/routing-targets/pdf')
      .send(body)
      .expect(200);

    expect(response.body).toEqual({
      ...body,
      detectedType: 'pdf',
      source: 'organization',
    });
    expect(calls.putRoutingTarget?.[0]).toMatchObject({
      body,
      detectedType: 'pdf',
      organizationId: 'organization_1',
      userId: 'user_1',
    });
  });

  it('refuses a partial target, a missing threshold and an unknown type with 400', async () => {
    const partial: Partial<PutInboxRoutingTargetRequest> = { ...body };
    delete partial.requiredFields;
    await as('put', '/inbox/routing-targets/pdf').send(partial).expect(400);
    await as('put', '/inbox/routing-targets/pdf')
      .send({ ...body, autoThreshold: null })
      .expect(400);
    await as('put', '/inbox/routing-targets/pdf')
      .send({ ...body, destination: 'datasets' })
      .expect(400);
    await as('put', '/inbox/routing-targets/payroll_sheet')
      .send(body)
      .expect(400);
    expect(calls.putRoutingTarget).toBeUndefined();
  });

  it('answers 404 for a legal entity the organization cannot see', async () => {
    await as('put', '/inbox/routing-targets/pdf')
      .send({ ...body, defaultLegalEntityId: FOREIGN_ENTITY_ID })
      .expect(404);
  });

  it('deletes an organization target and answers 404 when there is none', async () => {
    await as('delete', '/inbox/routing-targets/pdf').expect(204);
    expect(calls.deleteRoutingTarget?.[0]).toMatchObject({
      detectedType: 'pdf',
      organizationId: 'organization_1',
    });
    await as('delete', '/inbox/routing-targets/text').expect(404);
    await as('delete', '/inbox/routing-targets/payroll_sheet').expect(400);
  });

  it('reads the settings for a manager and patches them as the owner', async () => {
    const read = await as('get', '/inbox/settings').expect(200);
    expect(read.body).toEqual(settings);
    await as('get', '/inbox/settings', 'organization_2').expect(200);
    await as('get', '/inbox/settings', 'organization_3').expect(403);

    const patched = await as('patch', '/inbox/settings')
      .send({ blobQuotaBytes: 500 })
      .expect(200);
    expect(patched.body).toEqual({ ...settings, blobQuotaBytes: 500 });
    const reset = await as('patch', '/inbox/settings')
      .send({ blobQuotaBytes: null })
      .expect(200);
    expect(reset.body).toEqual(settings);
    expect(calls.updateSettings).toHaveLength(2);
  });

  it('answers 422 above the platform cap and 400 for a non-positive or missing quota', async () => {
    await as('patch', '/inbox/settings')
      .send({ blobQuotaBytes: PLATFORM_QUOTA + 1 })
      .expect(422);
    await as('patch', '/inbox/settings')
      .send({ blobQuotaBytes: 0 })
      .expect(400);
    await as('patch', '/inbox/settings').send({}).expect(400);
    await as('patch', '/inbox/settings')
      .send({ blobQuotaBytes: 1, extra: true })
      .expect(400);
  });

  it('needs manageOrganization for every write: an admin reads but never writes', async () => {
    await as('put', '/inbox/routing-targets/pdf', 'organization_2')
      .send(body)
      .expect(403);
    await as('delete', '/inbox/routing-targets/pdf', 'organization_2').expect(
      403,
    );
    await as('patch', '/inbox/settings', 'organization_2')
      .send({ blobQuotaBytes: 500 })
      .expect(403);
    await as('put', '/inbox/routing-targets/pdf', 'organization_9')
      .send(body)
      .expect(403);
    expect(calls.putRoutingTarget).toBeUndefined();
    expect(calls.deleteRoutingTarget).toBeUndefined();
    expect(calls.updateSettings).toBeUndefined();
  });

  it('publishes the settings routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/inbox/routing-targets',
      '/v1/organizations/{organizationId}/inbox/routing-targets/{detectedType}',
      '/v1/organizations/{organizationId}/inbox/settings',
    ]);

    const target = document.paths[
      '/v1/organizations/{organizationId}/inbox/routing-targets/{detectedType}'
    ]?.put?.responses['200'] as unknown as {
      content: Record<string, { schema: { required: string[] } }>;
    };
    expect(target.content['application/json']?.schema.required).toEqual([
      'auto',
      'autoThreshold',
      'defaultAssigneeId',
      'defaultLegalEntityId',
      'destination',
      'documentKind',
      'partnerPolicy',
      'requiredFields',
      'detectedType',
      'source',
    ]);
  });
});
