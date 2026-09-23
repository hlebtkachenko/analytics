import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SubjectRateLimiter, type ResourceJwtVerifier } from '@bap/security';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceController } from './reference.controller.js';
import { ReferenceRepository } from './reference-repository.js';
import { MembershipResolver } from '../membership-resolver.js';
import { ServiceMetrics } from '../metrics.js';
import { configureApplication } from '../application.js';
import { ResourceJwtGuard } from '../resource-jwt.guard.js';
import { SubjectRateLimitGuard } from '../subject-rate-limit.guard.js';
import { RESOURCE_JWT_VERIFIER } from '../resource-jwt.guard.js';
import { SUBJECT_RATE_LIMITER } from '../subject-rate-limit.guard.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const position = {
  id,
  legalEntityId: entityId,
  code: 'P',
  name: 'Position',
  active: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
function controller(repository: Record<string, unknown>) {
  const value = new ReferenceController(repository as never, {} as never);
  const scope = vi
    .spyOn(
      value as unknown as { scope: (...args: unknown[]) => Promise<unknown> },
      'scope',
    )
    .mockImplementation(async (...args: unknown[]) => ({
      organizationId: 'org',
      userId: 'user',
      role: 'owner',
      legalEntityIds: null,
      capability: args[2],
    }));
  return { value, scope };
}

