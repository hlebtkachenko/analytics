export const resetCapabilityCookieName = 'bap_reset_capability';
export const resetCapabilityCookiePath = '/reset-password';
export const resetCapabilityLifetimeSeconds = 30 * 60;

const resetCapabilityPattern = /^[A-Za-z0-9]{24}$/;

export function isValidResetCapability(value: unknown): value is string {
  return typeof value === 'string' && resetCapabilityPattern.test(value);
}

export function resetCapabilityCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    maxAge: resetCapabilityLifetimeSeconds,
    path: resetCapabilityCookiePath,
    sameSite: 'lax' as const,
    secure: production,
  };
}
