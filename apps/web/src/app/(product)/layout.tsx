import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import packageJson from '../../../package.json';
import ProductShell from '../../components/shell/product-shell';
import { signInPath } from '../../lib/auth/return-path';
import { getAuth } from '../../lib/auth/server';
import { readRailPinned } from '../../lib/preferences/server';

type ProductLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default async function ProductLayout({
  children,
}: ProductLayoutProperties) {
  const requestHeaders = await headers();
  let user: Readonly<{ email: string; name: string }> | null = null;

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });

    // An unverified account is not admitted to the shell, exactly like a signed out one.
    if (session?.user.emailVerified === true) {
      user = { email: session.user.email, name: session.user.name };
    }
  } catch {
    // Session failures are handled as signed-out state.
  }

  if (user === null) {
    // The proxy puts the requested path in x-bap-path because a layout never sees the URL.
    redirect(signInPath(requestHeaders.get('x-bap-path')) as Route);
    return null;
  }

  const railPinned = await readRailPinned();
  // The feedback address is an operator input, not a public build-time constant.
  const feedbackEmail = process.env.BAP_FEEDBACK_EMAIL;

  return (
    <ProductShell
      feedbackEmail={feedbackEmail}
      railPinned={railPinned}
      user={user}
      version={packageJson.version}
    >
      {children}
    </ProductShell>
  );
}
