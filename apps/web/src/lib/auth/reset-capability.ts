export const resetCapabilityCookieName = 'bap_reset_capability';
export const resetCapabilityCookiePath = '/reset-password';
export const resetCapabilityLifetimeSeconds = 30 * 60;

const resetCapabilityPattern = /^[A-Za-z0-9]{24}$/;

export function isValidResetCapability(value: unknown): value is string {
  return typeof value === 'string' && resetCapabilityPattern.test(value);
}

// Safari drops Secure cookies on http:// origins (e.g. the local demo stack),
// so secure must follow the configured public origin, never NODE_ENV alone.
export function cookieSecureForOrigin(origin: string): boolean {
  return new URL(origin).protocol === 'https:';
}

export function resetCapabilityCookieOptions(publicOrigin: string) {
  return {
    httpOnly: true,
    maxAge: resetCapabilityLifetimeSeconds,
    path: resetCapabilityCookiePath,
    sameSite: 'lax' as const,
    secure: cookieSecureForOrigin(publicOrigin),
  };
}
