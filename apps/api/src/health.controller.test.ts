import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { AppModule } from './app.module.js';

describe('GET /health', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = module.createNestApplication();
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('returns the application API operational status', async () => {
    await request(application.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ service: 'application-api', status: 'ok' });
  });
});
