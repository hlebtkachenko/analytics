import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('employee documents BFF route module', () => {
  it('exports GET and POST through the fixed document functions', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/documents/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('getEmployeeDocuments');
    expect(source).toContain('postEmployeeDocument');
  });
  it('exports PATCH through the fixed document path function', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/documents/[documentId]/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function PATCH');
    expect(source).toContain('patchEmployeeDocument');
  });
});
