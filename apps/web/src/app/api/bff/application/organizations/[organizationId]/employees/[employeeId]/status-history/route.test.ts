import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('status-history BFF route module', () => {
  it('exports GET and delegates to the exact status-history BFF function', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/status-history/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('getEmployeeStatusHistory');
    expect(source).toContain('getAuth');
  });
});
