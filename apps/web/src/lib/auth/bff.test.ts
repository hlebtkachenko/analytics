import { describe, expect, it, vi } from 'vitest';

import {
  deleteDocumentLink,
  deleteLegalEntity,
  getDocument,
  getDocumentAnalytics,
  getDocuments,
  getDatasetExport,
  getDatasetRows,
  getDatasets,
  getLegalEntities,
  getMemberEntityScope,
  getMemberEntityScopes,
  getOrganizationAccess,
  patchLegalEntity,
  patchPartner,
  postDatasetUpload,
  postDocument,
  postLegalEntity,
  putMemberEntityScope,
} from './bff.js';
import type { BffAuth } from './bff.js';

const memberCapabilities = {
  createEntities: false,
  deleteEntities: false,
  manageDocuments: false,
  manageEntityAccess: false,
  manageMembers: false,
  manageOrganization: false,
  readDocuments: true,
  updateEntities: false,
  uploadData: true,
  useAi: true,
};
const ownerCapabilities = {
  createEntities: true,
  deleteEntities: true,
  manageDocuments: true,
  manageEntityAccess: true,
  manageMembers: true,
  manageOrganization: true,
  readDocuments: true,
  updateEntities: true,
  uploadData: true,
  useAi: true,
};

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
        capabilities: memberCapabilities,
        entityScope: { mode: 'all' },
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
      capabilities: memberCapabilities,
      entityScope: { mode: 'all' },
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
        capabilities: ownerCapabilities,
        entityScope: { mode: 'all' },
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

  it('passes a slug-shaped selector to the id-only service and preserves its denial', async () => {
    const signingCallCount = signJWT.mock.calls.length;
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/organization-one/access',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer resource-token',
      );
      return Response.json(
        { detail: 'private membership state' },
        { status: 403 },
      );
    });

    const response = await getOrganizationAccess(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/organization-one/access',
      ),
      'application',
      'organization-one',
      fetchImplementation,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'access_denied' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(signJWT).toHaveBeenCalledTimes(signingCallCount + 1);
    const signingCall = signJWT.mock.calls[signingCallCount]?.[0];
    expect(signingCall).toEqual({
      body: { payload: { iat: expect.any(Number), sub: 'user_1' } },
    });
    expect(JSON.stringify(signingCall)).not.toContain('organization-one');
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
          capabilities: memberCapabilities,
          entityScope: { mode: 'all' },
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
          capabilities: { ...memberCapabilities, exportEverything: true },
          entityScope: { mode: 'all' },
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
const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const datasetSummary = {
  createdAt: '2026-08-30T06:00:00.000Z',
  description: null,
  id: DATASET_ID,
  legalEntityId: LEGAL_ENTITY_ID,
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

  it('forwards only a validated legal entity filter', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/datasets?legalEntityId=${LEGAL_ENTITY_ID}`,
      );
      return Response.json({ datasets: [datasetSummary] });
    });

    const filtered = await getDatasets(
      auth,
      datasetRequest(`datasets?legalEntityId=${LEGAL_ENTITY_ID}`),
      'org_1',
      fetchImplementation,
    );
    const forgedFilter = await getDatasets(
      auth,
      datasetRequest('datasets?legalEntityId=all'),
      'org_1',
      fetchImplementation,
    );

    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toEqual({ datasets: [datasetSummary] });
    expect(forgedFilter.status).toBe(400);
    expect(await forgedFilter.json()).toEqual({ error: 'invalid_filter' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('ignores an unrelated query parameter instead of refusing the list', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/datasets?legalEntityId=${LEGAL_ENTITY_ID}`,
      );
      return Response.json({ datasets: [datasetSummary] });
    });

    const unfiltered = await getDatasets(
      auth,
      datasetRequest('datasets?cacheBuster=1&utm_source=mail'),
      'org_1',
      async (input) => {
        expect(String(input)).toBe(
          'http://api:3001/v1/organizations/org_1/datasets',
        );
        return Response.json({ datasets: [datasetSummary] });
      },
    );
    const filtered = await getDatasets(
      auth,
      datasetRequest(
        `datasets?utm_source=mail&legalEntityId=${LEGAL_ENTITY_ID.toUpperCase()}`,
      ),
      'org_1',
      fetchImplementation,
    );

    expect(unfiltered.status).toBe(200);
    expect(filtered.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledOnce();
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

const legalEntity = {
  createdAt: '2026-09-10T06:00:00.000Z',
  id: LEGAL_ENTITY_ID,
  kind: 'company',
  name: 'Placeholder Holding',
  registrationNumber: null,
  updatedAt: '2026-09-10T06:05:00.000Z',
};

const entityRequest = (path: string, init?: RequestInit) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      },
    },
  );

