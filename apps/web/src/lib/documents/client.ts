import type { z } from 'zod';

import { organizationPath } from '../datasets/client';

// The documents BFF shapes the browser may ask for, all fixed paths under one organization.
export function documentsPath(
  organizationId: string,
  query?: URLSearchParams,
): string {
  const search = query === undefined ? '' : query.toString();
  return `${organizationPath(organizationId)}/documents${search.length === 0 ? '' : `?${search}`}`;
}

// Each selected entity is appended as its own repeated legalEntityId, so several stay several to the BFF.
export function documentAnalyticsPath(
  organizationId: string,
  legalEntityIds: readonly string[] = [],
): string {
  const params = new URLSearchParams();

  for (const legalEntityId of legalEntityIds) {
    if (legalEntityId.length > 0) {
      params.append('legalEntityId', legalEntityId);
    }
  }

  const search = params.toString();
  return `${documentsPath(organizationId)}/analytics${search.length === 0 ? '' : `?${search}`}`;
}

export function documentPath(
  organizationId: string,
  documentId: string,
): string {
  return `${documentsPath(organizationId)}/${encodeURIComponent(documentId)}`;
}

export function documentLinksPath(
  organizationId: string,
  documentId: string,
): string {
  return `${documentPath(organizationId, documentId)}/links`;
}

export function documentLinkPath(
  organizationId: string,
  documentId: string,
  linkId: string,
): string {
  return `${documentLinksPath(organizationId, documentId)}/${encodeURIComponent(linkId)}`;
}

export function partnersPath(organizationId: string, q?: string): string {
  const filter =
    q === undefined || q.length === 0 ? '' : `?q=${encodeURIComponent(q)}`;
  return `${organizationPath(organizationId)}/partners${filter}`;
}

// A blank field is an absent field; the contract trims whatever is actually sent.
export function optional(value: string): string | undefined {
  return value.trim().length === 0 ? undefined : value;
}

// One product link builder, so every page keeps the chosen organization in the URL.
export function withOrganization(path: string, slug: string): string {
  return slug.length === 0
    ? path
    : `${path}?organization=${encodeURIComponent(slug)}`;
}

type Mutation = Readonly<{
  body?: unknown;
  method: 'DELETE' | 'PATCH' | 'POST';
  path: string;
  signal?: AbortSignal;
}>;

// One JSON mutation against a fixed BFF route, validated again before the page trusts it.
export async function sendJson<T>(
  mutation: Mutation,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(mutation.path, {
    ...(mutation.body === undefined
      ? {}
      : { body: JSON.stringify(mutation.body) }),
    cache: 'no-store',
    headers:
      mutation.body === undefined ? {} : { 'content-type': 'application/json' },
    method: mutation.method,
    ...(mutation.signal === undefined ? {} : { signal: mutation.signal }),
  });

  if (!response.ok) {
    throw new Error('Request failed.');
  }

  return schema.parse(await response.json());
}

export async function sendWithoutContent(mutation: Mutation): Promise<void> {
  const response = await fetch(mutation.path, {
    cache: 'no-store',
    method: mutation.method,
    ...(mutation.signal === undefined ? {} : { signal: mutation.signal }),
  });

  if (!response.ok) {
    throw new Error('Request failed.');
  }
}
