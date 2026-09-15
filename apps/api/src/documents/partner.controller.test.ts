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
import type { Partner } from './contract.js';
import { PartnerController } from './partner.controller.js';
import {
  PartnerRepository,
  type CreatePartnerInput,
  type ListPartnersInput,
  type UpdatePartnerInput,
} from './partner-repository.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_ENTITY_ID = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';
const PARTNER_ID = 'a0813274-5fbd-4c90-a187-c45fd3b0a295';
const UNKNOWN_PARTNER_ID = '8e6f1052-3d9b-4a7e-8f65-a23db19e8073';
const DUPLICATE_REGISTRATION_NUMBER = 'PLACEHOLDER-DUPLICATE';

// A neutral placeholder counterparty: the API never invents business data.
const partner: Partner = {
  countryCode: 'CZ',
  createdAt: '2026-09-14T06:00:00.000Z',
  id: PARTNER_ID,
  legalEntityId: null,
  name: 'Placeholder Partner',
  registrationNumber: 'AB-123456',
  updatedAt: '2026-09-14T06:00:00.000Z',
  vatNumber: 'CZ12345678',
};

function duplicateRegistrationError(): Error {
  return Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'partner_registration_number_key',
  });
}

describe('application partner routes', () => {
  let application: NestExpressApplication;
  let entityScope: EntityScope = { mode: 'all' };
  const createCalls: CreatePartnerInput[] = [];
  const listCalls: ListPartnersInput[] = [];
  const updateCalls: UpdatePartnerInput[] = [];
  const limiter = new SubjectRateLimiter({
    limit: 200,
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
  const partners: PartnerRepository = {
    createPartner: vi.fn(async (input) => {
      createCalls.push(input);

      if (input.registrationNumber === DUPLICATE_REGISTRATION_NUMBER) {
        throw duplicateRegistrationError();
      }

      return input.legalEntityId === OTHER_ENTITY_ID ? null : partner;
    }),
    listPartners: vi.fn(async (input) => {
      listCalls.push(input);
      return input.q === 'nothing' ? [] : [partner];
    }),
    updatePartner: vi.fn(async (input) => {
      updateCalls.push(input);

      if (input.registrationNumber === DUPLICATE_REGISTRATION_NUMBER) {
        throw duplicateRegistrationError();
      }

      return input.partnerId === PARTNER_ID ? partner : null;
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PartnerController],
      providers: [
        { provide: MembershipResolver, useValue: memberships },
        { provide: PartnerRepository, useValue: partners },
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

  it('lets every reader search the organization partners', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/partners')
      .query({ q: '  placeholder  ' })
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual({ partners: [partner] });
    // The search term is trimmed at the boundary and reaches the repository as data.
    expect(listCalls).toEqual([
      {
        legalEntityIds: null,
        organizationId: 'organization_3',
        q: 'placeholder',
        role: 'member',
        userId: 'user_1',
      },
    ]);

    // The scope reaches the repository, which is what masks an intercompany entity the caller may not see.
    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/partners')
      .set('Authorization', 'Bearer caller')
      .expect(200);
    expect(listCalls[1]?.legalEntityIds).toEqual([ENTITY_ID]);

    const empty = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/partners')
      .query({ q: 'nothing' })
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(empty.body).toEqual({ partners: [] });
  });

  it('rejects a partner query outside the fixed contract', async () => {
    for (const query of [{ q: '' }, { q: 'a'.repeat(101) }, { name: 'x' }]) {
      await request(application.getHttpServer())
        .get('/v1/organizations/organization_1/partners')
        .query(query)
        .set('Authorization', 'Bearer caller')
        .expect(400);
    }

    expect(listCalls).toEqual([]);
  });

  it('creates a partner for an admin and refuses a member', async () => {
    const created = await request(application.getHttpServer())
      .post('/v1/organizations/organization_2/partners')
      .set('Authorization', 'Bearer caller')
      .send({ countryCode: 'cz', name: '  Placeholder Partner  ' })
      .expect(201);

    expect(created.body).toEqual(partner);
    // The name is trimmed, the country is upper-cased and every absent field becomes an explicit null.
    expect(createCalls).toEqual([
      {
        countryCode: 'CZ',
        legalEntityId: null,
        legalEntityIds: null,
        name: 'Placeholder Partner',
        organizationId: 'organization_2',
        registrationNumber: null,
        role: 'admin',
        userId: 'user_1',
        vatNumber: null,
      },
    ]);

    await request(application.getHttpServer())
      .post('/v1/organizations/organization_3/partners')
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Placeholder Partner' })
      .expect(403);
    expect(createCalls).toHaveLength(1);
  });

  it('answers a duplicate registration number with a conflict', async () => {
    const conflict = await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/partners')
      .set('Authorization', 'Bearer caller')
      .send({
        name: 'Placeholder Partner',
        registrationNumber: DUPLICATE_REGISTRATION_NUMBER,
      })
      .expect(409);

    expect(conflict.body).toMatchObject({
      detail: 'The request conflicts with existing data',
      status: 409,
      title: 'Conflict',
      type: 'https://bap.invalid/problems/conflict',
    });

    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_1/partners/${PARTNER_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ registrationNumber: DUPLICATE_REGISTRATION_NUMBER })
      .expect(409);
  });

  it('rejects a partner body outside the fixed contract', async () => {
    for (const body of [
      { name: '   ' },
      { name: 'a'.repeat(201) },
      { name: 'Placeholder Partner', registrationNumber: 'not a number' },
      { name: 'Placeholder Partner', vatNumber: '12345678' },
      { name: 'Placeholder Partner', countryCode: 'CZE' },
      { name: 'Placeholder Partner', legalEntityId: 'not-a-uuid' },
      { name: 'Placeholder Partner', unknownField: 'x' },
      {},
    ]) {
      await request(application.getHttpServer())
        .post('/v1/organizations/organization_1/partners')
        .set('Authorization', 'Bearer caller')
        .send(body)
        .expect(400);
    }

    // An empty patch changes nothing and is rejected instead of accepted silently.
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_1/partners/${PARTNER_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({})
      .expect(400);

    expect(createCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it('hides an intercompany entity outside the scope behind a not found answer', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/partners')
      .set('Authorization', 'Bearer caller')
      .send({ legalEntityId: OTHER_ENTITY_ID, name: 'Placeholder Partner' })
      .expect(404);
    expect(createCalls).toHaveLength(1);

    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/partners')
      .set('Authorization', 'Bearer caller')
      .send({ legalEntityId: ENTITY_ID, name: 'Placeholder Partner' })
      .expect(201);
    expect(createCalls[1]?.legalEntityIds).toEqual([ENTITY_ID]);
  });

  it('changes only the fields the patch names', async () => {
    const updated = await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/partners/${PARTNER_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ vatNumber: null })
      .expect(200);

    expect(updated.body).toEqual(partner);
    expect(updateCalls).toEqual([
      {
        countryCode: undefined,
        legalEntityId: undefined,
        legalEntityIds: null,
        name: undefined,
        organizationId: 'organization_2',
        partnerId: PARTNER_ID,
        registrationNumber: undefined,
        role: 'admin',
        userId: 'user_1',
        vatNumber: null,
      },
    ]);

    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/partners/${UNKNOWN_PARTNER_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(404);
    await request(application.getHttpServer())
      .patch('/v1/organizations/organization_2/partners/not-a-uuid')
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(400);
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_3/partners/${PARTNER_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(403);
  });

  it('publishes only the versioned partner routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/partners',
      '/v1/organizations/{organizationId}/partners/{partnerId}',
    ]);

    const created = document.paths[
      '/v1/organizations/{organizationId}/partners'
    ]?.post?.responses['201'] as unknown as {
      content: Record<string, { schema: { required: string[] } }>;
    };

    // The published partner contract must carry every nullable field, or the BFF mirrors a lie.
    expect(created.content['application/json']?.schema.required).toEqual([
      'countryCode',
      'createdAt',
      'id',
      'legalEntityId',
      'name',
      'registrationNumber',
      'updatedAt',
      'vatNumber',
    ]);
  });
});
