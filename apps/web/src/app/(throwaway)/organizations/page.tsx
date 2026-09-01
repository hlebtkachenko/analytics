// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '../../../lib/auth/server';

export default async function OrganizationsPage() {
  const auth = await getAuth().catch(() => null);
  if (auth === null) {
    redirect('/sign-in');
  }
  const requestHeaders = await headers();
  const session = await auth.api
    .getSession({ headers: requestHeaders })
    .catch(() => null);

  if (session?.user.emailVerified !== true) {
    redirect('/sign-in');
  }

  let organizations: Awaited<ReturnType<typeof auth.api.listOrganizations>> =
    [];
  let failed = false;
  try {
    organizations = await auth.api.listOrganizations({
      headers: requestHeaders,
    });
  } catch {
    failed = true;
  }

  return (
    <main>
      <h1>Organizations</h1>
      <p>
        <Link href="/organizations/new">Create organization</Link>
      </p>
      {failed ? <p role="alert">Organizations could not be loaded.</p> : null}
      {!failed && organizations.length === 0 ? (
        <p>You are not a member of an organization.</p>
      ) : null}
      {organizations.length > 0 ? (
        <ul aria-label="Organizations">
          {organizations.map((organization) => (
            <li key={organization.id}>
              <Link href={`/${organization.slug}`}>{organization.name}</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
