import { describe, expect, it, vi } from 'vitest';
const getAuth = vi.hoisted(() => vi.fn());
const postPayrollRunFinalization = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  postPayrollRunFinalization,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { POST } from './route';
describe('finalize payroll BFF route', () => {
  it('delegates POST', async () => {
    const response = Response.json({});
    const request = new Request('https://bap.invalid', { method: 'POST' });
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    postPayrollRunFinalization.mockResolvedValue(response);
    expect(
      await POST(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          payrollRunId: '00000000-0000-4000-8000-000000000001',
        }),
      }),
    ).toBe(response);
    expect(postPayrollRunFinalization).toHaveBeenCalledWith(
      { marker: 'auth' },
      request,
      'org_1',
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
