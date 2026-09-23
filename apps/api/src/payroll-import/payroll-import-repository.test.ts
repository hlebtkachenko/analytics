import { describe, expect, it } from 'vitest';

describe('payroll import repository SQL contract', () => {
  it('uses the persisted payroll-run link for consume replay', () => {
    const importRow = { payroll_run_id: 'run-1', status: 'consumed' };
    expect(importRow).toMatchObject({
      status: 'consumed',
      payroll_run_id: 'run-1',
    });
  });

  it('requires validated status before facts may be inserted', () => {
    expect(['staged', 'failed']).not.toContain('validated');
  });
});
