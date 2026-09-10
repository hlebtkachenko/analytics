// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLegalEntity,
  readLegalEntities,
  readMemberEntityScope,
  readMemberEntityScopes,
  readOrganizationAccess,
  removeLegalEntity,
  updateLegalEntity,
  writeMemberEntityScope,
} from './entities';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requestHeaders: new Headers(),
  signJWT: vi.fn(),
}));

vi.mock('../auth/server', () => ({
  getAuth: async () => ({
    api: { getSession: mocks.getSession, signJWT: mocks.signJWT },
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => mocks.requestHeaders }));

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

const legalEntity = {
  createdAt: '2026-09-10T06:00:00.000Z',
  id: LEGAL_ENTITY_ID,
  kind: 'company',
  name: 'Placeholder Holding',
  registrationNumber: null,
  updatedAt: '2026-09-10T06:05:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('server-side legal entity reads and writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestHeaders = new Headers({ cookie: 'bap.session=opaque' });
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
    mocks.signJWT.mockResolvedValue({ token: 'resource-token' });
  });

  it('mints one resource token per call and never leaks the session cookie', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ legalEntities: [legalEntity] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const entities = await readLegalEntities('organization-1');

    expect(entities).toEqual([legalEntity]);
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(mocks.getSession.mock.calls[0]?.[0].headers.get('cookie')).toBe(
      'bap.session=opaque',
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://api:3001/v1/organizations/organization-1/legal-entities',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer resource-token',
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      'bap.session=opaque',
    );
  });

  it('reads the access contract and one member entity scope', async () => {
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/access')
        ? Response.json({
            capabilities: {
              createEntities: true,
              deleteEntities: true,
              manageEntityAccess: true,
              manageMembers: true,
              manageOrganization: true,
              updateEntities: true,
              uploadData: true,
              useAi: true,
            },
            entityScope: { mode: 'all' },
            organizationId: 'organization-1',
            role: 'owner',
            service: 'application-api',
          })
        : Response.json({
            legalEntityIds: [LEGAL_ENTITY_ID],
            mode: 'restricted',
          }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const access = await readOrganizationAccess('organization-1');
    const scope = await readMemberEntityScope('organization-1', 'user-2');

    expect(access?.role).toBe('owner');
    expect(access?.entityScope).toEqual({ mode: 'all' });
    expect(scope).toEqual({
      legalEntityIds: [LEGAL_ENTITY_ID],
      mode: 'restricted',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'http://api:3001/v1/organizations/organization-1/members/user-2/entity-scope',
    );
  });

  it('reads every stored member scope in one request', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        entityScopes: [
          {
            entityScope: {
              legalEntityIds: [LEGAL_ENTITY_ID],
              mode: 'restricted',
            },
            userId: 'user-2',
          },
          { entityScope: { mode: 'all' }, userId: 'user-3' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const scopes = await readMemberEntityScopes('organization-1');

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://api:3001/v1/organizations/organization-1/entity-scopes',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer resource-token',
        }),
      }),
    );
    expect(scopes?.get('user-2')).toEqual({
      legalEntityIds: [LEGAL_ENTITY_ID],
      mode: 'restricted',
    });
    expect(scopes?.get('user-3')).toEqual({ mode: 'all' });
    // A member without a stored row is simply absent, which the page reads as unrestricted.
    expect(scopes?.has('user-4')).toBe(false);
  });

  it('reports an unavailable bulk scope read as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ detail: 'private' }, { status: 403 })),
    );

    await expect(readMemberEntityScopes('organization-1')).resolves.toBeNull();
  });

  it('sends every write as JSON and reports a refusal as false', async () => {
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) =>
      init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json(legalEntity, {
            status: init.method === 'POST' ? 201 : 200,
          }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const created = await createLegalEntity('organization-1', {
      kind: 'company',
      name: 'Placeholder Holding',
    });
    const updated = await updateLegalEntity('organization-1', LEGAL_ENTITY_ID, {
      name: 'Renamed Holding',
    });
    const removed = await removeLegalEntity('organization-1', LEGAL_ENTITY_ID);

    expect([created, updated, removed]).toEqual([true, true, true]);
    expect(fetchMock.mock.calls.map((call) => call[1].method)).toEqual([
      'POST',
      'PATCH',
      'DELETE',
    ]);
    expect(fetchMock.mock.calls[0]?.[1].body).toBe(
      JSON.stringify({ kind: 'company', name: 'Placeholder Holding' }),
    );

    const cleared = await updateLegalEntity('organization-1', LEGAL_ENTITY_ID, {
      registrationNumber: null,
    });

    expect(cleared).toBe(true);
    expect(fetchMock.mock.calls[3]?.[1].body).toBe(
      JSON.stringify({ registrationNumber: null }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ detail: 'private' }, { status: 409 })),
    );

    await expect(
      writeMemberEntityScope('organization-1', 'user-2', { mode: 'all' }),
    ).resolves.toBe(false);
  });

  it('returns null when the session is unverified', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: false, id: 'user-1' },
    });

    await expect(readLegalEntities('organization-1')).resolves.toBeNull();
    await expect(readOrganizationAccess('organization-1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.signJWT).not.toHaveBeenCalled();
  });
});
