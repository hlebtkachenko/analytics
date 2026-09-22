import { z } from 'zod';

import {
  createDocumentLinkRequestSchema,
  createDocumentRequestSchema,
  createPartnerRequestSchema,
  directiveAccountListSchema,
  documentAnalyticsQuerySchema,
  documentAnalyticsResponseSchema,
  documentDetailSchema,
  documentLinkSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  partnerListQuerySchema,
  partnerListSchema,
  partnerSchema,
  updateDocumentRequestSchema,
  updatePartnerRequestSchema,
} from '../../documents/contract.ts';
import {
  callApplicationJson,
  jsonResponse,
  parsedIdentifier,
  prepareApplicationCall,
  readJsonBody,
} from './core.ts';
import type { BffAuth } from './core.ts';

// Rebuilt from validated values only, so no client query string is forwarded verbatim.
function documentListQuery(
  query: z.infer<typeof documentListQuerySchema>,
): string {
  const outbound = new URLSearchParams();

  outbound.set('current', query.current);
  if (query.legalEntityId !== undefined) {
    outbound.set('legalEntityId', query.legalEntityId);
  }
  if (query.kind !== undefined) {
    outbound.set('kind', query.kind.join(','));
  }
  if (query.status !== undefined) {
    outbound.set('status', query.status.join(','));
  }
  if (query.partnerId !== undefined) {
    outbound.set('partnerId', query.partnerId);
  }
  if (query.dateFrom !== undefined) {
    outbound.set('dateFrom', query.dateFrom);
  }
  if (query.dateTo !== undefined) {
    outbound.set('dateTo', query.dateTo);
  }
  if (query.q !== undefined) {
    outbound.set('q', query.q);
  }
  outbound.set('page', String(query.page));
  outbound.set('pageSize', String(query.pageSize));
  outbound.set('sort', query.sort);
  outbound.set('order', query.order);

  return outbound.toString();
}

export async function getDocuments(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = documentListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  // An unsupported filter, an oversized page, or a window beyond the bound is refused, never clamped.
  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'documents_unavailable',
      method: 'GET',
      operation: 'getDocuments',
      path: `documents?${documentListQuery(query.data)}`,
      schema: documentListResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getDocumentAnalytics(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = documentAnalyticsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  // A malformed entity filter is refused here, never widened into an unfiltered read.
  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from the validated value only, so no client query string is forwarded verbatim.
  const filter =
    query.data.legalEntityId === undefined
      ? ''
      : `?legalEntityId=${encodeURIComponent(query.data.legalEntityId)}`;

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_analytics_unavailable',
      method: 'GET',
      operation: 'getDocumentAnalytics',
      path: `documents/analytics${filter}`,
      schema: documentAnalyticsResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createDocumentRequestSchema);

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
      errorCode: 'document_rejected',
      method: 'POST',
      operation: 'postDocument',
      path: 'documents',
      schema: documentDetailSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function getDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_unavailable',
      method: 'GET',
      operation: 'getDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: documentDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function patchDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, updateDocumentRequestSchema);

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
      errorCode: 'document_rejected',
      method: 'PATCH',
      operation: 'patchDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: documentDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function deleteDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_rejected',
      method: 'DELETE',
      operation: 'deleteDocument',
      path: `documents/${encodeURIComponent(selected.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

export async function postDocumentLink(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, createDocumentLinkRequestSchema);

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
      errorCode: 'document_link_rejected',
      method: 'POST',
      operation: 'postDocumentLink',
      path: `documents/${encodeURIComponent(selected.value)}/links`,
      schema: documentLinkSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function deleteDocumentLink(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  documentId: string,
  linkId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(documentId, 'document_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const selectedLink = parsedIdentifier(linkId, 'link_not_found');

  if ('failure' in selectedLink) {
    return selectedLink.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'document_link_rejected',
      method: 'DELETE',
      operation: 'deleteDocumentLink',
      path: `documents/${encodeURIComponent(selected.value)}/links/${encodeURIComponent(selectedLink.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}

export async function getPartners(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const requested = new URL(request.url).searchParams.get('q');
  const query = partnerListQuerySchema.safeParse(
    requested === null ? {} : { q: requested },
  );

  if (!query.success) {
    return jsonResponse({ error: 'invalid_query' }, 400);
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  // Rebuilt from the validated value only, so no client query string is forwarded verbatim.
  const filter =
    query.data.q === undefined ? '' : `?q=${encodeURIComponent(query.data.q)}`;

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'partners_unavailable',
      method: 'GET',
      operation: 'getPartners',
      path: `partners${filter}`,
      schema: partnerListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postPartner(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createPartnerRequestSchema);

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
      errorCode: 'partner_rejected',
      method: 'POST',
      operation: 'postPartner',
      path: 'partners',
      schema: partnerSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function patchPartner(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  partnerId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(partnerId, 'partner_not_found');

  if ('failure' in selected) {
    return selected.failure;
  }

  const body = await readJsonBody(request, updatePartnerRequestSchema);

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
      errorCode: 'partner_rejected',
      method: 'PATCH',
      operation: 'patchPartner',
      path: `partners/${encodeURIComponent(selected.value)}`,
      schema: partnerSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getDirectiveAccounts(
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
      errorCode: 'directive_accounts_unavailable',
      method: 'GET',
      operation: 'getDirectiveAccounts',
      path: 'directive-accounts',
      schema: directiveAccountListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
