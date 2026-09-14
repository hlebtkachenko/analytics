import type { ReactNode } from 'react';

import ProductShell from '../../components/shell/product-shell';
import { readRailPinned } from '../../lib/preferences/server';

type ProductLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default async function ProductLayout({
  children,
}: ProductLayoutProperties) {
  const railPinned = await readRailPinned();

  return <ProductShell railPinned={railPinned}>{children}</ProductShell>;
}
