import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { AppModule } from './app.module.js';
import { MembershipResolver } from './membership-resolver.js';

describe('GET /health', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MembershipResolver)
      .useValue({
        checkReadiness: async () => true,
        getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
        resolve: async () => ({ emailVerified: false, role: null }),
      })
      .compile();

    application = module.createNestApplication();
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('returns the reporting API operational status', async () => {
    await request(application.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ service: 'reporting-api', status: 'ok' });
  });
});
