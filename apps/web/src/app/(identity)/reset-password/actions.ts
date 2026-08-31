'use server';

import { cookies, headers } from 'next/headers';

import {
  isValidResetCapability,
  resetCapabilityCookieName,
  resetCapabilityCookieOptions,
} from '../../../lib/auth/reset-capability';
import { getAuth } from '../../../lib/auth/server';

const betterAuthResetDispatchUrl =
  'https://better-auth.invalid/api/auth/reset-password';

export type ResetPasswordState = Readonly<{
  status: 'error' | 'form' | 'success';
}>;

export async function resetPassword(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const cookieStore = await cookies();
  const capability = cookieStore.get(resetCapabilityCookieName)?.value;
  const newPassword = formData.get('newPassword');
  const confirmPassword = formData.get('confirmPassword');

  if (
    !isValidResetCapability(capability) ||
    typeof newPassword !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    clearResetCapability(cookieStore);
    return { status: 'error' };
  }

  if (
    newPassword.length < 14 ||
    newPassword.length > 128 ||
    newPassword !== confirmPassword
  ) {
    return { status: 'error' };
  }

  try {
    const auth = await getAuth();
    const incomingHeaders = await headers();
    const dispatchHeaders = new Headers({
      'content-type': 'application/json',
    });
    const clientIp = incomingHeaders.get('x-bap-client-ip');
    if (clientIp) {
      dispatchHeaders.set('x-bap-client-ip', clientIp);
    }
    const response = await auth.handler(
      new Request(betterAuthResetDispatchUrl, {
        body: JSON.stringify({ newPassword, token: capability }),
        headers: dispatchHeaders,
        method: 'POST',
      }),
    );
    clearResetCapability(cookieStore);
    return { status: response.ok ? 'success' : 'error' };
  } catch {
    clearResetCapability(cookieStore);
    return { status: 'error' };
  }
}

function clearResetCapability(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): void {
  cookieStore.set(resetCapabilityCookieName, '', {
    ...resetCapabilityCookieOptions(process.env.NODE_ENV === 'production'),
    maxAge: 0,
  });
}
