import { z } from 'zod';

import {
  callApplicationJson,
  entityScopeSchema,
  entityScopeWriteSchema,
  parsedSubjectId,
  prepareApplicationCall,
  readJsonBody,
  subjectIdSchema,
} from './core.ts';
import type { BffAuth } from './core.ts';

// Mirrors the member status contract in @bap/api, which apps/web must not import.
const memberStatusSchema = z
  .object({ status: z.enum(['active', 'inactive']) })
  .strict();

// The owner-only bulk read: one row per member with a stored scope, an omission meaning all.
export const memberEntityScopeListSchema = z
  .object({
    entityScopes: z.array(
      z
        .object({ entityScope: entityScopeSchema, userId: subjectIdSchema })
        .strict(),
    ),
  })
  .strict();

// One owner-only read for the whole member list, so a members page never fans out per member.
export async function getMemberEntityScopes(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'entity_scopes_unavailable',
      method: 'GET',
      operation: 'getMemberEntityScopes',
      path: 'entity-scopes',
      schema: memberEntityScopeListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getMemberEntityScope(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  userId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const subject = parsedSubjectId(userId);

  if ('failure' in subject) {
    return subject.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'entity_scope_unavailable',
      method: 'GET',
      operation: 'getMemberEntityScope',
      path: `members/${encodeURIComponent(subject.value)}/entity-scope`,
      schema: entityScopeSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function putMemberEntityScope(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  userId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const subject = parsedSubjectId(userId);

  if ('failure' in subject) {
    return subject.failure;
  }

  const body = await readJsonBody(request, entityScopeWriteSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'entity_scope_rejected',
      method: 'PUT',
      operation: 'putMemberEntityScope',
      path: `members/${encodeURIComponent(subject.value)}/entity-scope`,
      schema: entityScopeSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function putMemberStatus(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  userId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const subject = parsedSubjectId(userId);

  if ('failure' in subject) {
    return subject.failure;
  }

  const body = await readJsonBody(request, memberStatusSchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'member_status_rejected',
      method: 'PUT',
      operation: 'putMemberStatus',
      path: `members/${encodeURIComponent(subject.value)}/status`,
      schema: memberStatusSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
