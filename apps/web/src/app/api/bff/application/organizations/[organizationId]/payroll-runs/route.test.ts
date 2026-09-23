import { describe, expect, it, vi } from 'vitest';
const getAuth = vi.hoisted(() => vi.fn());
const getPayrollRuns = vi.hoisted(() => vi.fn());
const postPayrollRun = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../lib/auth/bff', () => ({
  getPayrollRuns,
  postPayrollRun,
}));
vi.mock('../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET, POST } from './route';
describe('payroll runs BFF route', () => {
  it('delegates collection GET and POST', async () => {
    const response = Response.json({});
    getAuth.mockResolvedValue({ api: { marker: 'auth' } });
    getPayrollRuns.mockResolvedValue(response);
    postPayrollRun.mockResolvedValue(response);
    const context = { params: Promise.resolve({ organizationId: 'org_1' }) };
    const get = new Request('https://bap.invalid', { method: 'GET' });
    const post = new Request('https://bap.invalid', { method: 'POST' });
    expect(await GET(get, context)).toBe(response);
    expect(await POST(post, context)).toBe(response);
    expect(getPayrollRuns).toHaveBeenCalledWith(
      { marker: 'auth' },
      get,
      'org_1',
    );
    expect(postPayrollRun).toHaveBeenCalledWith(
      { marker: 'auth' },
      post,
      'org_1',
    );
  });
});
