import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const getPayrollComponents = vi.hoisted(() => vi.fn());
const postPayrollComponent = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../lib/auth/bff', () => ({
  getPayrollComponents,
  postPayrollComponent,
}));
vi.mock('../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET, POST } from './route';

describe('payroll components BFF route', () => {
  it('forwards GET and POST with the exact organization id', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request('https://bap.invalid/payroll/components');
    const context = { params: Promise.resolve({ organizationId: 'org_1' }) };
    const getResponse = Response.json({});
    const postResponse = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue(auth);
    getPayrollComponents.mockResolvedValue(getResponse);
    postPayrollComponent.mockResolvedValue(postResponse);
    expect(await GET(request, context)).toBe(getResponse);
    expect(await POST(request, context)).toBe(postResponse);
    expect(getPayrollComponents).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
    );
    expect(postPayrollComponent).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
    );
  });
});
