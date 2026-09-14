import type { ThemeMode } from '@bap/design-system/theme';
import { cookies } from 'next/headers';

import {
  railCookieName,
  railPinnedValue,
  themeCookieName,
  themeModeSchema,
} from './cookies';

// Reads the theme mode from its cookie; anything invalid or absent means system.
export async function readThemeMode(): Promise<ThemeMode> {
  const value = (await cookies()).get(themeCookieName)?.value;
  const parsed = themeModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'system';
}

// The rail is only pinned open when its cookie explicitly says so.
export async function readRailPinned(): Promise<boolean> {
  return (await cookies()).get(railCookieName)?.value === railPinnedValue;
}
