import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const patchPayrollAccountMapping = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  patchPayrollAccountMapping,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { PATCH } from './route';

describe('payroll account mapping BFF route', () => {
  it('forwards PATCH with exact organization and mapping ids', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request(
      'https://bap.invalid/payroll/account-mappings/mapping_1',
      { method: 'PATCH' },
    );
    const response = Response.json({});
    getAuth.mockResolvedValue(auth);
    patchPayrollAccountMapping.mockResolvedValue(response);
    expect(
      await PATCH(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          mappingId: 'mapping_1',
        }),
      }),
    ).toBe(response);
    expect(patchPayrollAccountMapping).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'mapping_1',
    );
  });
});
