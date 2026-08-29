import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { MembershipResolver } from './membership-resolver.js';
import { ReadyController } from './ready.controller.js';

describe('ReadyController', () => {
  it('reports exact migration compatibility', async () => {
    const memberships: MembershipResolver = {
      checkReadiness: vi.fn(async () => true),
      resolve: vi.fn(),
    };

    await expect(
      new ReadyController(memberships).getReadiness(),
    ).resolves.toEqual({ service: 'application-api', status: 'ready' });
  });

  it('fails closed when the database is not compatible', async () => {
    const memberships: MembershipResolver = {
      checkReadiness: vi.fn(async () => false),
      resolve: vi.fn(),
    };

    await expect(
      new ReadyController(memberships).getReadiness(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
