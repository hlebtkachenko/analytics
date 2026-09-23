import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(
  process.cwd(),
  'src/app/api/bff/application/organizations/[organizationId]/my-hr',
);
const routes = [
  ['access/route.ts', ['GET'], ['getMyHrAccess']],
  ['profile/route.ts', ['GET'], ['getMyHrProfile']],
  ['documents/route.ts', ['GET'], ['getMyHrDocuments']],
  ['payslips/route.ts', ['GET'], ['getMyHrPayslips']],
  [
    'timesheets/route.ts',
    ['GET', 'POST'],
    ['getMyHrTimesheets', 'postMyHrTimesheet'],
  ],
  ['timesheets/[timesheetId]/route.ts', ['PATCH'], ['patchMyHrTimesheet']],
  [
    'timesheets/[timesheetId]/submit/route.ts',
    ['POST'],
    ['postMyHrTimesheetSubmit'],
  ],
  ['leave-types/route.ts', ['GET'], ['getMyHrLeaveTypes']],
  [
    'leave-requests/route.ts',
    ['GET', 'POST'],
    ['getMyHrLeaveRequests', 'postMyHrLeaveRequest'],
  ],
  [
    'leave-requests/[requestId]/cancel/route.ts',
    ['POST'],
    ['postMyHrLeaveRequestCancel'],
  ],
] as const;

describe('My HR BFF route inventory', () => {
  it.each(routes)(
    '%s delegates only through its fixed auth BFF handler',
    (route, methods, delegates) => {
      const source = readFileSync(join(root, route), 'utf8');
      for (const method of methods)
        expect(source).toContain(`export async function ${method}`);
      for (const delegate of delegates) expect(source).toContain(delegate);
      expect(source).toContain('getAuth');
      expect(source).not.toContain('fetch(');
    },
  );
});
