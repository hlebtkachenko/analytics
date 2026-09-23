import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const postPayrollImportConsume = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../../lib/auth/bff', () => ({
  postPayrollImportConsume,
}));
vi.mock('../../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { POST } from './route';

describe('payroll import consume BFF route', () => {
  it('delegates the fixed organization and import identifiers', async () => {
    const request = new Request('https://bap.invalid', { method: 'POST' });
    const response = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    postPayrollImportConsume.mockResolvedValue(response);
    expect(
      await POST(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          importId: '00000000-0000-4000-8000-000000000001',
        }),
      }),
    ).toBe(response);
    expect(postPayrollImportConsume).toHaveBeenCalledWith(
      { marker: 'auth' },
      request,
      'org_1',
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
