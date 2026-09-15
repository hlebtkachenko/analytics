import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import ProductShell from '../../components/shell/product-shell';
import { getAuth } from '../../lib/auth/server';
import { readRailPinned } from '../../lib/preferences/server';

type ProductLayoutProperties = Readonly<{
  children: ReactNode;
}>;

// The proxy puts the requested path in x-bap-path because a layout never sees the URL.
function signInTarget(path: string | null): string {
  if (path === null || !path.startsWith('/') || path.startsWith('//')) {
    return '/sign-in';
  }
  return `/sign-in?next=${encodeURIComponent(path)}`;
}

export default async function ProductLayout({
  children,
}: ProductLayoutProperties) {
  const requestHeaders = await headers();
  let signedIn = false;

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });

    signedIn = session?.user !== undefined;
  } catch {
    // Session failures are handled as signed-out state.
  }

  if (!signedIn) {
    redirect(signInTarget(requestHeaders.get('x-bap-path')) as Route);
    return null;
  }

  const railPinned = await readRailPinned();

  return <ProductShell railPinned={railPinned}>{children}</ProductShell>;
}
