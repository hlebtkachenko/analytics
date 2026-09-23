import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('employee relationship BFF route module', () => {
  it('exports GET and POST through the exact relationship BFF functions', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/relationships/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function POST');
    expect(source).toContain('getEmployeeRelationships');
    expect(source).toContain('postEmployeeRelationship');
    expect(source).toContain('getAuth');
  });
});
