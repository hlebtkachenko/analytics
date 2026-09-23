import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('status-transitions BFF route module', () => {
  it('exports POST and delegates to the exact status-transition BFF function', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/status-transitions/route.ts',
      ),
      'utf8',
    );
    expect(source).toContain('export async function POST');
    expect(source).toContain('postEmployeeStatusTransition');
    expect(source).toContain('getAuth');
  });
});
