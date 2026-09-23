import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HrTimeRequestError,
  absencesPath,
  leaveRequestsPath,
  leaveTypesPath,
  listAbsences,
  listLeaveRequests,
  listLeaveTypes,
  listSchedules,
  listTimesheets,
  schedulesPath,
  timesheetsPath,
} from './client';

const id = '00000000-0000-4000-8000-000000000901';
afterEach(() => vi.unstubAllGlobals());
describe('hr-time client', () => {
  it('encodes all list query families', () => {
    expect(schedulesPath('org_1', id, { status: 'draft', page: 2 })).toBe(
      `/api/bff/application/organizations/org_1/employees/${id}/schedules?status=draft&page=2`,
    );
    expect(timesheetsPath('org_1', id, { from: '2026-01-01' })).toContain(
      'from=2026-01-01',
    );
    expect(leaveTypesPath('org_1', { q: 'Annual leave' })).toContain(
      'q=Annual+leave',
    );
    expect(leaveRequestsPath('org_1', id, { status: 'requested' })).toContain(
      'status=requested',
    );
    expect(absencesPath('org_1', id, { kind: 'sickness' })).toContain(
      'kind=sickness',
    );
  });
  it('uses no-store GET requests and exposes response statuses', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store' });
      return Response.json({}, { status: 409 });
    });
    vi.stubGlobal('fetch', fetchImplementation);
    for (const operation of [
      () => listSchedules('org_1', id),
      () => listTimesheets('org_1', id),
      () => listLeaveTypes('org_1'),
      () => listLeaveRequests('org_1', id),
      () => listAbsences('org_1', id),
    ])
      await expect(operation()).rejects.toEqual(
        expect.objectContaining({ status: 409 }),
      );
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });
  it('rejects local malformed bodies before fetch', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>());
    await expect(
      import('./client').then(({ createSchedule }) =>
        createSchedule('org_1', id, { relationshipId: 'bad' } as never),
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a stable request error', () =>
    expect(new HrTimeRequestError(401).status).toBe(401));
});
