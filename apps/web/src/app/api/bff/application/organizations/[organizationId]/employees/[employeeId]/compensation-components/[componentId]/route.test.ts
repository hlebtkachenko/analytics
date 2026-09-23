import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const patchEmployeeCompensationComponent = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../../lib/auth/bff', () => ({
  patchEmployeeCompensationComponent,
}));
vi.mock('../../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { PATCH } from './route';

describe('employee compensation component BFF route', () => {
  it('forwards PATCH with exact organization, employee and component ids', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request(
      'https://bap.invalid/compensation-components/component_1',
      { method: 'PATCH' },
    );
    const response = Response.json({});
    getAuth.mockResolvedValue(auth);
    patchEmployeeCompensationComponent.mockResolvedValue(response);
    expect(
      await PATCH(request, {
        params: Promise.resolve({
          organizationId: 'org_1',
          employeeId: 'employee_1',
          componentId: 'component_1',
        }),
      }),
    ).toBe(response);
    expect(patchEmployeeCompensationComponent).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'employee_1',
      'component_1',
    );
  });
});
