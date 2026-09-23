import { describe, expect, it, vi } from 'vitest';

const getAuth = vi.hoisted(() => vi.fn());
const getHrAccessAssignments = vi.hoisted(() => vi.fn());
const postHrAccessAssignment = vi.hoisted(() => vi.fn());

vi.mock('../../../../../../../../lib/auth/bff', () => ({
  getHrAccessAssignments,
  postHrAccessAssignment,
}));
vi.mock('../../../../../../../../lib/auth/server', () => ({ getAuth }));

import { GET, POST } from './route';

describe('HR access assignment collection BFF route', () => {
  it('forwards GET and POST with the exact organization identifier', async () => {
    const auth = { api: { marker: 'auth' } };
    const getResponse = Response.json({ assignments: [] });
    const postResponse = Response.json({}, { status: 201 });
    getAuth.mockResolvedValue(auth);
    getHrAccessAssignments.mockResolvedValue(getResponse);
    postHrAccessAssignment.mockResolvedValue(postResponse);
    const context = { params: Promise.resolve({ organizationId: 'org_1' }) };
    const getRequest = new Request('https://bap.invalid/access-assignments');
    const postRequest = new Request('https://bap.invalid/access-assignments', {
      body: '{}',
      method: 'POST',
    });

    expect(await GET(getRequest, context)).toBe(getResponse);
    expect(await POST(postRequest, context)).toBe(postResponse);
    expect(getHrAccessAssignments).toHaveBeenCalledWith(
      auth.api,
      getRequest,
      'org_1',
    );
    expect(postHrAccessAssignment).toHaveBeenCalledWith(
      auth.api,
      postRequest,
      'org_1',
    );
  });
});
