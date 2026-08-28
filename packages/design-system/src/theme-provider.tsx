'use client';

import { GlobalTheme } from '@carbon/react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import type { CarbonTheme } from './tokens.js';

type DesignSystemProviderProperties = Readonly<{
  children: ReactNode;
  theme: CarbonTheme;
}>;

export function DesignSystemProvider({
  children,
  theme,
}: DesignSystemProviderProperties) {
  useEffect(() => {
    document.documentElement.dataset.carbonTheme = theme;
  }, [theme]);

  return <GlobalTheme theme={theme}>{children}</GlobalTheme>;
}
