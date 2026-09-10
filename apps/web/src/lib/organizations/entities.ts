import { headers } from 'next/headers';

import {
  accessResponseSchema,
  deleteLegalEntity,
  entityScopeSchema,
  getLegalEntities,
  getMemberEntityScope,
  getMemberEntityScopes,
  getOrganizationAccess,
  legalEntityListSchema,
  memberEntityScopeListSchema,
  patchLegalEntity,
  postLegalEntity,
  putMemberEntityScope,
} from '../auth/bff';
import type { EntityScope, LegalEntity, OrganizationAccess } from '../auth/bff';
import { getAuth } from '../auth/server';
import {
  accessPath,
  entityScopesPath,
  legalEntitiesPath,
  legalEntityPath,
  memberEntityScopePath,
} from '../datasets/client';

export type { EntityScope, LegalEntity, OrganizationAccess };

// A null registration number clears the stored one, which only an update may ask for.
export type LegalEntityInput = Readonly<{
  kind?: 'company' | 'sole_trader' | undefined;
  name?: string | undefined;
  registrationNumber?: string | null | undefined;
}>;

// Never dialled: the synthetic request only carries the caller's session to the BFF helpers.
const serverRequestOrigin = 'http://web.internal';

// The BFF helpers take one browser request, so a server render wraps its own session in one.
async function serverBffRequest(
  path: string,
  init: Readonly<{ body?: unknown; method?: string }> = {},
): Promise<Request> {
  const incoming = await headers();
  const outbound = new Headers();
  const cookie = incoming.get('cookie');
  const requestId = incoming.get('x-bap-request-id');

  if (cookie !== null) {
    outbound.set('cookie', cookie);
  }

  if (requestId !== null) {
    outbound.set('x-bap-request-id', requestId);
  }

  if (init.body !== undefined) {
    outbound.set('content-type', 'application/json');
  }

  return new Request(new URL(path, serverRequestOrigin), {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: outbound,
    method: init.method ?? 'GET',
  });
}

async function authApi() {
  return (await getAuth()).api;
}

export async function readOrganizationAccess(
  organizationId: string,
): Promise<OrganizationAccess | null> {
  const response = await getOrganizationAccess(
    await authApi(),
    await serverBffRequest(accessPath(organizationId)),
    'application',
    organizationId,
  );

  if (!response.ok) {
    return null;
  }

  const parsed = accessResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export async function readLegalEntities(
  organizationId: string,
): Promise<readonly LegalEntity[] | null> {
  const response = await getLegalEntities(
    await authApi(),
    await serverBffRequest(legalEntitiesPath(organizationId)),
    organizationId,
  );

  if (!response.ok) {
    return null;
  }

  const parsed = legalEntityListSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.legalEntities : null;
}

export async function readMemberEntityScope(
  organizationId: string,
  userId: string,
): Promise<EntityScope | null> {
  const response = await getMemberEntityScope(
    await authApi(),
    await serverBffRequest(memberEntityScopePath(organizationId, userId)),
    organizationId,
    userId,
  );

  if (!response.ok) {
    return null;
  }

  const parsed = entityScopeSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

// One read for the whole member list; a member without a stored row is unrestricted.
export async function readMemberEntityScopes(
  organizationId: string,
): Promise<ReadonlyMap<string, EntityScope> | null> {
  const response = await getMemberEntityScopes(
    await authApi(),
    await serverBffRequest(entityScopesPath(organizationId)),
    organizationId,
  );

  if (!response.ok) {
    return null;
  }

  const parsed = memberEntityScopeListSchema.safeParse(await response.json());

  return parsed.success
    ? new Map(
        parsed.data.entityScopes.map((row) => [row.userId, row.entityScope]),
      )
    : null;
}

export async function createLegalEntity(
  organizationId: string,
  body: LegalEntityInput,
): Promise<boolean> {
  const path = legalEntitiesPath(organizationId);
  const response = await postLegalEntity(
    await authApi(),
    await serverBffRequest(path, { body, method: 'POST' }),
    organizationId,
  );

  return response.ok;
}

export async function updateLegalEntity(
  organizationId: string,
  legalEntityId: string,
  body: LegalEntityInput,
): Promise<boolean> {
  const path = legalEntityPath(organizationId, legalEntityId);
  const response = await patchLegalEntity(
    await authApi(),
    await serverBffRequest(path, { body, method: 'PATCH' }),
    organizationId,
    legalEntityId,
  );

  return response.ok;
}

export async function removeLegalEntity(
  organizationId: string,
  legalEntityId: string,
): Promise<boolean> {
  const path = legalEntityPath(organizationId, legalEntityId);
  const response = await deleteLegalEntity(
    await authApi(),
    await serverBffRequest(path, { method: 'DELETE' }),
    organizationId,
    legalEntityId,
  );

  return response.ok;
}

export async function writeMemberEntityScope(
  organizationId: string,
  userId: string,
  scope: EntityScope,
): Promise<boolean> {
  const path = memberEntityScopePath(organizationId, userId);
  const response = await putMemberEntityScope(
    await authApi(),
    await serverBffRequest(path, { body: scope, method: 'PUT' }),
    organizationId,
    userId,
  );

  return response.ok;
}
