import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('employee payroll-results BFF route module', () => {
  it('exports GET and delegates to the exact payroll-results BFF function', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/payroll-results/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('getEmployeePayrollResults');
    expect(source).toContain('getAuth');
  });
});
