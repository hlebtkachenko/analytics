import { describe, expect, it, vi } from 'vitest';

import { postPayrollImport } from './bff';
import type { BffAuth } from './bff';

const auth: BffAuth = {
  getSession: vi
    .fn()
    .mockResolvedValue({ user: { emailVerified: true, id: 'user_1' } }),
  signJWT: vi.fn().mockResolvedValue({ token: 'resource-token' }),
};
const id = '123e4567-e89b-42d3-a456-426614174000';
describe('payroll import BFF', () => {
  it('refuses an oversized multipart file before minting a token', async () => {
    const body = new FormData();
    body.set('file', new File([new Uint8Array(5_000_001)], 'import.csv'));
    body.set('legalEntityId', id);
    body.set('payrollMonth', '2026-09-01');
    const result = await postPayrollImport(
      auth,
      new Request('https://bap.invalid', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': id },
      }),
      'org_1',
    );
    expect(result.status).toBe(400);
  });
});
