import { themeModes } from '@bap/design-system/theme';
import { z } from 'zod';

// Preference cookies hold only enum values, are not secrets, and grant nothing.
export const themeCookieName = 'bap_theme';
export const railCookieName = 'bap_rail';
export const railPinnedValue = 'pinned';

export const themeModeSchema = z.enum(themeModes);

// One year; a preference has no reason to expire sooner.
const preferenceMaxAge = 60 * 60 * 24 * 365;

// Client-only writer: a value persists the preference, null clears it.
export function writePreferenceCookie(
  name: string,
  value: string | null,
): void {
  const maxAge = value === null ? 0 : preferenceMaxAge;
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${name}=${value ?? ''}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
