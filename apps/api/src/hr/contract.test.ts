import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import {
  createDocumentCategoryRequestSchema,
  createPositionRequestSchema,
  createEmployeeRequestOpenApiSchema,
  employeeListQuerySchema,
  updateEmployeeRequestSchema,
  updatePositionRequestSchema,
  hrReferenceListQuerySchema,
  createEmploymentTermRequestOpenApiSchema,
  createEmploymentTermRequestSchema,
  employmentTermOpenApiSchema,
  employmentTermListQuerySchema,
  employeeStatusHistoryQuerySchema,
  employeeStatusTransitionRequestSchema,
  createEmployeeRequestSchema,
  updateEmployeeRequestOpenApiSchema,
  employeeStatusChangeSchema,
  employeeStatusChangeOpenApiSchema,
  employeeDocumentListQuerySchema,
  linkEmployeeDocumentRequestSchema,
  updateEmployeeDocumentRequestSchema,
  employeeDocumentOpenApiSchema,
  checklistTemplateListQuerySchema,
  checklistListQuerySchema,
  createChecklistTemplateRequestSchema,
  updateChecklistTemplateRequestSchema,
  createChecklistTemplateItemRequestSchema,
  updateChecklistTemplateItemRequestSchema,
  createChecklistRequestSchema,
  updateChecklistTaskRequestSchema,
  checklistTemplateOpenApiSchema,
  checklistOpenApiSchema,
} from './contract.js';
import { HrController } from './hr.controller.js';
import {
  HrTermNotFoundError,
  HrTermConflictError,
  HrEmployeeNotFoundError,
  HrEmployeeStatusConflictError,
  HrEmployeeStatusReasonError,
  HrEmployeeDocumentNotFoundError,
  HrEmployeeDocumentConflictError,
  HrChecklistNotFoundError,
  HrChecklistConflictError,
  HrChecklistBadRequestError,
} from './hr-repository.js';
import type { HrRepository } from './hr-repository.js';

const legalEntityId = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

