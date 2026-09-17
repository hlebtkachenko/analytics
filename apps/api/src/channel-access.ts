import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { TenantContext } from '@bap/db';

import type { AuthenticatedRequest } from './request-context.js';

// The channel principal of ADR 0016: 'channel_<uuid>' where the uuid is app.inbox_channel.id.
const CHANNEL_SUBJECT_PATTERN = /^channel_([0-9a-f-]{36})$/;

export function isChannelSubject(subject: string): boolean {
  return subject.startsWith('channel_');
}

export function channelSubject(channelId: string): string {
  return `channel_${channelId}`;
}

// The tenant context a channel runs under: no membership, no capability, its own row and the inbox tables only.
export function channelTenant(
  organizationId: string,
  channelId: string,
): TenantContext {
  return { organizationId, role: 'channel', userId: channelSubject(channelId) };
}

// Distinct from TenantAccess on purpose: no capability set and no entity scope can be derived from a channel.
export interface ChannelAccess {
  channelId: string;
  organizationId: string;
  subject: string;
}

export interface ChannelPrincipalReader {
  // Opens the tenant transaction as the channel and answers true only for its own enabled, undeleted row.
  readChannelPrincipal(input: {
    channelId: string;
    organizationId: string;
  }): Promise<boolean>;
}

export interface ResolveChannelAccessInput {
  channelId: string;
  channels: ChannelPrincipalReader;
  organizationId: string;
  request: AuthenticatedRequest;
}

// Anything that is not this exact channel, enabled, in this organization, is 404: the caller learns nothing else.
export async function resolveChannelAccess(
  input: ResolveChannelAccessInput,
): Promise<ChannelAccess> {
  const principal = input.request.resourcePrincipal;

  if (principal === undefined) {
    throw new UnauthorizedException();
  }

  const match = CHANNEL_SUBJECT_PATTERN.exec(principal.subject);

  if (match === null || match[1] !== input.channelId) {
    throw new NotFoundException();
  }

  const found = await input.channels.readChannelPrincipal({
    channelId: input.channelId,
    organizationId: input.organizationId,
  });

  if (!found) {
    throw new NotFoundException();
  }

  return {
    channelId: input.channelId,
    organizationId: input.organizationId,
    subject: principal.subject,
  };
}
