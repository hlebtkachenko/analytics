import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  SubjectRateLimiter,
  type EntityScope,
  type LegalEntity,
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
import { EntityScopeController } from './entity-scope.controller.js';
import { LegalEntityController } from './legal-entity.controller.js';
import {
  LegalEntityRepository,
  type CreateLegalEntityInput,
  type UpdateLegalEntityInput,
  type WriteMemberEntityScopeInput,
} from './legal-entity-repository.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_ENTITY_ID = '5b3c8d2f-0a6e-4d4b-9c32-7f1a8e6b5d40';
const UNKNOWN_ENTITY_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';

// A neutral placeholder entity: the API never invents business data.
const entity: LegalEntity = {
  createdAt: '2026-09-10T06:00:00.000Z',
  id: ENTITY_ID,
  kind: 'company',
  name: 'Placeholder Holding',
  registrationNumber: 'AB-123456',
  updatedAt: '2026-09-10T06:00:00.000Z',
};

describe('application legal entity routes', () => {
  let application: NestExpressApplication;
  let entityScope: EntityScope = { mode: 'all' };
  const createCalls: CreateLegalEntityInput[] = [];
  const updateCalls: UpdateLegalEntityInput[] = [];
  const scopeCalls: WriteMemberEntityScopeInput[] = [];
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
    resolve: vi.fn(async (subject: string, organizationId: string) => {
      // Targets of the scope routes resolve by subject; the caller resolves by organization.
      if (subject === 'owner_2') {
        return { emailVerified: true, role: 'owner' as const };
      }
      if (subject === 'user_2') {
        return { emailVerified: true, role: 'member' as const };
      }
      if (subject === 'stranger') {
        return { emailVerified: false, role: null };
      }
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
  const entities: LegalEntityRepository = {
    createEntity: vi.fn(async (input) => {
      createCalls.push(input);
      return { ...entity, kind: input.kind as LegalEntity['kind'] };
    }),
    deleteEntity: vi.fn(async (input) => input.legalEntityId === ENTITY_ID),
    listEntities: vi.fn(async (input) =>
      input.legalEntityIds === null || input.legalEntityIds.includes(ENTITY_ID)
        ? [entity]
        : [],
    ),
    listMemberScopes: vi.fn(async () => [
      { entityScope: { mode: 'all' as const }, userId: 'user_2' },
      {
        entityScope: {
          legalEntityIds: [ENTITY_ID],
          mode: 'restricted' as const,
        },
        userId: 'user_3',
      },
    ]),
    readMemberScope: vi.fn(async () => ({
      legalEntityIds: [ENTITY_ID],
      mode: 'restricted' as const,
    })),
    updateEntity: vi.fn(async (input) => {
      updateCalls.push(input);
      return input.legalEntityId === ENTITY_ID
        ? { ...entity, name: input.name ?? entity.name }
        : null;
    }),
    writeMemberScope: vi.fn(async (input) => {
      scopeCalls.push(input);
      return input.scope.mode === 'restricted' &&
        input.scope.legalEntityIds.includes(UNKNOWN_ENTITY_ID)
        ? ('unknown-entity' as const)
        : ('written' as const);
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EntityScopeController, LegalEntityController],
      providers: [
        { provide: LegalEntityRepository, useValue: entities },
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
    updateCalls.length = 0;
    scopeCalls.length = 0;
  });

  it('lists the entities in the caller scope', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/legal-entities')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual({ legalEntities: [entity] });

    entityScope = { legalEntityIds: [OTHER_ENTITY_ID], mode: 'restricted' };
    const restricted = await request(application.getHttpServer())
      .get('/v1/organizations/organization_3/legal-entities')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(restricted.body).toEqual({ legalEntities: [] });
  });

  it('creates an entity for an admin and refuses a member', async () => {
    const created = await request(application.getHttpServer())
      .post('/v1/organizations/organization_2/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'sole_trader', name: '  Placeholder Trader  ' })
      .expect(201);

    expect(created.body).toMatchObject({ id: ENTITY_ID, kind: 'sole_trader' });
    // The name is trimmed at the boundary and the absent number becomes an explicit null.
    expect(createCalls).toEqual([
      {
        kind: 'sole_trader',
        name: 'Placeholder Trader',
        organizationId: 'organization_2',
        registrationNumber: null,
        role: 'admin',
        userId: 'user_1',
      },
    ]);

    await request(application.getHttpServer())
      .post('/v1/organizations/organization_3/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'company', name: 'Placeholder Holding' })
      .expect(403);
    expect(createCalls).toHaveLength(1);
  });

  it('rejects a body outside the fixed contract', async () => {
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'charity', name: 'Placeholder Holding' })
      .expect(400);
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'company', name: '   ' })
      .expect(400);
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({
        kind: 'company',
        name: 'Placeholder Holding',
        registrationNumber: 'not a number',
      })
      .expect(400);
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_1/legal-entities/${ENTITY_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({})
      .expect(400);

    expect(createCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it('changes only the fields the patch names', async () => {
    const updated = await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/legal-entities/${ENTITY_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ registrationNumber: null })
      .expect(200);

    expect(updated.body).toMatchObject({ id: ENTITY_ID });
    expect(updateCalls).toEqual([
      {
        kind: undefined,
        legalEntityId: ENTITY_ID,
        legalEntityIds: null,
        name: undefined,
        organizationId: 'organization_2',
        registrationNumber: null,
        role: 'admin',
        userId: 'user_1',
      },
    ]);

    // An absent field leaves the stored number alone, which the repository reads as undefined.
    await request(application.getHttpServer())
      .patch(`/v1/organizations/organization_2/legal-entities/${ENTITY_ID}`)
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(200);
    expect(updateCalls[1]?.registrationNumber).toBeUndefined();
    expect(updateCalls[1]?.name).toBe('Renamed Placeholder');
  });

  it('hides an entity outside the scope behind a not found answer', async () => {
    await request(application.getHttpServer())
      .patch(
        `/v1/organizations/organization_2/legal-entities/${OTHER_ENTITY_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(404);
    await request(application.getHttpServer())
      .patch('/v1/organizations/organization_2/legal-entities/not-a-uuid')
      .set('Authorization', 'Bearer caller')
      .send({ name: 'Renamed Placeholder' })
      .expect(400);
  });

  it('deletes an entity only for the owner', async () => {
    await request(application.getHttpServer())
      .delete(`/v1/organizations/organization_1/legal-entities/${ENTITY_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(204);
    await request(application.getHttpServer())
      .delete(`/v1/organizations/organization_2/legal-entities/${ENTITY_ID}`)
      .set('Authorization', 'Bearer caller')
      .expect(403);
    await request(application.getHttpServer())
      .delete(
        `/v1/organizations/organization_1/legal-entities/${OTHER_ENTITY_ID}`,
      )
      .set('Authorization', 'Bearer caller')
      .expect(404);
  });

  it('refuses entity creation to a restricted caller', async () => {
    entityScope = { legalEntityIds: [ENTITY_ID], mode: 'restricted' };

    // A restricted admin could not see the entity it created, so the capability is gone.
    await request(application.getHttpServer())
      .post('/v1/organizations/organization_2/legal-entities')
      .set('Authorization', 'Bearer caller')
      .send({ kind: 'company', name: 'Placeholder Holding' })
      .expect(403);
    expect(createCalls).toEqual([]);
  });

  it('reads every stored member scope in one call for the owner only', async () => {
    const response = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/entity-scopes')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(response.body).toEqual({
      entityScopes: [
        { entityScope: { mode: 'all' }, userId: 'user_2' },
        {
          entityScope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
          userId: 'user_3',
        },
      ],
    });
    expect(entities.listMemberScopes).toHaveBeenCalledWith({
      organizationId: 'organization_1',
      role: 'owner',
      userId: 'user_1',
    });

    // An admin holds no manageEntityAccess capability.
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_2/entity-scopes')
      .set('Authorization', 'Bearer caller')
      .expect(403);
  });

  it('reads and replaces a member entity scope for the owner only', async () => {
    const read = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .expect(200);

    expect(read.body).toEqual({
      legalEntityIds: [ENTITY_ID],
      mode: 'restricted',
    });

    const written = await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ legalEntityIds: [ENTITY_ID], mode: 'restricted' })
      .expect(200);

    expect(written.body).toEqual({
      legalEntityIds: [ENTITY_ID],
      mode: 'restricted',
    });
    expect(scopeCalls).toEqual([
      {
        organizationId: 'organization_1',
        role: 'owner',
        scope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
        targetUserId: 'user_2',
        userId: 'user_1',
      },
    ]);

    // An admin holds no manageEntityAccess capability.
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_2/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ mode: 'all' })
      .expect(403);
  });

  it('refuses an owner target, an unknown entity and an unknown member', async () => {
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/owner_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ mode: 'all' })
      .expect(409);
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ legalEntityIds: [UNKNOWN_ENTITY_ID], mode: 'restricted' })
      .expect(400);
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/stranger/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ mode: 'all' })
      .expect(404);
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ mode: 'everything' })
      .expect(400);
    await request(application.getHttpServer())
      .put('/v1/organizations/organization_1/members/user_2/entity-scope')
      .set('Authorization', 'Bearer caller')
      .send({ legalEntityIds: ['not-a-uuid'], mode: 'restricted' })
      .expect(400);
  });

  it('publishes only the versioned entity and scope routes in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/organizations/{organizationId}/entity-scopes',
      '/v1/organizations/{organizationId}/legal-entities',
      '/v1/organizations/{organizationId}/legal-entities/{legalEntityId}',
      '/v1/organizations/{organizationId}/members/{userId}/entity-scope',
    ]);
  });
});
