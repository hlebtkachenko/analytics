import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  channelSubject,
  channelTenant,
  isChannelSubject,
  resolveChannelAccess,
} from './channel-access.js';
import type { AuthenticatedRequest } from './request-context.js';

const CHANNEL_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_CHANNEL_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';

function requestFor(subject: string | undefined): AuthenticatedRequest {
  const request: AuthenticatedRequest = {
    headers: {},
    method: 'POST',
    url: '/',
  };

  if (subject !== undefined) {
    request.resourcePrincipal = { issuedAt: 1, subject };
  }

  return request;
}

describe('resolveChannelAccess', () => {
  const enabledChannels = new Set([CHANNEL_ID]);
  const channels = {
    readChannelPrincipal: vi.fn(
      async (input: { channelId: string; organizationId: string }) =>
        input.organizationId === 'organization_1' &&
        enabledChannels.has(input.channelId),
    ),
  };

  it('accepts the channel token of the path channel and returns a distinct access value', async () => {
    const access = await resolveChannelAccess({
      channelId: CHANNEL_ID,
      channels,
      organizationId: 'organization_1',
      request: requestFor(channelSubject(CHANNEL_ID)),
    });

    expect(access).toEqual({
      channelId: CHANNEL_ID,
      organizationId: 'organization_1',
      subject: `channel_${CHANNEL_ID}`,
    });
    expect(channels.readChannelPrincipal).toHaveBeenCalledWith({
      channelId: CHANNEL_ID,
      organizationId: 'organization_1',
    });
    expect(channelTenant('organization_1', CHANNEL_ID)).toEqual({
      organizationId: 'organization_1',
      role: 'channel',
      userId: `channel_${CHANNEL_ID}`,
    });
  });

  it('answers 404 for another channel, a person, a malformed subject and a wrong organization', async () => {
    channels.readChannelPrincipal.mockClear();

    for (const subject of [
      channelSubject(OTHER_CHANNEL_ID),
      'user_1',
      `channel_${CHANNEL_ID.toUpperCase()}`,
      'channel_not-a-uuid',
    ]) {
      await expect(
        resolveChannelAccess({
          channelId: CHANNEL_ID,
          channels,
          organizationId: 'organization_1',
          request: requestFor(subject),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    // No subject mismatch reaches the database.
    expect(channels.readChannelPrincipal).not.toHaveBeenCalled();

    await expect(
      resolveChannelAccess({
        channelId: CHANNEL_ID,
        channels,
        organizationId: 'organization_2',
        request: requestFor(channelSubject(CHANNEL_ID)),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a disabled or deleted channel and 401 without a principal', async () => {
    enabledChannels.delete(CHANNEL_ID);

    await expect(
      resolveChannelAccess({
        channelId: CHANNEL_ID,
        channels,
        organizationId: 'organization_1',
        request: requestFor(channelSubject(CHANNEL_ID)),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      resolveChannelAccess({
        channelId: CHANNEL_ID,
        channels,
        organizationId: 'organization_1',
        request: requestFor(undefined),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recognises the channel namespace by its prefix', () => {
    expect(isChannelSubject(`channel_${CHANNEL_ID}`)).toBe(true);
    expect(isChannelSubject('channel_')).toBe(true);
    expect(isChannelSubject('user_channel_1')).toBe(false);
    expect(isChannelSubject('erased_1')).toBe(false);
  });
});
