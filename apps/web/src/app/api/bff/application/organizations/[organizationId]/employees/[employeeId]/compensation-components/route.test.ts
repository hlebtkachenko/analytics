import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const getEmployeeCompensationComponents = vi.hoisted(() => vi.fn());
const postEmployeeCompensationComponent = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  getEmployeeCompensationComponents,
  postEmployeeCompensationComponent,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));
import { GET, POST } from './route';

describe('employee compensation components BFF route', () => {
  it('forwards GET and POST with exact organization and employee ids', async () => {
    const auth = { api: { marker: 'auth' } };
    const request = new Request('https://bap.invalid/compensation-components');
    const context = {
      params: Promise.resolve({
        organizationId: 'org_1',
        employeeId: 'employee_1',
      }),
    };
    const getResponse = Response.json({});
    const postResponse = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue(auth);
    getEmployeeCompensationComponents.mockResolvedValue(getResponse);
    postEmployeeCompensationComponent.mockResolvedValue(postResponse);
    expect(await GET(request, context)).toBe(getResponse);
    expect(await POST(request, context)).toBe(postResponse);
    expect(getEmployeeCompensationComponents).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'employee_1',
    );
    expect(postEmployeeCompensationComponent).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'employee_1',
    );
  });
});
