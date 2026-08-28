import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SubjectRateLimiter, type ResourceJwtVerifier } from '@bap/security';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';
import { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';
import { RESOURCE_JWT_VERIFIER } from './resource-jwt.guard.js';
import { SUBJECT_RATE_LIMITER } from './subject-rate-limit.guard.js';

describe('completed request metrics', () => {
  let application: NestExpressApplication;
  let metrics: ServiceMetrics;

  beforeAll(async () => {
    const memberships: MembershipResolver = {
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      resolve: async (subjectId, organizationId) => {
        if (organizationId === 'organization_error') {
          throw new Error('unavailable');
        }

        if (organizationId === 'organization_1' && subjectId === 'first') {
          return { emailVerified: true, role: 'member' };
        }

        return { emailVerified: false, role: null };
      },
    };
    const verifier: ResourceJwtVerifier = {
      verifyAuthorizationHeader: async (header) => {
        if (header === 'Bearer first') {
          return { issuedAt: 1, subject: 'first' };
        }
        if (header === 'Bearer second') {
          return { issuedAt: 1, subject: 'second' };
        }
        if (header === 'Bearer third') {
          return { issuedAt: 1, subject: 'third' };
        }
        throw new Error('invalid');
      },
      verifyToken: async () => {
        throw new Error('invalid');
      },
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MembershipResolver)
      .useValue(memberships)
      .overrideProvider(RESOURCE_JWT_VERIFIER)
      .useValue(verifier)
      .overrideProvider(SUBJECT_RATE_LIMITER)
      .useValue(
        new SubjectRateLimiter({
          limit: 1,
          maxEntries: 4,
          windowMs: 60_000,
        }),
      )
      .compile();

    application = module.createNestApplication<NestExpressApplication>();
    configureApplication(application);
    await application.init();
    metrics = application.get(ServiceMetrics);
  });

  afterAll(async () => {
    await application.close();
  });

  it('counts finished controller, guard, and unmatched responses once', async () => {
    const server = application.getHttpServer();

    const malformed = await request(server)
      .post('/v1/organizations/organization_1/access')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(malformed.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    await request(server)
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    await request(server)
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer first')
      .expect(200);
    await request(server)
      .get('/v1/organizations/organization_1/access')
      .set('Authorization', 'Bearer first')
      .expect(429);
    await request(server)
      .get('/v1/organizations/forged/access')
      .set('Authorization', 'Bearer second')
      .expect(403);
    await request(server)
      .get('/v1/organizations/organization_error/access')
      .set('Authorization', 'Bearer third')
      .expect(500);
    await request(server).get('/not-found').expect(404);

    const output = await metrics.registry.metrics();

    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="/v1/organizations/:organizationId/access",status_class="2xx"} 1',
    );
    expect(output).toContain(
      'bap_http_requests_total{method="GET",route="/v1/organizations/:organizationId/access",status_class="4xx"} 3',
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
});
