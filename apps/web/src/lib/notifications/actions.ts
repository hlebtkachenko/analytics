'use server';

import { markNotificationsRead } from '@bap/db/access';
import { headers } from 'next/headers';

import { getAuth, getAuthPool } from '../auth/server';

// Marks all of the caller's own unread notifications read, scoped to the verified session user.
export async function markNotificationsReadAction(): Promise<void> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  // An unverified or absent session marks nothing, exactly like the shell admission rule.
  if (session?.user.emailVerified !== true) {
    return;
  }

  await markNotificationsRead(await getAuthPool(), session.user.id);
}
