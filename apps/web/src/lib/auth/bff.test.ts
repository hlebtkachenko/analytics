import { describe, expect, it, vi } from 'vitest';

import {
  getDatasetExport,
  getDatasetRows,
  getDatasets,
  getOrganizationAccess,
  postDatasetUpload,
} from './bff.js';
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

const DATASET_ID = '2f1c4a4e-6f0d-4f0a-9b3e-0d5b5c8a1e77';
const datasetSummary = {
  createdAt: '2026-08-30T06:00:00.000Z',
  description: null,
  id: DATASET_ID,
  name: 'placeholder container',
  rowCount: 2,
  status: 'ready',
  updatedAt: '2026-08-30T06:05:00.000Z',
};
const datasetRowPage = {
  columns: [{ inferredType: 'text', name: 'label', position: 0 }],
  datasetId: DATASET_ID,
  nextCursor: null,
  pageSize: 2,
  rows: [{ data: { label: 'row-0' }, rowNumber: 0 }],
};

const datasetRequest = (path: string) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    { headers: { 'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000' } },
  );

describe('getDatasets', () => {
  it('reads the fixed dataset target with a freshly minted token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/datasets',
      );
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      return Response.json({ datasets: [datasetSummary] });
    });

    const response = await getDatasets(
      auth,
      datasetRequest('datasets'),
      'org_1',
      fetchImplementation,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ datasets: [datasetSummary] });
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(
      Object.keys(signJWT.mock.lastCall?.[0].body.payload ?? {}).sort(),
    ).toEqual(['iat', 'sub']);
  });

  it('rejects a forged selector before signing and a body that breaks the contract', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const forged = await getDatasets(
      auth,
      datasetRequest('datasets'),
      '../forged',
      fetchImplementation,
    );
    const malformed = await getDatasets(
      auth,
      datasetRequest('datasets'),
      'org_1',
      async () =>
        Response.json({ datasets: [{ ...datasetSummary, extra: 1 }] }),
    );

    expect(forged.status).toBe(403);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('getDatasetRows', () => {
  it('forwards only validated paging values', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/datasets/${DATASET_ID}/rows?after=3&pageSize=2`,
      );
      return Response.json(datasetRowPage);
    });

    const response = await getDatasetRows(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/rows?after=3&pageSize=2&drop=me`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_page' });
    expect(fetchImplementation).not.toHaveBeenCalled();

    const accepted = await getDatasetRows(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/rows?after=3&pageSize=2`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual(datasetRowPage);
  });

  it('defaults the page size and rejects one above the bound', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/datasets/${DATASET_ID}/rows?pageSize=100`,
      );
      return Response.json(datasetRowPage);
    });

    await getDatasetRows(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/rows`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );
    const oversized = await getDatasetRows(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/rows?pageSize=501`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );

    // Rejected, never clamped, and rejected before any outbound call is made.
    expect(oversized.status).toBe(400);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('hides a malformed dataset id and refuses a page for another dataset', async () => {
    const missing = await getDatasetRows(
      auth,
      datasetRequest('datasets/not-a-uuid/rows'),
      'org_1',
      'not-a-uuid',
      vi.fn<typeof fetch>(),
    );
    const swapped = await getDatasetRows(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/rows`),
      'org_1',
      DATASET_ID,
      async () =>
        Response.json({
          ...datasetRowPage,
          datasetId: '0b0f1d2e-3c4b-4a59-8d6e-7f8091a2b3c4',
        }),
    );

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'dataset_not_found' });
    expect(swapped.status).toBe(502);
  });
});

describe('getDatasetExport', () => {
  it('streams the download under a filename derived from the dataset id', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/datasets/${DATASET_ID}/export?format=csv`,
      );
      return new Response('label\r\nrow-0\r\n', {
        headers: {
          // A steered upstream header must not reach the browser.
          'content-disposition': 'attachment; filename="steered.html"',
          'content-type': 'text/csv; charset=utf-8',
        },
      });
    });

    const response = await getDatasetExport(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/export?format=csv`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="dataset-${DATASET_ID}.csv"`,
    );
    expect(response.headers.get('content-type')).toBe(
      'text/csv; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(await response.text()).toBe('label\r\nrow-0\r\n');
  });

  it('refuses an unsupported format and a mismatched upstream media type', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const pdf = await getDatasetExport(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/export?format=pdf`),
      'org_1',
      DATASET_ID,
      fetchImplementation,
    );
    const mismatched = await getDatasetExport(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/export?format=xlsx`),
      'org_1',
      DATASET_ID,
      async () =>
        new Response('payload', { headers: { 'content-type': 'text/html' } }),
    );
    const rejected = await getDatasetExport(
      auth,
      datasetRequest(`datasets/${DATASET_ID}/export?format=csv`),
      'org_1',
      DATASET_ID,
      async () => Response.json({ detail: 'private' }, { status: 404 }),
    );

    expect(pdf.status).toBe(400);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(mismatched.status).toBe(502);
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toEqual({ error: 'export_rejected' });
  });
});
