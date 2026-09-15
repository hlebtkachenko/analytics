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

export function documentAnalyticsPath(
  organizationId: string,
  legalEntityId?: string,
): string {
  const filter =
    legalEntityId === undefined || legalEntityId.length === 0
      ? ''
      : `?legalEntityId=${encodeURIComponent(legalEntityId)}`;
  return `${documentsPath(organizationId)}/analytics${filter}`;
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

// The one currency formatter the register uses, so every amount reads the same way.
export function formatAmount(amount: string, currencyCode: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  return new Intl.NumberFormat('en-US', {
    currency: currencyCode,
    style: 'currency',
  }).format(value);
}
