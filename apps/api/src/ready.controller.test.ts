import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';
import { ReadyController } from './ready.controller.js';

describe('ReadyController', () => {
  it('reports exact migration compatibility', async () => {
    const memberships: MembershipResolver = {
      checkReadiness: vi.fn(async () => true),
      getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
      resolve: vi.fn(),
    };

    await expect(
      new ReadyController(
        memberships,
        new ServiceMetrics(memberships),
      ).getReadiness(),
    ).resolves.toEqual({ service: 'application-api', status: 'ready' });
  });

  it('fails closed when the database is not compatible', async () => {
    const memberships: MembershipResolver = {
      checkReadiness: vi.fn(async () => false),
      getPoolStatistics: vi.fn(() => ({ idle: 0, total: 0, waiting: 0 })),
      resolve: vi.fn(),
    };

    await expect(
      new ReadyController(
        memberships,
        new ServiceMetrics(memberships),
      ).getReadiness(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
