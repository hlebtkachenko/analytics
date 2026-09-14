'use client';

import { GlobalTheme, usePrefersDarkScheme } from '@carbon/react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { CarbonTheme } from './tokens.js';

export const themeModes = ['light', 'dark', 'system'] as const;

export type ThemeMode = (typeof themeModes)[number];

// Light maps to White, dark to Gray 100; system follows the OS preference.
export function resolveCarbonTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): CarbonTheme {
  if (mode === 'light') {
    return 'white';
  }
  if (mode === 'dark') {
    return 'g100';
  }
  return prefersDark ? 'g100' : 'white';
}

type ThemeModeContextValue = Readonly<{
  mode: ThemeMode;
  resolvedTheme: CarbonTheme;
  setMode: (mode: ThemeMode) => void;
}>;

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(
  undefined,
);

export function useThemeMode(): ThemeModeContextValue {
  const value = useContext(ThemeModeContext);
  if (value === undefined) {
    throw new Error('useThemeMode must be used within a DesignSystemProvider');
  }
  return value;
}

type DesignSystemProviderProperties = Readonly<{
  children: ReactNode;
  // An explicit theme wins and disables mode resolution; the workbench uses it.
  theme?: CarbonTheme;
  mode?: ThemeMode;
}>;

export function DesignSystemProvider({
  children,
  theme,
  mode: initialMode = 'system',
}: DesignSystemProviderProperties) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const prefersDark = usePrefersDarkScheme();
  const resolvedTheme = theme ?? resolveCarbonTheme(mode, prefersDark);

  useEffect(() => {
    document.documentElement.dataset.carbonTheme = resolvedTheme;
  }, [resolvedTheme]);

  const contextValue = useMemo<ThemeModeContextValue>(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme],
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <GlobalTheme theme={resolvedTheme}>{children}</GlobalTheme>
    </ThemeModeContext.Provider>
  );
}
