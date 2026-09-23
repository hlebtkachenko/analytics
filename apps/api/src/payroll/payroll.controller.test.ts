import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PayrollController } from './payroll.controller.js';
import { PayrollConflictError } from './payroll-repository.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const result = {
  employeeId: entityId,
  grossPay: '100',
  employeeSocial: '0',
  employeeHealth: '0',
  incomeTax: '0',
  otherDeductions: '0',
  netPay: '100',
  employerSocial: '0',
  employerHealth: '0',
  totalEmployerCost: '100',
};
const run = {
  id: runId,
  legalEntityId: entityId,
  documentId: null,
  month: '2026-09',
  version: 1,
  supersedesPayrollRunId: null,
  status: 'draft' as const,
  origin: 'calculated' as const,
  validationSummary: { valid: false, issues: [] },
  approvedBy: null,
  approvedAt: null,
  finalizedBy: null,
  finalizedAt: null,
  paidBy: null,
  paidAt: null,
  paymentReference: null,
  ruleSetId: null,
  createdAt: '2026-09-21T00:00:00.000Z',
  results: [result],
};
function controller(repository: Record<string, unknown>) {
  const api = new PayrollController(repository as never, {} as never);
  const scope = vi
    .spyOn(
      api as unknown as { scope: (...args: unknown[]) => Promise<unknown> },
      'scope',
    )
    .mockImplementation(async (...args: unknown[]) => ({
      capability: args[2],
      legalEntityIds: null,
      organizationId: 'org',
      role: 'owner',
      userId: 'user',
    }));
  return { api, scope };
}

describe('payroll run controller', () => {
  it('uses readPayroll for employee payroll history and maps invisible employees to 404', async () => {
    const repository = {
      listEmployeePayrollResults: vi.fn().mockResolvedValue({
        items: [
          {
            payrollRunId: runId,
            legalEntityId: entityId,
            month: '2026-09',
            version: 1,
            supersedesPayrollRunId: null,
            status: 'draft',
            origin: 'calculated',
            grossPay: '100',
            employeeSocial: '0',
            employeeHealth: '0',
            incomeTax: '0',
            otherDeductions: '0',
            netPay: '100',
            employerSocial: '0',
            employerHealth: '0',
            totalEmployerCost: '100',
            payslipDocumentId: null,
            finalizedAt: null,
            paidAt: null,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
    };
    const { api, scope } = controller(repository);
    await expect(
      api.listEmployeePayrollResults(
        'org',
        entityId,
        { page: 1, pageSize: 25 },
        {} as never,
      ),
    ).resolves.toMatchObject({ total: 1 });
    expect(scope).toHaveBeenCalledWith('org', expect.anything(), 'readPayroll');
    expect(repository.listEmployeePayrollResults).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: entityId }),
    );
    const missing = controller({
      listEmployeePayrollResults: vi.fn().mockResolvedValue(null),
    });
    await expect(
      missing.api.listEmployeePayrollResults(
        'org',
        entityId,
        { page: 1, pageSize: 25 },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('uses readPayroll for list, detail, approvals, and liabilities', async () => {
    const repository = {
      approvals: vi.fn().mockResolvedValue([
        {
          action: 'approved',
          reason: null,
          actor_user_id: 'approver',
          acted_at: new Date('2026-09-21T00:00:00.000Z'),
        },
      ]),
      liabilities: vi.fn().mockResolvedValue([]),
      listRuns: vi
        .fn()
        .mockResolvedValue({ items: [run], page: 1, pageSize: 25, total: 1 }),
      readRun: vi.fn().mockResolvedValue(run),
    };
    const { api, scope } = controller(repository);
    await api.listRuns('org', { page: 1, pageSize: 25 }, {} as never);
    await api.readRun('org', runId, {} as never);
    await expect(api.approvals('org', runId, {} as never)).resolves.toEqual({
      approvals: [
        {
          action: 'approved',
          reason: null,
          actor: 'approver',
          actedAt: '2026-09-21T00:00:00.000Z',
        },
      ],
    });
    await api.liabilities('org', runId, {} as never);
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'readPayroll',
      'readPayroll',
      'readPayroll',
      'readPayroll',
    ]);
  });

  it('uses managePayroll for creation and its six management commands, and approvePayroll only for approval', async () => {
    const repository = {
      command: vi.fn().mockResolvedValue(run),
      createRun: vi.fn().mockResolvedValue(run),
    };
    const { api, scope } = controller(repository);
    const body = {
      legalEntityId: entityId,
      month: '2026-09',
      results: [result],
    };
    await api.createRun('org', key, body, {} as never);
    await api.validate('org', runId, key, {}, {} as never);
    await api.submit('org', runId, key, {}, {} as never);
    await api.reject('org', runId, key, { reason: 'Reason' }, {} as never);
    await api.finalize('org', runId, key, {}, {} as never);
    await api.payment(
      'org',
      runId,
      key,
      { paidAt: '2026-09-21T00:00:00.000Z', paymentReference: 'Payment' },
      {} as never,
    );
    await api.correction('org', runId, key, { reason: 'Reason' }, {} as never);
    await api.approve('org', runId, key, {}, {} as never);
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'managePayroll',
      'managePayroll',
      'managePayroll',
      'managePayroll',
      'managePayroll',
      'managePayroll',
      'managePayroll',
      'approvePayroll',
    ]);
    expect(
      repository.command.mock.calls.map((call) => call[0].command),
    ).toEqual([
      'validate',
      'submit',
      'reject',
      'finalize',
      'record_payment',
      'correct',
      'approve',
    ]);
  });

  it('rejects malformed idempotency keys before a repository mutation', async () => {
    const repository = { createRun: vi.fn(), command: vi.fn() };
    const { api } = controller(repository);
    await expect(
      api.createRun(
        'org',
        'not-a-uuid',
        { legalEntityId: entityId, month: '2026-09', results: [result] },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      api.validate('org', runId, undefined, {}, {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createRun).not.toHaveBeenCalled();
    expect(repository.command).not.toHaveBeenCalled();
  });

  it('maps invisible runs to 404 and serialized command conflicts to 409', async () => {
    const missing = controller({ readRun: vi.fn().mockResolvedValue(null) });
    await expect(
      missing.api.readRun('org', runId, {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    const conflicted = controller({
      command: vi.fn().mockRejectedValue(new PayrollConflictError()),
    });
    await expect(
      conflicted.api.validate('org', runId, key, {}, {} as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
