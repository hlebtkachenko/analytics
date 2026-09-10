import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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

export type ActionOrganization = NonNullable<
  Awaited<ReturnType<typeof resolveActionOrganization>>
>;

// Mirrors a zod safe parse result without binding the scaffold to one schema shape.
type ActionInput<T> =
  Readonly<{ data: T; success: true }> | Readonly<{ success: false }>;

export type ScopedAction<T> = Readonly<{
  input: ActionInput<T>;
  organizationSlug: string;
  requiredRole?: 'owner' | undefined;
  // The organization-relative section every result of this action redirects back to.
  section: string;
  write: (organization: ActionOrganization, input: T) => Promise<boolean>;
}>;

// The shared scaffold: validate the bound slug, resolve, write, revalidate, then redirect.
export async function runScopedAction<T>(
  action: ScopedAction<T>,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(action.organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const sectionPath = (slug: string) => organizationPath(slug, action.section);
  let fallback = resultPath(sectionPath(routeSlug.data), 'error');
  let destination = fallback;

  if (action.input.success) {
    const input = action.input.data;
    try {
      const organization = await resolveActionOrganization(
        routeSlug.data,
        action.requiredRole,
      );
      fallback = resultPath(sectionPath(organization.slug), 'error');
      destination = fallback;

      if (!(await action.write(organization, input))) {
        throw new Error('Organization action unavailable.');
      }

      revalidatePath(sectionPath(organization.slug));
      destination = resultPath(sectionPath(organization.slug), 'success');
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}
