import { listNotifications } from '@bap/db/access';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../components/page-container';
import { getAuth, getAuthPool } from '../../../lib/auth/server';
import NotificationsView from './notifications-view';
import type { NotificationItem } from './notifications-view';

export default async function NotificationsPage() {
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

  let notifications: NotificationItem[] = [];
  try {
    const rows = await listNotifications(
      await getAuthPool(),
      session.user.id,
      100,
    );
    notifications = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      created: row.createdAt.toISOString(),
    }));
  } catch {
    notifications = [];
  }

  return (
    <PageContainer>
      <NotificationsView notifications={notifications} />
    </PageContainer>
  );
}
