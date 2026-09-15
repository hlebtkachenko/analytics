import { describe, expect, it } from 'vitest';

import { safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it('keeps a same-origin path with its query string', () => {
    expect(safeReturnPath('/documents/analytics?organization=x')).toBe(
      '/documents/analytics?organization=x',
    );
  });

  it('refuses a protocol-relative path', () => {
    expect(safeReturnPath('//evil.example')).toBe('/access');
  });

  it('refuses an absolute URL', () => {
    expect(safeReturnPath('https://evil.example')).toBe('/access');
  });

  it('refuses a backslash path a browser may normalize', () => {
    expect(safeReturnPath('/\\evil')).toBe('/access');
  });

  it('falls back when the value is absent or empty', () => {
    expect(safeReturnPath(null)).toBe('/access');
    expect(safeReturnPath('')).toBe('/access');
  });

  it('refuses an over long value', () => {
    expect(safeReturnPath(`/${'a'.repeat(2048)}`)).toBe('/access');
  });
});
