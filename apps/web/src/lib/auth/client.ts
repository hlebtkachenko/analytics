'use client';

import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// The sign-in page routes the challenge itself, so no redirect option is configured here.
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
