import { describe, expect, it, vi } from 'vitest';

const deleteHrAccessAssignment = vi.hoisted(() => vi.fn());
const getAuth = vi.hoisted(() => vi.fn());

vi.mock('../../../../../../../../../lib/auth/bff', () => ({
  deleteHrAccessAssignment,
}));
vi.mock('../../../../../../../../../lib/auth/server', () => ({ getAuth }));

import { DELETE } from './route';

describe('HR access assignment item BFF route', () => {
  it('forwards DELETE with the exact organization and assignment identifiers', async () => {
    const auth = { api: { marker: 'auth' } };
    const response = Response.json({ revoked: true });
    const request = new Request('https://bap.invalid/access-assignments/id', {
      method: 'DELETE',
    });
    getAuth.mockResolvedValue(auth);
    deleteHrAccessAssignment.mockResolvedValue(response);

    expect(
      await DELETE(request, {
        params: Promise.resolve({
          assignmentId: 'assignment_1',
          organizationId: 'org_1',
        }),
      }),
    ).toBe(response);
    expect(deleteHrAccessAssignment).toHaveBeenCalledWith(
      auth.api,
      request,
      'org_1',
      'assignment_1',
    );
  });
});
