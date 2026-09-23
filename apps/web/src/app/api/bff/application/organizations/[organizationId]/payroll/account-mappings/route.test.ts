import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const getPayrollAccountMappings = vi.hoisted(() => vi.fn());
const postPayrollAccountMapping = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../lib/auth/bff', () => ({
  getPayrollAccountMappings,
  postPayrollAccountMapping,
}));
vi.mock('../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET, POST } from './route';

describe('payroll account mappings BFF route', () => {
  it('forwards GET and POST with the exact organization id', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request('https://bap.invalid/payroll/account-mappings');
    const context = { params: Promise.resolve({ organizationId: 'org_1' }) };
    const getResponse = Response.json({});
    const postResponse = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue(auth);
    getPayrollAccountMappings.mockResolvedValue(getResponse);
    postPayrollAccountMapping.mockResolvedValue(postResponse);
    expect(await GET(request, context)).toBe(getResponse);
    expect(await POST(request, context)).toBe(postResponse);
    expect(getPayrollAccountMappings).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
    );
    expect(postPayrollAccountMapping).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
    );
  });
});
