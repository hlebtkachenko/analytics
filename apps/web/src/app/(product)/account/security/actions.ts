'use server';

import { findUserSessionToken } from '@bap/db/access';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getAuth, getAuthPool } from '../../../../lib/auth/server';

const sessionIdSchema = z.string().min(1).max(255);

// Revokes one of the caller's own sessions. The browser only sends a session id;
// the token is resolved server-side under the caller's user id and never returned.
export async function revokeAccountSessionAction(
  sessionId: string,
): Promise<{ ok: boolean }> {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return { ok: false };
  }

  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    return { ok: false };
  }

  const token = await findUserSessionToken(
    await getAuthPool(),
    session.user.id,
    parsed.data,
  );
  if (token === null) {
    return { ok: false };
  }

  try {
    await auth.api.revokeSession({
      body: { token },
      headers: requestHeaders,
    });
  } catch {
    return { ok: false };
  }

  return { ok: true };
}
