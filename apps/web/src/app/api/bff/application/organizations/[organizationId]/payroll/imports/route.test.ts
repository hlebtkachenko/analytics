import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const postPayrollImport = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../lib/auth/bff', () => ({ postPayrollImport }));
vi.mock('../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { POST } from './route';

describe('payroll import create BFF route', () => {
  it('delegates the fixed organization route', async () => {
    const request = new Request('https://bap.invalid', { method: 'POST' });
    const response = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    postPayrollImport.mockResolvedValue(response);
    expect(
      await POST(request, {
        params: Promise.resolve({ organizationId: 'org_1' }),
      }),
    ).toBe(response);
    expect(postPayrollImport).toHaveBeenCalledWith(
      { marker: 'auth' },
      request,
      'org_1',
    );
  });
});
