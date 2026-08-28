import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';
import { MembershipResolver } from './membership-resolver.js';

describe('reporting OpenAPI', () => {
  let application: NestExpressApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MembershipResolver)
      .useValue({
        checkReadiness: async () => true,
        getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
        resolve: async () => ({ emailVerified: false, role: null }),
      })
      .compile();

    application = module.createNestApplication<NestExpressApplication>();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('documents only the versioned reporting access route', async () => {
    const response = await request(application.getHttpServer())
      .get('/openapi.json')
      .expect(200);

    expect(response.body.paths).toHaveProperty(
      '/v1/organizations/{organizationId}/access',
    );
    expect(response.body.paths).not.toHaveProperty('/ready');
    expect(response.body.paths).not.toHaveProperty('/metrics');
    expect(response.body.components.securitySchemes).toHaveProperty(
      'resource-token',
    );
  });
});
