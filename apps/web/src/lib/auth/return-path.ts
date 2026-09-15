// The default landing page whenever no safe same-origin return path was given.
export const defaultReturnPath = '/access';

const maximumReturnPathLength = 2048;

// A return path is honoured only when it stays on this origin: one leading
// slash, no scheme, no backslash, and no absurd length.
export function safeReturnPath(value: string | null): string {
  if (value === null || value.length === 0) {
    return defaultReturnPath;
  }
  if (value.length > maximumReturnPathLength) {
    return defaultReturnPath;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return defaultReturnPath;
  }
  if (value.includes('\\')) {
    return defaultReturnPath;
  }
  return value;
}
