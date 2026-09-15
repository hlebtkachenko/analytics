import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

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
  let signedIn = false;

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });

    // An unverified account is not admitted to the shell, exactly like a signed out one.
    signedIn = session?.user.emailVerified === true;
  } catch {
    // Session failures are handled as signed-out state.
  }

  if (!signedIn) {
    // The proxy puts the requested path in x-bap-path because a layout never sees the URL.
    redirect(signInPath(requestHeaders.get('x-bap-path')) as Route);
    return null;
  }

  const railPinned = await readRailPinned();

  return <ProductShell railPinned={railPinned}>{children}</ProductShell>;
}
