import { listUserSessions } from '@bap/db/access';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import { getAuth, getAuthPool } from '../../../../lib/auth/server';
import SecurityView from './security-view';
import type { AccountSession } from './security-view';

export default async function AccountSecurityPage() {
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

  let sessions: AccountSession[] = [];
  try {
    const rows = await listUserSessions(await getAuthPool(), session.user.id);
    sessions = rows.map((row) => ({
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      id: row.id,
      ipAddress: row.ipAddress,
      updatedAt: row.updatedAt.toISOString(),
      userAgent: row.userAgent,
    }));
  } catch {
    // A failed read renders an empty session list rather than the whole page failing.
  }

  return (
    <PageContainer>
      <SecurityView
        currentSessionId={session.session.id}
        sessions={sessions}
        twoFactorEnabled={session.user.twoFactorEnabled === true}
      />
    </PageContainer>
  );
}
