import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SubjectRateLimiter, type ResourceJwtVerifier } from '@bap/security';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccessController } from './access.controller.js';
import { configureApplication } from './application.js';
import { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';
import {
  RESOURCE_JWT_VERIFIER,
  ResourceJwtGuard,
} from './resource-jwt.guard.js';
import {
  SUBJECT_RATE_LIMITER,
  SubjectRateLimitGuard,
} from './subject-rate-limit.guard.js';

describe('application access route', () => {
  let application: NestExpressApplication;
  let metrics: ServiceMetrics;
  const limiter = new SubjectRateLimiter({
    limit: 2,
    maxEntries: 4,
    windowMs: 60_000,
  });
  const verifier: ResourceJwtVerifier = {
    verifyAuthorizationHeader: vi.fn(async (header) => {
      if (header === 'Bearer first') {
        return { issuedAt: 1_800_000_000, subject: 'user_1' };
      }
      if (header === 'Bearer second') {
        return { issuedAt: 1_800_000_000, subject: 'user_2' };
      }
      if (header === 'Bearer third') {
        return { issuedAt: 1_800_000_000, subject: 'user_3' };
      }
      if (header === 'Bearer fourth') {
        return { issuedAt: 1_800_000_000, subject: 'user_4' };
      }
      throw new Error('invalid');
    }),
    verifyToken: vi.fn(),
  };
  const memberships: MembershipResolver = {
    checkReadiness: vi.fn(async () => true),
    resolve: vi.fn(async (_subject, organizationId) =>
      organizationId === 'organization_1'
        ? { emailVerified: true, role: 'member' as const }
        : { emailVerified: false, role: null },
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AccessController],
      providers: [
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
    metrics = application.get(ServiceMetrics);
  });

  afterAll(async () => {
    await application.close();
  });

  it('authenticates before allocating limiter state', async () => {
    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(limiter.size).toBe(0);
  });

  it('returns only the fixed access contract and enforces the threshold', async () => {
    const first = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer first')
      .expect(200);

    expect(first.body).toEqual({
      organizationId: 'organization_1',
      role: 'member',
      service: 'application-api',
    });
    expect(JSON.stringify(first.body)).not.toContain('token');

    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer first')
      .expect(200);
    const limited = await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer first')
      .expect(429);
    expect(limited.headers['retry-after']).toBeDefined();

    await request(application.getHttpServer())
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer second')
      .expect(200);
  });

  it('rejects invalid and non-member organization selectors', async () => {
    await request(application.getHttpServer())
      .get('/v1/organizations/%20/access')
      .set('Authorization', 'Bearer third')
      .expect(400);
    await request(application.getHttpServer())
      .get('/v1/organizations/forged/access')
      .set('Authorization', 'Bearer third')
      .expect(403);
  });

  it('returns canonical problem details without query input for unexpected errors', async () => {
    vi.mocked(memberships.resolve).mockRejectedValueOnce(
      new Error('private@example.invalid'),
    );

    const failed = await request(application.getHttpServer())
      .get('/v1/organizations/organization_error/access?email=private')
      .set('Authorization', 'Bearer fourth')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(500);

    expect(failed.body).toMatchObject({
      instance: '/v1/organizations/organization_error/access',
      status: 500,
      title: 'Service error',
    });
    expect(JSON.stringify(failed.body)).not.toContain('private');
  });

  it('counts completed controller, guard, and unmatched responses once', async () => {
    const malformed = await request(application.getHttpServer())
      .post('/v1/organizations/organization_1/access')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(malformed.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    await request(application.getHttpServer()).get('/not-found').expect(404);

    const output = await metrics.registry.metrics();

    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="/v1/organizations/:organizationId/access",status_class="2xx"} 3',
    );
    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="/v1/organizations/:organizationId/access",status_class="4xx"} 4',
    );
    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="/v1/organizations/:organizationId/access",status_class="5xx"} 1',
    );
    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="unmatched",status_class="4xx"} 1',
    );
    expect(output).toContain(
      'bap_http_requests_total{method="POST",route="unmatched",status_class="4xx"} 1',
    );
  });

  it('publishes only the versioned fixed route in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );

    expect(Object.keys(document.paths)).toEqual([
      '/v1/organizations/{organizationId}/access',
    ]);
  });
});
