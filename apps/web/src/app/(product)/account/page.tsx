import { listWorkspaceMemberships } from '@bap/db/access';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../components/page-container';
import { getAuth, getAuthPool } from '../../../lib/auth/server';
import AccountView from './account-view';
import type { AccountWorkspace } from './account-view';

export default async function AccountPage() {
  let session: Awaited<
    ReturnType<Awaited<ReturnType<typeof getAuth>>['api']['getSession']>
  > = null;

  try {
    const auth = await getAuth();
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    // Session failures are handled as signed-out state.
  }

  if (!session?.user) {
    redirect('/sign-in');
    return null;
  }

  // Capabilities are enforced by the database; this list is read for display only.
  let workspaces: AccountWorkspace[] = [];
  try {
    const memberships = await listWorkspaceMemberships(
      await getAuthPool(),
      session.user.id,
    );
    workspaces = memberships.map((membership) => ({
      id: membership.id,
      name: membership.name,
      role: membership.role,
      slug: membership.slug,
    }));
  } catch {
    // A failed read renders an empty workspace list rather than the whole page failing.
  }

  return (
    <PageContainer>
      <AccountView
        email={session.user.email}
        name={session.user.name}
        workspaces={workspaces}
      />
    </PageContainer>
  );
}
