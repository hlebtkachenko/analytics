'use server';

import {
  deleteAllNotifications,
  deleteNotification,
  markNotificationRead,
  markNotificationsRead,
} from '@bap/db/access';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getAuth, getAuthPool } from '../auth/server';

const notificationIdSchema = z.string().uuid();

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

// Marks one of the caller's own notifications read; a bad id is rejected before any query runs.
export async function markNotificationReadAction(id: string): Promise<void> {
  const notificationId = notificationIdSchema.parse(id);
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user.emailVerified !== true) {
    return;
  }

  await markNotificationRead(
    await getAuthPool(),
    session.user.id,
    notificationId,
  );
}

// Hard-deletes one of the caller's own notifications; a bad id is rejected before any query runs.
export async function dismissNotificationAction(id: string): Promise<void> {
  const notificationId = notificationIdSchema.parse(id);
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user.emailVerified !== true) {
    return;
  }

  await deleteNotification(
    await getAuthPool(),
    session.user.id,
    notificationId,
  );
}

// Hard-deletes every one of the caller's own notifications, scoped to the verified session user.
export async function dismissAllNotificationsAction(): Promise<void> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user.emailVerified !== true) {
    return;
  }

  await deleteAllNotifications(await getAuthPool(), session.user.id);
}
