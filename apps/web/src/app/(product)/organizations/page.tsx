import { listWorkspaceMemberships } from '@bap/db/access';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../components/page-container';
import { getAuth, getAuthPool } from '../../../lib/auth/server';
import WorkspaceList from './workspace-list';
import type { InvitationRow, WorkspaceRow } from './workspace-list';

// Better Auth stores an invitation with several roles as one comma-joined string.
function invitationRole(role: string): string {
  return role
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
}

function isoDate(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

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

  let workspaces: WorkspaceRow[] = [];
  let loadError = false;
  try {
    const memberships = await listWorkspaceMemberships(
      await getAuthPool(),
      session.user.id,
    );
    workspaces = memberships.map((membership) => ({
      id: membership.id,
      name: membership.name,
      slug: membership.slug,
      role: membership.role,
      created: isoDate(membership.createdAt),
    }));
  } catch {
    loadError = true;
  }

  let invitations: InvitationRow[] = [];
  try {
    const pending = await auth.api.listUserInvitations({
      headers: requestHeaders,
    });
    invitations = pending.map((invitation) => ({
      id: invitation.id,
      organizationName: invitation.organizationName,
      role: invitationRole(invitation.role),
      expires: isoDate(invitation.expiresAt),
    }));
  } catch {
    invitations = [];
  }

  return (
    <PageContainer>
      <WorkspaceList
        invitations={invitations}
        loadError={loadError}
        workspaces={workspaces}
      />
    </PageContainer>
  );
}
