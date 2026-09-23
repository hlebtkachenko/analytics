import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const patchPayrollComponent = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  patchPayrollComponent,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { PATCH } from './route';

describe('payroll component BFF route', () => {
  it('forwards PATCH with exact organization and component ids', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request(
      'https://bap.invalid/payroll/components/component_1',
      { method: 'PATCH' },
    );
    const response = Response.json({});
    getAuth.mockResolvedValue(auth);
    patchPayrollComponent.mockResolvedValue(response);
    expect(
      await PATCH(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          componentId: 'component_1',
        }),
      }),
    ).toBe(response);
    expect(patchPayrollComponent).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'component_1',
    );
  });
});
