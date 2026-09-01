// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import { getOrganizationCreationQuota } from '@bap/db/access';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth, getAuthPool } from '../../../../lib/auth/server';
import OrganizationForm from './organization-form';

export default async function NewOrganizationPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ result?: string }> }>) {
  const auth = await getAuth().catch(() => null);
  if (auth === null) {
    redirect('/sign-in');
  }
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session?.user.emailVerified !== true) {
    redirect('/sign-in');
  }

  const quota = await getOrganizationCreationQuota(
    await getAuthPool(),
    session.user.id,
  ).catch(() => null);
  const { result } = await searchParams;

  return (
    <main>
      <h1>Create organization</h1>
      <p>
        <Link href="/organizations">Back to organizations</Link>
      </p>
      <p>Remaining creation quota: {quota?.remainingTotal ?? 0}</p>
      {result === 'error' ? (
        <p role="alert">The organization could not be created.</p>
      ) : null}
      {(quota?.remainingTotal ?? 0) === 0 ? (
        <p>Organization creation is not available for this account.</p>
      ) : (
        <OrganizationForm initialName={session.user.name} />
      )}
    </main>
  );
}
