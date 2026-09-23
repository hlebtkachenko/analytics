import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('employment-term BFF route module', () => {
  it('exports GET and POST and delegates to the exact employment-term BFF functions', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/employment-terms/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function POST');
    expect(source).toContain('getEmploymentTerms');
    expect(source).toContain('postEmploymentTerm');
    expect(source).toContain('getAuth');
  });
});