describe('getLegalEntities', () => {
  it('reads the fixed entity target with a freshly minted token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/legal-entities',
      );
      expect(init?.method).toBe('GET');
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      return Response.json({ legalEntities: [legalEntity] });
    });

    const response = await getLegalEntities(
      auth,
      entityRequest('legal-entities'),
      'org_1',
      fetchImplementation,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ legalEntities: [legalEntity] });
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-request-id')).toBe(
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('rejects a forged selector before signing and refuses an off-contract list', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const forged = await getLegalEntities(
      auth,
      entityRequest('legal-entities'),
      '../forged',
      fetchImplementation,
    );
    const malformed = await getLegalEntities(
      auth,
      entityRequest('legal-entities'),
      'org_1',
      async () =>
        Response.json({
          legalEntities: [{ ...legalEntity, kind: 'partnership' }],
        }),
    );
    const refused = await getLegalEntities(
      auth,
      entityRequest('legal-entities'),
      'org_1',
      async () => Response.json({ detail: 'private' }, { status: 403 }),
    );

    expect(forged.status).toBe(403);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(malformed.status).toBe(502);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'legal_entities_unavailable',
    });
  });
});

describe('postLegalEntity', () => {
  it('forwards only the validated body to the fixed create target', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/legal-entities',
      );
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(
        JSON.stringify({
          kind: 'company',
          name: 'Placeholder Holding',
          registrationNumber: 'HRB-1',
        }),
      );
      return Response.json(legalEntity, { status: 201 });
    });

    const response = await postLegalEntity(
      auth,
      entityRequest('legal-entities', {
        body: JSON.stringify({
          kind: 'company',
          name: '  Placeholder Holding  ',
          registrationNumber: ' HRB-1 ',
          role: 'owner',
        }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(fetchImplementation).not.toHaveBeenCalled();

    const accepted = await postLegalEntity(
      auth,
      entityRequest('legal-entities', {
        body: JSON.stringify({
          kind: 'company',
          name: '  Placeholder Holding  ',
          registrationNumber: ' HRB-1 ',
        }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );

    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual(legalEntity);
  });

  it('refuses an unreadable body, an unknown kind and an unverified session', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const unreadable = await postLegalEntity(
      auth,
      entityRequest('legal-entities', { body: 'not json', method: 'POST' }),
      'org_1',
      fetchImplementation,
    );
    const unknownKind = await postLegalEntity(
      auth,
      entityRequest('legal-entities', {
        body: JSON.stringify({ kind: 'charity', name: 'Placeholder' }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );
    const unverified = await postLegalEntity(
      {
        ...auth,
        getSession: async () => ({
          user: { emailVerified: false, id: 'user_1' },
        }),
      },
      entityRequest('legal-entities', {
        body: JSON.stringify({ kind: 'company', name: 'Placeholder' }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );

    expect([unreadable.status, unknownKind.status, unverified.status]).toEqual([
      400, 400, 401,
    ]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('patchLegalEntity', () => {
  it('sends a partial body to the selected entity only', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/legal-entities/${LEGAL_ENTITY_ID}`,
      );
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify({ name: 'Renamed Holding' }));
      return Response.json({ ...legalEntity, name: 'Renamed Holding' });
    });

    const response = await patchLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, {
        body: JSON.stringify({ name: 'Renamed Holding' }),
        method: 'PATCH',
      }),
      'org_1',
      LEGAL_ENTITY_ID,
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...legalEntity,
      name: 'Renamed Holding',
    });
  });

  it('forwards a null registration number so an update can clear it', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body).toBe(JSON.stringify({ registrationNumber: null }));
      return Response.json({ ...legalEntity, registrationNumber: null });
    });

    const response = await patchLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, {
        body: JSON.stringify({ registrationNumber: null }),
        method: 'PATCH',
      }),
      'org_1',
      LEGAL_ENTITY_ID,
      fetchImplementation,
    );
    const created = await postLegalEntity(
      auth,
      entityRequest('legal-entities', {
        body: JSON.stringify({
          kind: 'company',
          name: 'Placeholder Holding',
          registrationNumber: null,
        }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...legalEntity,
      registrationNumber: null,
    });
    // Creation has nothing to clear, so a null there stays a rejected body.
    expect(created.status).toBe(400);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('hides a malformed entity id and refuses an empty patch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const missing = await patchLegalEntity(
      auth,
      entityRequest('legal-entities/not-a-uuid', {
        body: JSON.stringify({ name: 'Renamed Holding' }),
        method: 'PATCH',
      }),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );
    const empty = await patchLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, {
        body: JSON.stringify({}),
        method: 'PATCH',
      }),
      'org_1',
      LEGAL_ENTITY_ID,
      fetchImplementation,
    );

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'legal_entity_not_found' });
    expect(empty.status).toBe(400);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('deleteLegalEntity', () => {
  it('returns no content and passes an upstream refusal through without its detail', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/legal-entities/${LEGAL_ENTITY_ID}`,
      );
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toBeUndefined();
      return new Response(null, { status: 204 });
    });

    const response = await deleteLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, { method: 'DELETE' }),
      'org_1',
      LEGAL_ENTITY_ID,
      fetchImplementation,
    );
    const refused = await deleteLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, { method: 'DELETE' }),
      'org_1',
      LEGAL_ENTITY_ID,
      async () => Response.json({ detail: 'private' }, { status: 403 }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'legal_entity_rejected' });
  });

  it('records an unreachable service as a generic gateway error', async () => {
    const response = await deleteLegalEntity(
      auth,
      entityRequest(`legal-entities/${LEGAL_ENTITY_ID}`, { method: 'DELETE' }),
      'org_1',
      LEGAL_ENTITY_ID,
      async () => Promise.reject(new Error('unavailable')),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('getMemberEntityScopes', () => {
  it('reads every stored scope from one owner-only target', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/entity-scopes',
      );
      expect(init?.method).toBe('GET');
      return Response.json({
        entityScopes: [
          {
            entityScope: {
              legalEntityIds: [LEGAL_ENTITY_ID],
              mode: 'restricted',
            },
            userId: 'user_2',
          },
        ],
      });
    });

    const response = await getMemberEntityScopes(
      auth,
      entityRequest('entity-scopes'),
      'org_1',
      fetchImplementation,
    );
    const forged = await getMemberEntityScopes(
      auth,
      entityRequest('entity-scopes'),
      '../forged',
      fetchImplementation,
    );
    const refused = await getMemberEntityScopes(
      auth,
      entityRequest('entity-scopes'),
      'org_1',
      async () => Response.json({ detail: 'private' }, { status: 403 }),
    );
    const malformed = await getMemberEntityScopes(
      auth,
      entityRequest('entity-scopes'),
      'org_1',
      async () =>
        Response.json({ entityScopes: [{ entityScope: { mode: 'some' } }] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entityScopes: [
        {
          entityScope: {
            legalEntityIds: [LEGAL_ENTITY_ID],
            mode: 'restricted',
          },
          userId: 'user_2',
        },
      ],
    });
    expect(forged.status).toBe(403);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'entity_scopes_unavailable',
    });
    expect(malformed.status).toBe(502);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

describe('member entity scope', () => {
  it('reads the scope of one member from the fixed target', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/members/user_2/entity-scope',
      );
      expect(init?.method).toBe('GET');
      return Response.json({
        legalEntityIds: [LEGAL_ENTITY_ID],
        mode: 'restricted',
      });
    });

    const response = await getMemberEntityScope(
      auth,
      entityRequest('members/user_2/entity-scope'),
      'org_1',
      'user_2',
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      legalEntityIds: [LEGAL_ENTITY_ID],
      mode: 'restricted',
    });
  });

  it('writes only a validated scope body and preserves an owner conflict', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/members/user_2/entity-scope',
      );
      expect(init?.method).toBe('PUT');
      expect(init?.body).toBe(JSON.stringify({ mode: 'all' }));
      return Response.json({ mode: 'all' });
    });

    const accepted = await putMemberEntityScope(
      auth,
      entityRequest('members/user_2/entity-scope', {
        body: JSON.stringify({ mode: 'all' }),
        method: 'PUT',
      }),
      'org_1',
      'user_2',
      fetchImplementation,
    );
    const forgedEntity = await putMemberEntityScope(
      auth,
      entityRequest('members/user_2/entity-scope', {
        body: JSON.stringify({
          legalEntityIds: ['not-a-uuid'],
          mode: 'restricted',
        }),
        method: 'PUT',
      }),
      'org_1',
      'user_2',
      fetchImplementation,
    );
    const ownerTarget = await putMemberEntityScope(
      auth,
      entityRequest('members/user_2/entity-scope', {
        body: JSON.stringify({ mode: 'all' }),
        method: 'PUT',
      }),
      'org_1',
      'user_2',
      async () => Response.json({ detail: 'private' }, { status: 409 }),
    );
    const forgedMember = await putMemberEntityScope(
      auth,
      entityRequest('members/user_2/entity-scope', {
        body: JSON.stringify({ mode: 'all' }),
        method: 'PUT',
      }),
      'org_1',
      '../forged',
      fetchImplementation,
    );

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ mode: 'all' });
    expect(forgedEntity.status).toBe(400);
    expect(await forgedEntity.json()).toEqual({ error: 'invalid_body' });
    expect(ownerTarget.status).toBe(409);
    expect(await ownerTarget.json()).toEqual({
      error: 'entity_scope_rejected',
    });
    expect(forgedMember.status).toBe(404);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';
const documentSummary = {
  createdAt: '2026-09-01T00:00:00.000Z',
  currencyCode: 'CZK',
  documentDate: '2026-09-01',
  hasEvent: true,
  id: DOCUMENT_ID,
  isBalanced: true,
  isCurrent: true,
  kind: 'received_invoice',
  legalEntityId: LEGAL_ENTITY_ID,
  openIssueCount: 0,
  partnerId: null,
  partnerName: null,
  reference: 'REF-1',
  source: 'manual',
  status: 'registered',
  title: 'placeholder register entry',
  totalAmount: '1210.0000',
  updatedAt: '2026-09-02T00:00:00.000Z',
  validFrom: null,
  validTo: null,
  version: 1,
};
const documentList = {
  documents: [documentSummary],
  page: 1,
  pageSize: 25,
  total: 1,
  totalsByCurrency: [{ currencyCode: 'CZK', totalAmount: '1210.0000' }],
};
const documentDetail = {
  attributes: {},
  document: documentSummary,
  event: null,
  invoice: null,
  issues: [],
  links: [],
};

describe('getDocuments', () => {
  it('rebuilds the query from validated values only', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/documents?legalEntityId=${LEGAL_ENTITY_ID}&kind=received_invoice&status=registered&page=2&pageSize=50&sort=title&order=asc`,
      );
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      return Response.json(documentList);
    });

    const response = await getDocuments(
      auth,
      datasetRequest(
        `documents?legalEntityId=${LEGAL_ENTITY_ID.toUpperCase()}&kind=received_invoice&status=registered&page=2&pageSize=50&sort=title&order=asc`,
      ),
      'org_1',
      fetchImplementation,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(documentList);
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('applies the contract defaults when the browser asks for nothing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/documents?page=1&pageSize=25&sort=documentDate&order=desc',
      );
      return Response.json(documentList);
    });

    const response = await getDocuments(
      auth,
      datasetRequest('documents'),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('refuses an unsupported filter, an oversized page, and a window past the bound', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json(documentList),
    );

    const unsupported = await getDocuments(
      auth,
      datasetRequest('documents?kind=invented_kind'),
      'org_1',
      fetchImplementation,
    );
    const oversized = await getDocuments(
      auth,
      datasetRequest('documents?pageSize=500'),
      'org_1',
      fetchImplementation,
    );
    const pastBound = await getDocuments(
      auth,
      datasetRequest('documents?page=500&pageSize=100'),
      'org_1',
      fetchImplementation,
    );

    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: 'invalid_query' });
    expect(oversized.status).toBe(400);
    expect(pastBound.status).toBe(400);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

const documentAnalytics = {
  byAccount: [
    {
      accountCode: '518',
      accountName: 'Other services',
      credit: '0.0000',
      debit: '5000.0000',
      nature: 'EXPENSE',
    },
  ],
  byActivity: [
    {
      activityCode: 'month-01',
      credit: '0.0000',
      debit: '1000.0000',
      lineCount: 1,
    },
  ],
  byMonth: [
    {
      accountCode: '518',
      accountName: 'Other services',
      credit: '0.0000',
      debit: '1000.0000',
      month: '2026-01-01',
    },
  ],
  byVatRegime: [
    {
      baseAmount: '5000.0000',
      lineCount: 5,
      lineKind: 'item',
      vatAmount: '1050.0000',
      vatMode: 'standard',
      vatRate: '21',
    },
  ],
  documents: [
    {
      advanceTotal: '0.0000',
      amountDue: '6050.0000',
      currencyCode: 'CZK',
      documentDate: '2026-01-15',
      grossTotal: '6050.0000',
      id: DOCUMENT_ID,
      kind: 'received_invoice',
      partnerName: null,
      reference: 'REF-1',
      roundingAmount: '0.0000',
      status: 'registered',
      title: 'placeholder register entry',
    },
  ],
  stats: {
    elapsedMs: 12,
    eventLineCount: 10,
    invoiceLineCount: 5,
    queryCount: 4,
  },
};

describe('getDocumentAnalytics', () => {
  it('rebuilds the entity filter from the validated value only', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/documents/analytics?legalEntityId=${LEGAL_ENTITY_ID}`,
      );
      expect(init?.headers).toEqual({
        authorization: 'Bearer resource-token',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      });
      return Response.json(documentAnalytics);
    });

    const response = await getDocumentAnalytics(
      auth,
      datasetRequest(
        `documents/analytics?legalEntityId=${LEGAL_ENTITY_ID.toUpperCase()}`,
      ),
      'org_1',
      fetchImplementation,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(documentAnalytics);
    expect(JSON.stringify(payload)).not.toContain('resource-token');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('asks for the whole scope when the browser names no entity', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/documents/analytics',
      );
      return Response.json(documentAnalytics);
    });

    const response = await getDocumentAnalytics(
      auth,
      datasetRequest('documents/analytics'),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('refuses a malformed entity filter and an unsupported parameter without calling out', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json(documentAnalytics),
    );

    const malformed = await getDocumentAnalytics(
      auth,
      datasetRequest('documents/analytics?legalEntityId=not-a-uuid'),
      'org_1',
      fetchImplementation,
    );
    const unsupported = await getDocumentAnalytics(
      auth,
      datasetRequest('documents/analytics?page=2'),
      'org_1',
      fetchImplementation,
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_query' });
    expect(unsupported.status).toBe(400);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('postDocument', () => {
  it('forwards a validated register entry and answers with the created detail', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'http://api:3001/v1/organizations/org_1/documents',
      );
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        currencyCode: 'CZK',
        documentDate: '2026-09-01',
        kind: 'contract',
        legalEntityId: LEGAL_ENTITY_ID,
        title: 'placeholder register entry',
      });
      return Response.json(documentDetail, { status: 201 });
    });

    const response = await postDocument(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/documents',
        {
          body: JSON.stringify({
            documentDate: '2026-09-01',
            kind: 'contract',
            legalEntityId: LEGAL_ENTITY_ID,
            title: 'placeholder register entry',
          }),
          headers: {
            'content-type': 'application/json',
            'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
          },
          method: 'POST',
        },
      ),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(documentDetail);
  });

  it('refuses invoice content on a kind that carries none before a token is minted', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json(documentDetail, { status: 201 }),
    );

    const response = await postDocument(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/documents',
        {
          body: JSON.stringify({
            documentDate: '2026-09-01',
            invoice: {
              lines: [
                {
                  baseAmount: '1000',
                  category: 'services',
                  description: 'placeholder line',
                  vatMode: 'standard',
                },
              ],
            },
            kind: 'contract',
            legalEntityId: LEGAL_ENTITY_ID,
            title: 'placeholder register entry',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      ),
      'org_1',
      fetchImplementation,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('parsedIdentifier', () => {
  it('normalizes a padded upper-case identifier before the outbound call', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/documents/${DOCUMENT_ID}`,
      );
      return Response.json(documentDetail);
    });

    const response = await getDocument(
      auth,
      datasetRequest(`documents/${DOCUMENT_ID}`),
      'org_1',
      ` ${DOCUMENT_ID.toUpperCase()} `,
      fetchImplementation,
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('answers a malformed identifier with the not-found code of its own resource', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json(documentDetail),
    );

    const document = await getDocument(
      auth,
      datasetRequest('documents/not-a-uuid'),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );
    const link = await deleteDocumentLink(
      auth,
      datasetRequest(`documents/${DOCUMENT_ID}/links/not-a-uuid`),
      'org_1',
      DOCUMENT_ID,
      'not-a-uuid',
      fetchImplementation,
    );
    const partner = await patchPartner(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/partners/not-a-uuid',
        {
          body: JSON.stringify({ name: 'Placeholder Supplier' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        },
      ),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );

    expect(document.status).toBe(404);
    expect(await document.json()).toEqual({ error: 'document_not_found' });
    expect(link.status).toBe(404);
    expect(await link.json()).toEqual({ error: 'link_not_found' });
    expect(partner.status).toBe(404);
    expect(await partner.json()).toEqual({ error: 'partner_not_found' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
