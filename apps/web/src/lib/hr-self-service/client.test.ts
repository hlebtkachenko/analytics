import { describe, expect, it } from 'vitest';

import {
  myHrDocumentsPath,
  myHrLeaveRequestsPath,
  myHrLeaveTypesPath,
  myHrPayslipsPath,
  myHrTimesheetsPath,
} from './client';

describe('my HR client paths', () => {
  const organizationId = 'organization_1';
  it('uses fixed own-resource paths without employee or entity selectors', () => {
    expect(myHrDocumentsPath(organizationId, { page: 2 })).toBe(
      '/api/bff/application/organizations/organization_1/my-hr/documents?page=2',
    );
    expect(
      myHrPayslipsPath(organizationId, { fromMonth: '2026-01' }),
    ).toContain('/my-hr/payslips?fromMonth=2026-01');
    expect(myHrTimesheetsPath(organizationId)).toContain('/my-hr/timesheets');
    expect(myHrLeaveTypesPath(organizationId, { q: 'annual' })).toContain(
      '/my-hr/leave-types?q=annual',
    );
    expect(myHrLeaveRequestsPath(organizationId)).toContain(
      '/my-hr/leave-requests',
    );
  });
});
