import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';
import { ReadyController } from './ready.controller.js';

describe('ReadyController', () => {
  it('fails closed when the database or migration is unavailable', async () => {
    const memberships = {
      checkReadiness: async () => false,
      getPoolStatistics: () => ({ idle: 0, total: 0, waiting: 0 }),
      resolve: async () => ({ emailVerified: false, role: null }),
    } as MembershipResolver;
    const controller = new ReadyController(
      memberships,
      new ServiceMetrics(memberships),
    );

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports ready only after a compatible database check', async () => {
    const memberships = {
      checkReadiness: async () => true,
      getPoolStatistics: () => ({ idle: 1, total: 2, waiting: 0 }),
      resolve: async () => ({ emailVerified: false, role: null }),
    } as MembershipResolver;
    const controller = new ReadyController(
      memberships,
      new ServiceMetrics(memberships),
    );

    await expect(controller.getReadiness()).resolves.toEqual({
      service: 'reporting-api',
      status: 'ready',
    });
  });
});
