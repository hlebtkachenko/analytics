import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const getPayrollImport = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  getPayrollImport,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET } from './route';

describe('payroll import status BFF route', () => {
  it('delegates the fixed organization and import identifiers', async () => {
    const request = new Request('https://bap.invalid');
    const response = Response.json({});
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    getPayrollImport.mockResolvedValue(response);
    expect(
      await GET(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          importId: '00000000-0000-4000-8000-000000000001',
        }),
      }),
    ).toBe(response);
    expect(getPayrollImport).toHaveBeenCalledWith(
      { marker: 'auth' },
      request,
      'org_1',
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
