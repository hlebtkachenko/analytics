import { headers } from 'next/headers';

import {
  accessResponseSchema,
  deleteLegalEntity,
  entityScopeSchema,
  getLegalEntities,
  getMemberEntityScope,
  getOrganizationAccess,
  legalEntityListSchema,
  patchLegalEntity,
  postLegalEntity,
  putMemberEntityScope,
} from '../auth/bff';
import type { EntityScope, LegalEntity, OrganizationAccess } from '../auth/bff';
import { getAuth } from '../auth/server';

export type { EntityScope, LegalEntity, OrganizationAccess };

export type LegalEntityInput = Readonly<{
  kind?: 'company' | 'sole_trader' | undefined;
  name?: string | undefined;
  registrationNumber?: string | undefined;
}>;

// Never dialled: the synthetic request only carries the caller's session to the BFF helpers.
const serverRequestOrigin = 'http://web.internal';

function bffPath(organizationId: string, suffix: string): string {
  return `/api/bff/application/organizations/${encodeURIComponent(organizationId)}/${suffix}`;
}

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
    await serverBffRequest(bffPath(organizationId, 'access')),
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
    await serverBffRequest(bffPath(organizationId, 'legal-entities')),
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
    await serverBffRequest(
      bffPath(
        organizationId,
        `members/${encodeURIComponent(userId)}/entity-scope`,
      ),
    ),
    organizationId,
    userId,
  );

  if (!response.ok) {
    return null;
  }

  const parsed = entityScopeSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export async function createLegalEntity(
  organizationId: string,
  body: LegalEntityInput,
): Promise<boolean> {
  const path = bffPath(organizationId, 'legal-entities');
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
  const path = bffPath(
    organizationId,
    `legal-entities/${encodeURIComponent(legalEntityId)}`,
  );
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
  const path = bffPath(
    organizationId,
    `legal-entities/${encodeURIComponent(legalEntityId)}`,
  );
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
  const path = bffPath(
    organizationId,
    `members/${encodeURIComponent(userId)}/entity-scope`,
  );
  const response = await putMemberEntityScope(
    await authApi(),
    await serverBffRequest(path, { body: scope, method: 'PUT' }),
    organizationId,
    userId,
  );

  return response.ok;
}
