import { describe, expect, it } from 'vitest';

import {
  railCookieName,
  themeCookieName,
  themeModeSchema,
  writePreferenceCookie,
} from './cookies';

describe('themeModeSchema', () => {
  it('accepts the three modes and rejects anything else', () => {
    expect(themeModeSchema.safeParse('system').success).toBe(true);
    expect(themeModeSchema.safeParse('light').success).toBe(true);
    expect(themeModeSchema.safeParse('dark').success).toBe(true);
    expect(themeModeSchema.safeParse('sepia').success).toBe(false);
    expect(themeModeSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('writePreferenceCookie', () => {
  it('persists a value under the given name', () => {
    writePreferenceCookie(themeCookieName, 'dark');
    expect(document.cookie).toContain(`${themeCookieName}=dark`);
  });

  it('clears the cookie when the value is null', () => {
    writePreferenceCookie(railCookieName, 'pinned');
    expect(document.cookie).toContain(`${railCookieName}=pinned`);

    writePreferenceCookie(railCookieName, null);
    expect(document.cookie).not.toContain(`${railCookieName}=pinned`);
  });
});
