// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readDatasets,
  readLegalEntities,
  readMemberEntityScopes,
  readOrganizationAccess,
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
              manageDocuments: true,
              manageHr: true,
              managePayroll: true,
              manageSensitiveHr: true,
              manageEntityAccess: true,
              manageMembers: true,
              manageOrganization: true,
              readDocuments: true,
              readHr: true,
              readPayroll: true,
              readSensitiveHr: true,
              updateEntities: true,
              uploadData: true,
              useAi: true,
              approvePayroll: true,
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

    expect(access?.role).toBe('owner');
    expect(access?.entityScope).toEqual({ mode: 'all' });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://api:3001/v1/organizations/organization-1/access',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer resource-token',
        }),
      }),
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

  it('reads the scope-wide dataset list in one request', async () => {
    const dataset = {
      createdAt: '2026-09-11T06:00:00.000Z',
      description: null,
      id: '2f1c9a44-3e21-4b88-9f0a-6c7d2e5b1a90',
      legalEntityId: LEGAL_ENTITY_ID,
      name: 'Placeholder ledger',
      rowCount: 12,
      status: 'ready',
      updatedAt: '2026-09-11T06:05:00.000Z',
    };
    const fetchMock = vi.fn(async () => Response.json({ datasets: [dataset] }));
    vi.stubGlobal('fetch', fetchMock);

    const datasets = await readDatasets('organization-1');

    expect(datasets).toEqual([dataset]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://api:3001/v1/organizations/organization-1/datasets',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer resource-token',
        }),
      }),
    );
  });

  it('reports an unavailable dataset read as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'datasets_unavailable' }, { status: 403 }),
      ),
    );

    await expect(readDatasets('organization-1')).resolves.toBeNull();
  });

  it('reports an unavailable bulk scope read as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ detail: 'private' }, { status: 403 })),
    );

    await expect(readMemberEntityScopes('organization-1')).resolves.toBeNull();
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
