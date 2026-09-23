import { describe, expect, it, vi } from 'vitest';
const getAuth = vi.hoisted(() => vi.fn());
const getPayrollRunApprovals = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  getPayrollRunApprovals,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET } from './route';
describe('payroll approvals BFF route', () => {
  it('delegates GET', async () => {
    const response = Response.json({});
    const request = new Request('https://bap.invalid');
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    getPayrollRunApprovals.mockResolvedValue(response);
    expect(
      await GET(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          payrollRunId: '00000000-0000-4000-8000-000000000001',
        }),
      }),
    ).toBe(response);
    expect(getPayrollRunApprovals).toHaveBeenCalledWith(
      { marker: 'auth' },
      request,
      'org_1',
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