describe('reference controller', () => {
  it('uses exact plural envelopes and readHr/manageHr capabilities', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [position],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
      create: vi.fn().mockResolvedValue(position),
      update: vi.fn().mockResolvedValue({ ...position, active: false }),
    };
    const { value: api, scope } = controller(repository);
    await expect(
      api.positions('org', { page: 1, pageSize: 25 }, {} as never),
    ).resolves.toEqual({
      positions: [position],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    await api.createPosition(
      'org',
      { legalEntityId: entityId, code: 'P', name: 'Position' },
      {} as never,
    );
    await api.updatePosition('org', id, { active: false }, {} as never);
    expect(repository.list.mock.calls[0]?.[0]).toMatchObject({
      kind: 'position',
    });
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'readHr',
      'manageHr',
      'manageHr',
    ]);
  });
  it('maps invisible resources to 404 and duplicate constraints to 409', async () => {
    const { value: api } = controller({
      list: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    });
    await expect(
      api.positions('org', { page: 1, pageSize: 25 }, {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      api.createDepartment(
        'org',
        {
          legalEntityId: entityId,
          code: 'D',
          name: 'Department',
          parentId: null,
        },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      api.updatePosition('org', id, { active: false }, {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    const { value: duplicate } = controller({
      create: vi.fn().mockRejectedValue({
        code: '23505',
        constraint: 'hr_position_entity_code_key',
      }),
    });
    await expect(
      duplicate.createPosition(
        'org',
        { legalEntityId: entityId, code: 'P', name: 'Position' },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('publishes all fifteen exact reference routes with request and response schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [ReferenceController],
      providers: [
        { provide: ReferenceRepository, useValue: {} },
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
    const paths = Object.entries(document.paths).filter(([path]) =>
      path.includes('/hr/'),
    );
    expect(paths.map(([path]) => path).sort()).toEqual([
      '/organizations/{organizationId}/hr/cost-centres',
      '/organizations/{organizationId}/hr/cost-centres/{id}',
      '/organizations/{organizationId}/hr/departments',
      '/organizations/{organizationId}/hr/departments/{id}',
      '/organizations/{organizationId}/hr/document-categories',
      '/organizations/{organizationId}/hr/document-categories/{id}',
      '/organizations/{organizationId}/hr/positions',
      '/organizations/{organizationId}/hr/positions/{id}',
      '/organizations/{organizationId}/hr/workplaces',
      '/organizations/{organizationId}/hr/workplaces/{id}',
    ]);
    expect(
      paths.reduce(
        (count, [, methods]) => count + Object.keys(methods).length,
        0,
      ),
    ).toBe(15);
    const departments =
      document.paths['/organizations/{organizationId}/hr/departments']!;
    const departmentItem = departments.get!.responses['200'] as {
      content: Record<
        string,
        { schema: { properties: Record<string, unknown> } }
      >;
    };
    expect(
      departmentItem.content['application/json']!.schema.properties,
    ).toHaveProperty('departments');
    const departmentCreate = departments.post!.requestBody as {
      content: Record<
        string,
        { schema: { properties: Record<string, unknown> } }
      >;
    };
    expect(
      departmentCreate.content['application/json']!.schema.properties,
    ).toHaveProperty('parentId');
    const workplaceCreate = document.paths[
      '/organizations/{organizationId}/hr/workplaces'
    ]!.post!.requestBody as {
      content: Record<
        string,
        { schema: { properties: Record<string, unknown> } }
      >;
    };
    expect(
      workplaceCreate.content['application/json']!.schema.properties,
    ).toHaveProperty('addressLabel');
    const categoryCreate = document.paths[
      '/organizations/{organizationId}/hr/document-categories'
    ]!.post!.requestBody as {
      content: Record<string, { schema: { required: string[] } }>;
    };
    expect(categoryCreate.content['application/json']!.schema.required).toEqual(
      expect.arrayContaining([
        'confidentiality',
        'retentionKey',
        'requiresApproval',
      ]),
    );
    const categoryPatch = document.paths[
      '/organizations/{organizationId}/hr/document-categories/{id}'
    ]!.patch!.requestBody as {
      content: Record<
        string,
        { schema: { properties: Record<string, unknown> } }
      >;
    };
    expect(
      categoryPatch.content['application/json']!.schema.properties,
    ).not.toHaveProperty('code');
    expect(
      categoryPatch.content['application/json']!.schema.properties,
    ).not.toHaveProperty('legalEntityId');
    expect(
      categoryPatch.content['application/json']!.schema.properties,
    ).not.toHaveProperty('confidentiality');
    await module.close();
  });
  it('enforces capabilities and rejects malformed requests before the repository', async () => {
    const repository = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
      create: vi.fn().mockResolvedValue(position),
      update: vi.fn().mockResolvedValue(position),
    };
    const memberships: MembershipResolver = {
      checkReadiness: vi.fn(),
      getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
      readEntityScope: vi.fn(async () => ({ mode: 'all' as const })),
      resolve: vi.fn(async (_subject, organizationId) => ({
        emailVerified: true,
        role:
          organizationId === 'member'
            ? ('member' as const)
            : ('owner' as const),
      })),
    };
    const verifier: ResourceJwtVerifier = {
      verifyAuthorizationHeader: vi.fn(async () => ({
        issuedAt: 1,
        subject: 'user',
      })),
      verifyToken: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ReferenceController],
      providers: [
        { provide: ReferenceRepository, useValue: repository },
        { provide: MembershipResolver, useValue: memberships },
        { provide: RESOURCE_JWT_VERIFIER, useValue: verifier },
        {
          provide: SUBJECT_RATE_LIMITER,
          useValue: new SubjectRateLimiter({
            limit: 50,
            maxEntries: 5,
            windowMs: 60_000,
          }),
        },
        { provide: ServiceMetrics, useValue: { recordRequest: vi.fn() } },
        ResourceJwtGuard,
        SubjectRateLimitGuard,
      ],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    await app.init();
    await request(app.getHttpServer())
      .get('/v1/organizations/member/hr/positions')
      .set('Authorization', 'Bearer x')
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/organizations/member/hr/positions')
      .set('Authorization', 'Bearer x')
      .send({ legalEntityId: entityId, code: 'P', name: 'Position' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/v1/organizations/member/hr/positions/${id}`)
      .set('Authorization', 'Bearer x')
      .send({ active: false })
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/organizations/owner/hr/positions')
      .set('Authorization', 'Bearer x')
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/organizations/owner/hr/positions')
      .set('Authorization', 'Bearer x')
      .send({ legalEntityId: entityId, code: 'P', name: 'Position' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/v1/organizations/owner/hr/positions/${id}`)
      .set('Authorization', 'Bearer x')
      .send({ active: false })
      .expect(200);
    const calls = {
      list: repository.list.mock.calls.length,
      create: repository.create.mock.calls.length,
      update: repository.update.mock.calls.length,
    };
    await request(app.getHttpServer())
      .get('/v1/organizations/owner/hr/positions?active=no')
      .set('Authorization', 'Bearer x')
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/organizations/owner/hr/positions?unknown=true')
      .set('Authorization', 'Bearer x')
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/organizations/owner/hr/document-categories')
      .set('Authorization', 'Bearer x')
      .send({
        legalEntityId: entityId,
        code: 'C',
        name: 'Category',
        confidentiality: 'payroll',
        retentionKey: 'r',
        requiresApproval: false,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/organizations/owner/hr/positions')
      .set('Authorization', 'Bearer x')
      .send({
        legalEntityId: entityId,
        code: 'P',
        name: 'Position',
        unknown: true,
      })
      .expect(400);
    expect({
      list: repository.list.mock.calls.length,
      create: repository.create.mock.calls.length,
      update: repository.update.mock.calls.length,
    }).toEqual(calls);
    await app.close();
    await module.close();
  });
});
