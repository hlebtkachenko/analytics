import { resolveOrganizationRouteForRequest } from './resolver';
import { organizationSlugSchema } from './slug';

export const invalidScopedActionPath = '/organizations?result=error';

export function formValue(formData: FormData, name: string): unknown {
  return formData.get(name);
}

export function organizationPath(slug: string, suffix = ''): string {
  return `/${slug}${suffix}`;
}

export function resultPath(path: string, result: 'error' | 'success'): string {
  return `${path}?result=${result}`;
}

// Resolves the bound slug through the member-gated resolver, never a browser-supplied id.
export async function resolveActionOrganization(
  slug: string,
  requiredRole?: 'owner',
) {
  const parsed = organizationSlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new Error('Organization action unavailable.');
  }

  const organization = await resolveOrganizationRouteForRequest(parsed.data);
  if (organization === null) {
    throw new Error('Organization action unavailable.');
  }

  // Better Auth and the API remain the boundary; this refuses the call before it is made.
  if (requiredRole !== undefined && organization.role !== requiredRole) {
    throw new Error('Organization action unavailable.');
  }

  return organization;
}
