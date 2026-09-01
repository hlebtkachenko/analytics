// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { resolveOrganizationRouteForRequest } from '../../lib/organizations/resolver';

export default async function OrganizationPage({
  params,
}: Readonly<{ params: Promise<{ orgSlug: string }> }>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  return (
    <main>
      <h1>{organization.name}</h1>
      <p>Your role: {organization.role}</p>
      <nav aria-label="Organization">
        <ul>
          <li>
            <Link href={`/${organization.slug}/members`}>Members</Link>
          </li>
          <li>
            <Link href={`/${organization.slug}/settings`}>Settings</Link>
          </li>
          <li>
            <Link href="/organizations">All organizations</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
