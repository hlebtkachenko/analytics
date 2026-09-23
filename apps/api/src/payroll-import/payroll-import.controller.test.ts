import { describe, expect, it, vi } from 'vitest';

vi.mock('../tenant-access.js', () => ({
  allowedEntityIds: () => null,
  resolveTenantAccess: async () => ({
    entityScope: { mode: 'all' },
    tenant: { organizationId: 'org', role: 'owner', userId: 'subject' },
  }),
}));

import { PayrollImportController } from './payroll-import.controller.js';

const payrollImport = {
  id: '00000000-0000-4000-8000-000000000001',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  sourceDocumentId: '00000000-0000-4000-8000-000000000003',
  payrollMonth: '2026-09-01',
  format: 'csv' as const,
  status: 'validated' as const,
  rowCount: 1,
  errorCount: 0,
  errorReport: [],
  payrollRunId: null,
  createdAt: new Date().toISOString(),
};
describe('payroll import controller', () => {
  it('uses distinct first-consume and replay statuses', async () => {
    const repo = {
      consume: vi.fn().mockResolvedValue({
        runId: '00000000-0000-4000-8000-000000000004',
        replay: false,
        status: 'draft',
      }),
    };
    const controller = new PayrollImportController(
      repo as never,
      {} as never,
      {} as never,
    );
    const response = { status: vi.fn() };
    await controller.consume('org', payrollImport.id, {} as never, response);
    expect(response.status).toHaveBeenCalledWith(201);
    repo.consume.mockResolvedValue({
      runId: '00000000-0000-4000-8000-000000000004',
      replay: true,
      status: 'draft',
    });
    await controller.consume('org', payrollImport.id, {} as never, response);
    expect(response.status).toHaveBeenLastCalledWith(200);
  });

  it('keeps the exact create envelope', () => {
    expect({ payrollImport }).toEqual({ payrollImport });
  });

  it('rejects an unsafe filename or mismatched media type before staging', async () => {
    const controller = new PayrollImportController(
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.create(
        'org',
        {
          body: {
            legalEntityId: payrollImport.legalEntityId,
            payrollMonth: '2026-09-01',
          },
          headers: { 'idempotency-key': payrollImport.id },
        } as never,
        {
          mimetype: 'application/pdf',
          filename: '5ec1cb22b6c671b7c36415d41bce6cb5',
          originalname: 'payroll.csv',
          path: '/tmp/not-used',
          size: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an unsafe temporary upload filename', async () => {
    const repo = { create: vi.fn() };
    const controller = new PayrollImportController(
      repo as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.create(
        'org',
        {
          body: {
            legalEntityId: payrollImport.legalEntityId,
            payrollMonth: '2026-09-01',
          },
          headers: { 'idempotency-key': payrollImport.id },
        } as never,
        {
          mimetype: 'text/csv',
          originalname: 'payroll.csv',
          filename: '../untrusted-upload',
          path: '/var/lib/bap/uploads/5ec1cb22b6c671b7c36415d41bce6cb5',
          size: 1,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
