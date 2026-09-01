// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { updateOrganizationAction } from '../../../lib/organizations/actions';
import { resolveOrganizationRouteForRequest } from '../../../lib/organizations/resolver';

export default async function OrganizationSettingsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ result?: string }>;
}>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  const { result } = await searchParams;
  const updateOrganization = updateOrganizationAction.bind(
    null,
    organization.slug,
  );
  const canUpdate =
    organization.role === 'owner' || organization.role === 'admin';

  return (
    <main>
      <h1>{organization.name} settings</h1>
      <p>
        <Link href={`/${organization.slug}`}>Back to organization</Link>
      </p>
      {result === 'success' ? (
        <p role="status">Organization settings were updated.</p>
      ) : null}
      {result === 'error' ? (
        <p role="alert">Organization settings could not be updated.</p>
      ) : null}
      {canUpdate ? (
        <form action={updateOrganization} aria-label="Organization settings">
          <p>
            <label htmlFor="organization-name">Name</label>
            <input
              defaultValue={organization.name}
              id="organization-name"
              name="name"
              required
            />
          </p>
          <p>
            <label htmlFor="organization-slug">Slug</label>
            <input
              autoComplete="off"
              defaultValue={organization.slug}
              id="organization-slug"
              maxLength={20}
              minLength={3}
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
          </p>
          <button type="submit">Save settings</button>
        </form>
      ) : (
        <p>You do not have permission to update this organization.</p>
      )}
    </main>
  );
}