describe('HR API contract reconciliation', () => {
  it('uses readHr for both checklist reads and manageHr for all six checklist mutations, with exact 404 and 409 mappings', async () => {
    const timestamp = new Date(0).toISOString();
    const item = {
      id: legalEntityId,
      templateId: legalEntityId,
      position: 1,
      title: 'Task',
      defaultDueOffsetDays: 0,
      documentCategoryId: null,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const template = {
      id: legalEntityId,
      legalEntityId,
      kind: 'onboarding' as const,
      code: 'ONBOARD',
      name: 'Onboard',
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: [item],
    };
    const task = {
      id: legalEntityId,
      checklistId: legalEntityId,
      templateItemId: legalEntityId,
      title: 'Task',
      ownerUserId: 'owner',
      dueOn: '2026-01-01',
      documentCategoryId: null,
      status: 'pending' as const,
      skipReason: null,
      documentId: null,
      completedBy: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const checklist = {
      id: legalEntityId,
      legalEntityId,
      employeeId: legalEntityId,
      relationshipId: null,
      templateId: legalEntityId,
      kind: 'onboarding' as const,
      status: 'open' as const,
      startedOn: '2026-01-01',
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks: [task],
    };
    const repository = {
      listChecklistTemplates: vi.fn().mockResolvedValue({
        items: [template],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
      createChecklistTemplate: vi.fn().mockResolvedValue(template),
      updateChecklistTemplate: vi.fn().mockResolvedValue(template),
      createChecklistTemplateItem: vi.fn().mockResolvedValue(item),
      updateChecklistTemplateItem: vi.fn().mockResolvedValue(item),
      listChecklists: vi.fn().mockResolvedValue({
        items: [checklist],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
      createChecklist: vi.fn().mockResolvedValue(checklist),
      updateChecklistTask: vi.fn().mockResolvedValue(task),
    } as unknown as HrRepository;
    const controller = new HrController(repository, {} as never);
    const scope = vi
      .spyOn(
        controller as unknown as { scope: () => Promise<unknown> },
        'scope',
      )
      .mockResolvedValue({
        organizationId: 'org',
        userId: 'user',
        legalEntityIds: null,
      } as never);
    const request = {} as never;
    await controller.listChecklistTemplates(
      'org',
      { page: 1, pageSize: 25 },
      request,
    );
    await controller.createChecklistTemplate(
      'org',
      { legalEntityId, kind: 'onboarding', code: 'ONBOARD', name: 'Onboard' },
      request,
    );
    await controller.updateChecklistTemplate(
      'org',
      legalEntityId,
      { name: 'Changed' },
      request,
    );
    await controller.createChecklistTemplateItem(
      'org',
      legalEntityId,
      {
        position: 1,
        title: 'Task',
        defaultDueOffsetDays: 0,
        documentCategoryId: null,
      },
      request,
    );
    await controller.updateChecklistTemplateItem(
      'org',
      legalEntityId,
      legalEntityId,
      { active: false },
      request,
    );
    await controller.listChecklists(
      'org',
      legalEntityId,
      { page: 1, pageSize: 25 },
      request,
    );
    await controller.createChecklist(
      'org',
      legalEntityId,
      {
        templateId: legalEntityId,
        relationshipId: null,
        startedOn: '2026-01-01',
        ownerUserId: 'owner',
      },
      request,
    );
    await controller.updateChecklistTask(
      'org',
      legalEntityId,
      legalEntityId,
      legalEntityId,
      { status: 'in_progress' },
      request,
    );
    expect(
      (scope.mock.calls as unknown as [string, unknown, string][]).map(
        (call) => call[2],
      ),
    ).toEqual([
      'readHr',
      'manageHr',
      'manageHr',
      'manageHr',
      'manageHr',
      'readHr',
      'manageHr',
      'manageHr',
    ]);
    (
      repository.createChecklist as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrChecklistNotFoundError());
    await expect(
      controller.createChecklist(
        'org',
        legalEntityId,
        {
          templateId: legalEntityId,
          relationshipId: null,
          startedOn: '2026-01-01',
          ownerUserId: 'owner',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    (
      repository.createChecklist as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrChecklistConflictError());
    await expect(
      controller.createChecklist(
        'org',
        legalEntityId,
        {
          templateId: legalEntityId,
          relationshipId: null,
          startedOn: '2026-01-01',
          ownerUserId: 'owner',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('maps checklist commands to exact capability and HTTP failures', async () => {
    const body = { status: 'skipped' as const, skipReason: 'reason' };
    for (const [failure, Exception] of [
      [new HrChecklistNotFoundError(), NotFoundException],
      [new HrChecklistConflictError(), ConflictException],
      [new HrChecklistBadRequestError(), BadRequestException],
    ] as const) {
      const repository = {
        updateChecklistTask: vi.fn().mockRejectedValue(failure),
      } as unknown as HrRepository;
      const controller = new HrController(repository, {} as never);
      const scope = vi
        .spyOn(
          controller as unknown as { scope: () => Promise<unknown> },
          'scope',
        )
        .mockResolvedValue({
          organizationId: 'org',
          userId: 'user',
          legalEntityIds: null,
        } as never);
      await expect(
        controller.updateChecklistTask(
          'org',
          legalEntityId,
          legalEntityId,
          legalEntityId,
          body,
          {} as never,
        ),
      ).rejects.toBeInstanceOf(Exception);
      expect(scope).toHaveBeenCalledWith('org', expect.anything(), 'manageHr');
    }
  });
  it('uses strict checklist defaults, bounds, shapes, and command states', () => {
    expect(checklistTemplateListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
    });
    expect(checklistListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
    });
    for (const schema of [
      checklistTemplateListQuerySchema,
      checklistListQuerySchema,
      createChecklistTemplateRequestSchema,
      updateChecklistTemplateRequestSchema,
      createChecklistTemplateItemRequestSchema,
      updateChecklistTemplateItemRequestSchema,
      createChecklistRequestSchema,
      updateChecklistTaskRequestSchema,
    ])
      expect(schema.safeParse({ unexpected: true }).success).toBe(false);
    expect(
      createChecklistTemplateItemRequestSchema.safeParse({
        position: 1,
        title: 'T',
        defaultDueOffsetDays: -3651,
      }).success,
    ).toBe(false);
    expect(
      createChecklistTemplateItemRequestSchema.safeParse({
        position: 1,
        title: 'T',
        defaultDueOffsetDays: 3651,
      }).success,
    ).toBe(false);
    expect(
      updateChecklistTaskRequestSchema.safeParse({ status: 'pending' }).success,
    ).toBe(false);
    expect(
      updateChecklistTaskRequestSchema.safeParse({
        status: 'skipped',
        skipReason: 'why',
      }).success,
    ).toBe(true);
    expect(checklistTemplateOpenApiSchema).toMatchObject({
      additionalProperties: false,
      properties: { items: { type: 'array' } },
    });
    expect(checklistOpenApiSchema).toMatchObject({
      additionalProperties: false,
      properties: { tasks: { type: 'array' } },
    });
  });
  it('uses strict Wave 1 reference-data bodies and exact boolean queries', () => {
    expect(hrReferenceListQuerySchema.parse({ active: 'false' }).active).toBe(
      false,
    );
    expect(hrReferenceListQuerySchema.parse({ active: 'true' }).active).toBe(
      true,
    );
    expect(
      hrReferenceListQuerySchema.safeParse({ active: 'yes' }).success,
    ).toBe(false);
    expect(
      createPositionRequestSchema.safeParse({
        legalEntityId,
        code: 'P',
        name: 'Position',
        active: true,
      }).success,
    ).toBe(false);
    expect(updatePositionRequestSchema.safeParse({ code: 'P' }).success).toBe(
      false,
    );
    expect(
      createDocumentCategoryRequestSchema.safeParse({
        legalEntityId,
        code: 'C',
        name: 'Category',
        retentionKey: 'r',
        requiresApproval: false,
        confidentiality: 'payroll',
      }).success,
    ).toBe(false);
  });
  it('uses readHr/manageHr and maps document workflow failures', async () => {
    const item = {
      documentId: legalEntityId,
      title: 'Document',
      documentDate: '2026-01-01',
      categoryId: null,
      relationshipId: null,
      approvalStatus: 'not_required' as const,
      approvedBy: null,
      approvedAt: null,
      supersedesDocumentId: null,
      createdAt: new Date(0).toISOString(),
    };
    const repository = {
      listEmployeeDocuments: vi
        .fn()
        .mockResolvedValue({ items: [item], page: 1, pageSize: 25, total: 1 }),
      linkEmployeeDocument: vi.fn().mockResolvedValue(item),
      updateEmployeeDocument: vi.fn().mockResolvedValue(item),
    } as unknown as HrRepository;
    const controller = new HrController(repository, {} as never);
    const scope = vi
      .spyOn(
        controller as unknown as {
          scope: (
            organizationId: string,
            request: unknown,
            capability: 'readHr' | 'manageHr',
          ) => Promise<unknown>;
        },
        'scope',
      )
      .mockResolvedValue({
        legalEntityIds: null,
        organizationId: 'org_1',
        userId: 'user_1',
      });
    await expect(
      controller.documents(
        'org_1',
        legalEntityId,
        { page: 1, pageSize: 25, currentOnly: true },
        {} as never,
      ),
    ).resolves.toMatchObject({ items: [item] });
    const body = {
      documentId: legalEntityId,
      categoryId: legalEntityId,
      relationshipId: null,
      supersedesDocumentId: null,
    };
    await expect(
      controller.link('org_1', legalEntityId, body, {} as never),
    ).resolves.toEqual(item);
    await expect(
      controller.updateDocument(
        'org_1',
        legalEntityId,
        legalEntityId,
        { approvalDecision: 'approved' },
        {} as never,
      ),
    ).resolves.toEqual(item);
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'readHr',
      'manageHr',
      'manageHr',
    ]);
    (
      repository.linkEmployeeDocument as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrEmployeeDocumentNotFoundError());
    await expect(
      controller.link('org_1', legalEntityId, body, {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    (
      repository.listEmployeeDocuments as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrEmployeeDocumentNotFoundError());
    await expect(
      controller.documents(
        'org_1',
        legalEntityId,
        { page: 1, pageSize: 25, currentOnly: true },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    (
      repository.linkEmployeeDocument as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce({
      code: '23505',
      constraint: 'employee_document_pkey',
    });
    await expect(
      controller.link('org_1', legalEntityId, body, {} as never),
    ).rejects.toBeInstanceOf(ConflictException);
    (
      repository.updateEmployeeDocument as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrEmployeeDocumentConflictError());
    await expect(
      controller.updateDocument(
        'org_1',
        legalEntityId,
        legalEntityId,
        { approvalDecision: 'approved' },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    (
      repository.updateEmployeeDocument as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new HrEmployeeDocumentNotFoundError());
    await expect(
      controller.updateDocument(
        'org_1',
        legalEntityId,
        legalEntityId,
        { approvalDecision: 'approved' },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('parses employee list queries with the browser page defaults', () => {
    expect(employeeListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      employeeListQuerySchema.parse({
        legalEntityId,
        page: '2',
        pageSize: '100',
      }),
    ).toEqual({ legalEntityId, page: 2, pageSize: 100 });
  });
  it('enforces strict employee-document workflow input and OpenAPI shapes', () => {
    expect(employeeDocumentListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      currentOnly: true,
    });
    expect(
      employeeDocumentListQuerySchema.parse({
        currentOnly: 'false',
        approvalStatus: 'pending',
      }),
    ).toMatchObject({ currentOnly: false, approvalStatus: 'pending' });
    expect(
      employeeDocumentListQuerySchema.safeParse({ unknown: 'x' }).success,
    ).toBe(false);
    expect(
      linkEmployeeDocumentRequestSchema.parse({
        documentId: legalEntityId,
        categoryId: legalEntityId,
      }),
    ).toMatchObject({ relationshipId: null, supersedesDocumentId: null });
    expect(
      linkEmployeeDocumentRequestSchema.safeParse({ documentId: legalEntityId })
        .success,
    ).toBe(false);
    expect(updateEmployeeDocumentRequestSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      updateEmployeeDocumentRequestSchema.safeParse({
        approvalDecision: 'pending',
      }).success,
    ).toBe(false);
    expect(employeeDocumentOpenApiSchema).toMatchObject({
      additionalProperties: false,
      required: [
        'documentId',
        'title',
        'documentDate',
        'categoryId',
        'relationshipId',
        'approvalStatus',
        'approvedBy',
        'approvedAt',
        'supersedesDocumentId',
        'createdAt',
      ],
    });
  });

  it('enforces strict employment-term query and complete snapshots', () => {
    expect(employmentTermListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      employmentTermListQuerySchema.safeParse({ unexpected: 'x' }).success,
    ).toBe(false);
    const body = {
      relationshipId: legalEntityId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      positionId: null,
      departmentId: null,
      costCentreId: null,
      workplaceId: null,
      managerEmployeeId: null,
      weeklyHours: '40',
      workingTimePattern: 'standard',
    };
    expect(
      createEmploymentTermRequestSchema.parse(body).supersedesEmploymentTermId,
    ).toBeNull();
    expect(
      createEmploymentTermRequestSchema.safeParse({ ...body, weeklyHours: '0' })
        .success,
    ).toBe(false);
    expect(
      createEmploymentTermRequestSchema.safeParse({
        ...body,
        effectiveTo: '2025-12-31',
      }).success,
    ).toBe(false);
    expect(
      (
        createEmploymentTermRequestOpenApiSchema as unknown as {
          required: string[];
        }
      ).required,
    ).toEqual([
      'relationshipId',
      'effectiveFrom',
      'effectiveTo',
      'positionId',
      'departmentId',
      'costCentreId',
      'workplaceId',
      'managerEmployeeId',
      'weeklyHours',
      'workingTimePattern',
    ]);
  });

  it('rejects immutable employee fields from an update', () => {
    expect(
      updateEmployeeRequestSchema.safeParse({ employeeNumber: 'EMP-002' })
        .success,
    ).toBe(false);
    expect(
      updateEmployeeRequestSchema.safeParse({ legalEntityId }).success,
    ).toBe(false);
    expect(
      updateEmployeeRequestSchema.safeParse({ status: 'active' }).success,
    ).toBe(false);
  });

  it('uses preboarding-only employee creation and strict lifecycle inputs', () => {
    const create = {
      legalEntityId,
      employeeNumber: 'EMP-001',
      firstName: 'Ada',
      lastName: 'Lovelace',
    };
    expect(createEmployeeRequestSchema.parse(create)).not.toHaveProperty(
      'status',
    );
    expect(
      createEmployeeRequestSchema.safeParse({ ...create, status: 'active' })
        .success,
    ).toBe(false);
    expect(employeeStatusHistoryQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      employeeStatusHistoryQuerySchema.safeParse({ unexpected: 'x' }).success,
    ).toBe(false);
    expect(
      employeeStatusTransitionRequestSchema.parse({
        toStatus: 'active',
        effectiveAt: '2026-09-20T10:00:00.000Z',
        reason: '  Returning from leave  ',
      }),
    ).toMatchObject({ reason: 'Returning from leave' });
    expect(
      employeeStatusTransitionRequestSchema.safeParse({
        toStatus: 'active',
        effectiveAt: '2026-09-20T10:00:00.000Z',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      employeeStatusChangeSchema.safeParse({
        id: legalEntityId,
        employeeId: legalEntityId,
        fromStatus: 'inactive',
        toStatus: 'active',
        effectiveAt: '2026-09-20T10:00:00.000Z',
        reason: '',
        createdAt: '2026-09-20T10:01:00.000Z',
      }).success,
    ).toBe(false);
    expect(createEmployeeRequestOpenApiSchema.properties).not.toHaveProperty(
      'status',
    );
    expect(
      (updateEmployeeRequestOpenApiSchema as unknown as { properties: object })
        .properties,
    ).not.toHaveProperty('status');
    expect(employeeStatusChangeOpenApiSchema).toMatchObject({
      additionalProperties: false,
      properties: { reason: { minLength: 1, maxLength: 500 } },
    });
  });

  it('publishes create-only OpenAPI request requirements', () => {
    expect(createEmployeeRequestOpenApiSchema.required).not.toContain('id');
    expect(createEmployeeRequestOpenApiSchema.required).not.toContain(
      'createdAt',
    );
  });

  it('marks lifecycle commands as HTTP 200 rather than the POST default', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        HrController.prototype.transitionStatus,
      ),
    ).toBe(200);
  });

  it('uses manageHr/readHr and maps lifecycle command errors exactly', async () => {
    const change = {
      id: '1b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
      employeeId: legalEntityId,
      fromStatus: 'preboarding' as const,
      toStatus: 'active' as const,
      effectiveAt: '2026-09-20T10:00:00.000Z',
      reason: null,
      createdAt: '2026-09-20T10:01:00.000Z',
    };
    const repository = {
      transitionEmployeeStatus: vi.fn().mockResolvedValue(change),
      listEmployeeStatusHistory: vi.fn().mockResolvedValue({
        items: [change],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
    } as unknown as HrRepository;
    const controller = new HrController(repository, {} as never);
    const scope = vi
      .spyOn(
        controller as unknown as {
          scope: (
            organizationId: string,
            request: unknown,
            capability: 'readHr' | 'manageHr',
          ) => Promise<unknown>;
        },
        'scope',
      )
      .mockResolvedValue({
        legalEntityIds: null,
        organizationId: 'org_1',
        userId: 'user_1',
      });
    const body = {
      toStatus: 'active' as const,
      effectiveAt: change.effectiveAt,
    };
    await expect(
      controller.transitionStatus('org_1', legalEntityId, body, {} as never),
    ).resolves.toEqual(change);
    await controller.statusHistory(
      'org_1',
      legalEntityId,
      { page: 1, pageSize: 25 },
      {} as never,
    );
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'manageHr',
      'readHr',
    ]);
    for (const [error, expected] of [
      [new HrEmployeeStatusReasonError(), BadRequestException],
      [new HrEmployeeNotFoundError(), NotFoundException],
      [new HrEmployeeStatusConflictError(), ConflictException],
    ] as const) {
      (
        repository.transitionEmployeeStatus as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValueOnce(error);
      await expect(
        controller.transitionStatus('org_1', legalEntityId, body, {} as never),
      ).rejects.toBeInstanceOf(expected);
    }
  });

  it('maps invisible employment-term collections to 404', async () => {
    const repository = {
      listEmploymentTerms: vi.fn().mockRejectedValue(new HrTermNotFoundError()),
    } as unknown as HrRepository;
    const controller = new HrController(repository, {} as never);
    vi.spyOn(
      controller as unknown as { scope: () => Promise<unknown> },
      'scope',
    ).mockResolvedValue({
      legalEntityIds: null,
      organizationId: 'org_1',
      userId: 'user_1',
    });
    await expect(
      controller.employmentTerms(
        'org_1',
        legalEntityId,
        { page: 1, pageSize: 25 },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses readHr for term reads and manageHr for complete-snapshot creates', async () => {
    const term = {
      id: '1b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
      employeeId: legalEntityId,
      relationshipId: '2b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
      version: 1,
      supersedesEmploymentTermId: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      positionId: null,
      departmentId: null,
      costCentreId: null,
      workplaceId: null,
      managerEmployeeId: null,
      weeklyHours: '40.00',
      workingTimePattern: 'standard',
      createdAt: new Date(0).toISOString(),
    };
    const repository = {
      listEmploymentTerms: vi.fn().mockResolvedValue({
        items: [term],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
      createEmploymentTerm: vi.fn().mockResolvedValue(term),
    } as unknown as HrRepository;
    const controller = new HrController(repository, {} as never);
    const scope = vi
      .spyOn(
        controller as unknown as {
          scope: (
            organizationId: string,
            request: unknown,
            capability: 'readHr' | 'manageHr',
          ) => Promise<unknown>;
        },
        'scope',
      )
      .mockResolvedValue({
        legalEntityIds: null,
        organizationId: 'org_1',
        userId: 'user_1',
      });
    const body = {
      relationshipId: term.relationshipId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      positionId: null,
      departmentId: null,
      costCentreId: null,
      workplaceId: null,
      managerEmployeeId: null,
      weeklyHours: '40',
      workingTimePattern: 'standard',
      supersedesEmploymentTermId: null,
    };
    await controller.employmentTerms(
      'org_1',
      legalEntityId,
      { page: 1, pageSize: 25 },
      {} as never,
    );
    await controller.createEmploymentTerm(
      'org_1',
      legalEntityId,
      body,
      {} as never,
    );
    expect(scope.mock.calls.map((call) => call[2])).toEqual([
      'readHr',
      'manageHr',
    ]);
  });

  it('maps missing term dependencies to 404 and serialized term conflicts to 409', async () => {
    const body = {
      relationshipId: legalEntityId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      positionId: null,
      departmentId: null,
      costCentreId: null,
      workplaceId: null,
      managerEmployeeId: null,
      weeklyHours: '40',
      workingTimePattern: 'standard',
      supersedesEmploymentTermId: null,
    };
    for (const failure of [
      null,
      new HrTermConflictError(),
      { code: '23505', constraint: 'employment_term_relationship_version_key' },
      { code: '23505', constraint: 'employment_term_supersedes_successor_key' },
    ]) {
      const repository = {
        createEmploymentTerm: vi.fn().mockImplementation(() => {
          if (failure === null) return null;
          throw failure;
        }),
      } as unknown as HrRepository;
      const controller = new HrController(repository, {} as never);
      vi.spyOn(
        controller as unknown as { scope: () => Promise<unknown> },
        'scope',
      ).mockResolvedValue({
        legalEntityIds: null,
        organizationId: 'org_1',
        userId: 'user_1',
      });
      const expectation = controller.createEmploymentTerm(
        'org_1',
        legalEntityId,
        body,
        {} as never,
      );
      await expect(expectation).rejects.toBeInstanceOf(
        failure === null ? NotFoundException : ConflictException,
      );
    }
  });

  it('publishes the exact strict employment-term item shape', () => {
    expect(employmentTermOpenApiSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        weeklyHours: { pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
        workingTimePattern: { minLength: 1, maxLength: 64 },
      },
    });
  });
});
