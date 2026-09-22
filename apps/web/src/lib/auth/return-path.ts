// The default landing page whenever no safe same-origin return path was given.
export const defaultReturnPath = '/workspaces';

const maximumReturnPathLength = 2048;

// Resolving against an unroutable origin exposes what a browser would really navigate to.
const returnOrigin = 'https://return.invalid';

// Routes that cannot be the destination of a signed in session, mirroring app/(identity).
const refusedPrefixes = [
  '/activate',
  '/api',
  '/forgot-password',
  '/reset-password',
  '/sign-in',
  '/sign-up',
  '/welcome',
];

// A browser strips tab, newline and their kin before parsing, so such a path is never honoured.
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isRefused(pathname: string): boolean {
  return refusedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// A return path is honoured only when a browser would keep it on this origin.
export function safeReturnPath(value: string | null): string {
  if (value === null || value.length === 0) {
    return defaultReturnPath;
  }
  if (value.length > maximumReturnPathLength) {
    return defaultReturnPath;
  }
  if (hasControlCharacter(value)) {
    return defaultReturnPath;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return defaultReturnPath;
  }
  if (value.includes('\\')) {
    return defaultReturnPath;
  }

  let resolved: URL;
  try {
    resolved = new URL(value, returnOrigin);
  } catch {
    return defaultReturnPath;
  }
  if (resolved.origin !== returnOrigin) {
    return defaultReturnPath;
  }
  // Dot segments can still collapse into a protocol-relative path, so the result is checked too.
  if (resolved.pathname.startsWith('//')) {
    return defaultReturnPath;
  }
  if (isRefused(resolved.pathname)) {
    return defaultReturnPath;
  }
  return `${resolved.pathname}${resolved.search}`;
}

// The one sign-in link builder, so every caller validates the return path the same way.
export function signInPath(returnPath: string | null): string {
  const safe = safeReturnPath(returnPath);
  return safe === defaultReturnPath
    ? '/sign-in'
    : `/sign-in?next=${encodeURIComponent(safe)}`;
}

// The challenge page finishes the trip, so it has to carry the return path too.
export function twoFactorPath(returnPath: string | null): string {
  const safe = safeReturnPath(returnPath);
  return safe === defaultReturnPath
    ? '/sign-in/two-factor'
    : `/sign-in/two-factor?next=${encodeURIComponent(safe)}`;
}
