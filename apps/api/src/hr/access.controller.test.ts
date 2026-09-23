import { ForbiddenException } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SubjectRateLimiter, type ResourceJwtVerifier } from '@bap/security';
import requestHttp from 'supertest';
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
import { HrAccessController } from './access.controller.js';
import {
  HrAccessAssignmentConflictError,
  HrAccessAssignmentNotFoundError,
  HrAccessRepository,
} from './access-repository.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const assignment = {
  accessRole: 'payroll_specialist' as const,
  createdAt: new Date(0).toISOString(),
  id: assignmentId,
  legalEntityId: entityId,
  userId: 'user_2',
};
const request = {
  headers: {},
  method: 'GET',
  resourcePrincipal: { issuedAt: 1, subject: 'owner_1' },
  url: '/v1/organizations/org/hr/access-assignments',
} as never;

function memberships(role: 'owner' | 'admin'): MembershipResolver {
  return {
    checkReadiness: async () => true,
    getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
    readEntityScope: async () => ({ mode: 'all' as const }),
    resolve: async () => ({ emailVerified: true, role }),
  } as MembershipResolver;
}

describe('HR access assignment controller', () => {
  it('allows only owners to list, create, and revoke assignments', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(assignment),
      list: vi.fn().mockResolvedValue([assignment]),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new HrAccessController(
      repository as never,
      memberships('owner'),
    );
    await expect(controller.list('org', request)).resolves.toEqual({
      assignments: [assignment],
    });
    await expect(
      controller.create(
        'org',
        {
          accessRole: 'payroll_specialist',
          legalEntityId: entityId,
          userId: 'user_2',
        },
        request,
      ),
    ).resolves.toEqual(assignment);
    await expect(
      controller.remove('org', assignmentId, request),
    ).resolves.toEqual({
      revoked: true,
    });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
    );
    const denied = new HrAccessController(
      repository as never,
      memberships('admin'),
    );
    for (const action of [
      () => denied.list('org', request),
      () =>
        denied.create(
          'org',
          { accessRole: 'hr_admin', legalEntityId: entityId, userId: 'user_2' },
          request,
        ),
      () => denied.remove('org', assignmentId, request),
    ])
      await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('HTTP failure contract', () => {
    let application: NestExpressApplication;
    let role: 'admin' | 'owner' = 'owner';
    const repository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
    };
    const membership: MembershipResolver = {
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      readEntityScope: async () => ({ mode: 'all' as const }),
      resolve: async () => ({ emailVerified: true, role }),
    } as MembershipResolver;
    const verifier: ResourceJwtVerifier = {
      verifyAuthorizationHeader: async (header) => {
        if (header === 'Bearer caller') {
          return { issuedAt: 1_800_000_000, subject: 'owner_1' };
        }
        throw new Error('invalid');
      },
      verifyToken: vi.fn(),
    };

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        controllers: [HrAccessController],
        providers: [
          { provide: HrAccessRepository, useValue: repository },
          { provide: MembershipResolver, useValue: membership },
          { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
          {
            provide: SUBJECT_RATE_LIMITER,
            useValue: new SubjectRateLimiter({
              limit: 100,
              maxEntries: 10,
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
    });

    afterAll(async () => application.close());

    it('maps malformed, forbidden, duplicate, and invisible assignment operations to their exact HTTP statuses', async () => {
      const path = '/v1/organizations/org/hr/access-assignments';
      role = 'owner';
      await requestHttp(application.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer caller')
        .send({
          accessRole: 'invalid',
          legalEntityId: entityId,
          userId: 'user_2',
        })
        .expect(400);
      role = 'admin';
      await requestHttp(application.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer caller')
        .send({
          accessRole: 'hr_admin',
          legalEntityId: entityId,
          userId: 'user_2',
        })
        .expect(403);
      role = 'owner';
      repository.create.mockRejectedValueOnce(
        new HrAccessAssignmentConflictError(),
      );
      await requestHttp(application.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer caller')
        .send({
          accessRole: 'hr_admin',
          legalEntityId: entityId,
          userId: 'user_2',
        })
        .expect(409);
      repository.create.mockRejectedValueOnce(
        new HrAccessAssignmentNotFoundError(),
      );
      await requestHttp(application.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer caller')
        .send({
          accessRole: 'hr_admin',
          legalEntityId: entityId,
          userId: 'user_2',
        })
        .expect(404);
      repository.remove.mockRejectedValueOnce(
        new HrAccessAssignmentNotFoundError(),
      );
      await requestHttp(application.getHttpServer())
        .delete(`${path}/${assignmentId}`)
        .set('Authorization', 'Bearer caller')
        .expect(404);
    });
  });

  it('publishes strict list, create, and revoke OpenAPI schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrAccessController],
      providers: [
        { provide: HrAccessRepository, useValue: {} },
        { provide: MembershipResolver, useValue: {} },
      ],
    })
      .overrideGuard(ResourceJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubjectRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const document = SwaggerModule.createDocument(
      module.createNestApplication(),
      new DocumentBuilder().build(),
    );
    const collection =
      document.paths['/organizations/{organizationId}/hr/access-assignments']!;
    const item =
      document.paths[
        '/organizations/{organizationId}/hr/access-assignments/{assignmentId}'
      ]!;
    expect(collection.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { additionalProperties: false, required: ['assignments'] },
        },
      },
    });
    expect(collection.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
            required: ['legalEntityId', 'userId', 'accessRole'],
          },
        },
      },
    });
    expect(collection.post?.responses['201']).toBeDefined();
    expect(collection.post?.responses['404']).toBeDefined();
    expect(collection.post?.responses['409']).toBeDefined();
    expect(item.delete?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { additionalProperties: false, required: ['revoked'] },
        },
      },
    });
    await module.close();
  });
});
