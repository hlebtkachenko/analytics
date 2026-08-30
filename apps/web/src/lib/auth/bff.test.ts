import { describe, expect, it, vi } from 'vitest';

import { getOrganizationAccess, postDatasetUpload } from './bff.js';
import type { BffAuth } from './bff.js';

const getSession = vi
  .fn<BffAuth['getSession']>()
  .mockResolvedValue({ user: { emailVerified: true, id: 'user_1' } });
const signJWT = vi
  .fn<BffAuth['signJWT']>()
  .mockResolvedValue({ token: 'resource-token' });
const auth: BffAuth = { getSession, signJWT };

describe('getOrganizationAccess', () => {
  it('forwards an in-memory token only to the fixed application target', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/access',
      );
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      return Response.json({
        capabilities: {
          manageGrants: false,
          manageMembers: false,
          uploadData: true,
          useAi: true,
        },
        organizationId: 'org_1',
        role: 'member',
        service: 'application-api',
      });
    });

    const response = await getOrganizationAccess(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/access',
        {
          headers: {
            'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
          },
        },
      ),
      'application',
      'org_1',
      fetchImplementation,
    );

    const payload = await response.json();
    expect(payload).toEqual({
      capabilities: {
        manageGrants: false,
        manageMembers: false,
        uploadData: true,
        useAi: true,
      },
      organizationId: 'org_1',
      role: 'member',
      service: 'application-api',
    });
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('x-request-id')).toBe(
      '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(signJWT).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { payload: expect.objectContaining({ sub: 'user_1' }) },
      }),
    );
    expect(
      Object.keys(signJWT.mock.calls[0]?.[0].body.payload ?? {}).sort(),
    ).toEqual(['iat', 'sub']);
  });

  it('uses the fixed reporting target and rejects forged selectors before signing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        'http://reporting-api:3002/v1/organizations/org_1/access',
      );
      return Response.json({
        capabilities: {
          manageGrants: true,
          manageMembers: true,
          uploadData: true,
          useAi: true,
        },
        organizationId: 'org_1',
        role: 'owner',
        service: 'reporting-api',
      });
    });

    await getOrganizationAccess(
      auth,
      new Request(
        'https://bap.invalid/api/bff/reporting/organizations/org_1/access',
      ),
      'reporting',
      'org_1',
      fetchImplementation,
    );
    const denied = await getOrganizationAccess(
      auth,
      new Request(
        'https://bap.invalid/api/bff/reporting/organizations/forged/access',
      ),
      'reporting',
      '../forged',
      fetchImplementation,
    );

    expect(denied.status).toBe(403);
  });

  it('does not sign a resource token for an unverified session', async () => {
    const response = await getOrganizationAccess(
      {
        ...auth,
        getSession: async () => ({
          user: { emailVerified: false, id: 'user_1' },
        }),
      },
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/access',
      ),
      'application',
      'org_1',
      vi.fn(),
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ['network failure', async () => Promise.reject(new Error('unavailable'))],
    [
      'invalid service response',
      async () =>
        Response.json({
          capabilities: {
            manageGrants: false,
            manageMembers: false,
            uploadData: true,
            useAi: true,
          },
          organizationId: 'org_1',
          role: 'superuser',
          service: 'application-api',
        }),
    ],
    [
      'a response without capabilities',
      async () =>
        Response.json({
          organizationId: 'org_1',
          role: 'member',
          service: 'application-api',
        }),
    ],
    [
      'a response with an unknown capability',
      async () =>
        Response.json({
          capabilities: {
            exportEverything: true,
            manageGrants: false,
            manageMembers: false,
            uploadData: true,
            useAi: true,
          },
          organizationId: 'org_1',
          role: 'member',
          service: 'application-api',
        }),
    ],
  ])('returns a generic gateway error for %s', async (_name, upstream) => {
    const response = await getOrganizationAccess(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/access',
      ),
      'application',
      'org_1',
      upstream,
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('postDatasetUpload', () => {
  const multipart = (body: string | null = 'part') =>
    new Request(
      'https://bap.invalid/api/bff/application/organizations/org_1/uploads',
      {
        body,
        headers: {
          'content-type': 'multipart/form-data; boundary=boundary',
          'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
        },
        method: 'POST',
      },
    );

  it('streams the body to the fixed upload target with a freshly minted token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/uploads',
      );
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'content-type': 'multipart/form-data; boundary=boundary',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      // The body is forwarded as the incoming stream, never buffered into a string.
      expect(init?.body).toBeInstanceOf(ReadableStream);
      return Response.json(
        {
          status: 'accepted',
          uploadId: '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77',
        },
        { status: 201 },
      );
    });

    const response = await postDatasetUpload(
      auth,
      multipart(),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload).toEqual({
      status: 'accepted',
      uploadId: '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77',
    });
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(
      Object.keys(signJWT.mock.lastCall?.[0].body.payload ?? {}).sort(),
    ).toEqual(['iat', 'sub']);
    expect(signJWT.mock.lastCall?.[0].body.payload.sub).toBe('user_1');
  });

  it('rejects a forged selector, a non-multipart body and an unverified session', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    const forged = await postDatasetUpload(
      auth,
      multipart(),
      '../forged',
      fetchImplementation,
    );
    const plain = await postDatasetUpload(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/uploads',
        {
          body: 'part',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      ),
      'org_1',
      fetchImplementation,
    );
    const unverified = await postDatasetUpload(
      {
        ...auth,
        getSession: async () => ({
          user: { emailVerified: false, id: 'user_1' },
        }),
      },
      multipart(),
      'org_1',
      fetchImplementation,
    );

    expect([forged.status, plain.status, unverified.status]).toEqual([
      403, 400, 401,
    ]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('returns a generic gateway error for an unexpected upload response', async () => {
    const response = await postDatasetUpload(
      auth,
      multipart(),
      'org_1',
      async () => Response.json({ status: 'accepted', uploadId: 'not-a-uuid' }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('passes an upstream rejection through without its detail', async () => {
    const response = await postDatasetUpload(
      auth,
      multipart(),
      'org_1',
      async () => Response.json({ detail: 'private' }, { status: 413 }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'upload_rejected' });
  });
});
