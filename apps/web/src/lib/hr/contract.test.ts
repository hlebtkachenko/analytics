import { describe, expect, it } from 'vitest';

import {
  createHrAccessAssignmentSchema,
  createEmployeeChecklistSchema,
  createEmployeeSchema,
  employeeDetailSchema,
  employeeStatusHistoryItemSchema,
  checklistTemplateListQuerySchema,
  createChecklistTemplateItemSchema,
  createChecklistTemplateSchema,
  employeeChecklistListQuerySchema,
  updateChecklistTemplateItemSchema,
  updateChecklistTemplateSchema,
  updateChecklistTaskSchema,
  hrAccessAssignmentListSchema,
  compensationComponentListSchema,
  compensationComponentSchema,
  createCompensationComponentSchema,
  createPayrollAccountMappingSchema,
  createPayrollComponentSchema,
  payrollAccountMappingListSchema,
  payrollAccountMappingSchema,
  payrollComponentListSchema,
  payrollComponentSchema,
  updateCompensationComponentSchema,
  updatePayrollAccountMappingSchema,
  updatePayrollComponentSchema,
} from './contract.js';
import {
  hrAccessAssignmentPath,
  hrAccessAssignmentsPath,
  checklistTaskPath,
  checklistTemplateItemPath,
  checklistTemplateItemsPath,
  checklistTemplatePath,
  checklistTemplatesPath,
  employeeChecklistsPath,
  employeeCompensationComponentPath,
  employeeCompensationComponentsPath,
  payrollAccountMappingPath,
  payrollAccountMappingsPath,
  payrollComponentPath,
  payrollComponentsPath,
} from './client.js';

const employeeId = '00000000-0000-4000-8000-000000000001';

describe('HR lifecycle browser contract', () => {
  it('mirrors strict HR access assignment request and response shapes', () => {
    const assignment = {
      accessRole: 'payroll_approver',
      createdAt: '2026-09-21T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000011',
      legalEntityId: '00000000-0000-4000-8000-000000000010',
      userId: 'member_1',
    } as const;
    expect(
      createHrAccessAssignmentSchema.safeParse({
        accessRole: assignment.accessRole,
        legalEntityId: assignment.legalEntityId,
        userId: assignment.userId,
      }).success,
    ).toBe(true);
    expect(
      createHrAccessAssignmentSchema.safeParse({
        ...assignment,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      hrAccessAssignmentListSchema.safeParse({
        assignments: [{ ...assignment, unexpected: true }],
      }).success,
    ).toBe(false);
    expect(hrAccessAssignmentsPath('org_1')).toBe(
      '/api/bff/application/organizations/org_1/hr/access-assignments',
    );
    expect(hrAccessAssignmentPath('org_1', 'a/b')).toBe(
      '/api/bff/application/organizations/org_1/hr/access-assignments/a%2Fb',
    );
  });

  it('accepts the complete categorized approved successor document returned by employee detail and rejects unknown fields', () => {
    const employee = {
      id: employeeId,
      legalEntityId: '00000000-0000-4000-8000-000000000010',
      employeeNumber: 'EMP-001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      workEmail: null,
      workPhone: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      relationships: [],
      documents: [
        {
          documentId: '00000000-0000-4000-8000-000000000002',
          title: 'Corrected employment contract',
          documentDate: '2026-01-15',
          categoryId: '00000000-0000-4000-8000-000000000003',
          relationshipId: '00000000-0000-4000-8000-000000000004',
          approvalStatus: 'approved',
          approvedBy: '00000000-0000-4000-8000-000000000005',
          approvedAt: '2026-01-16T09:00:00.000Z',
          supersedesDocumentId: '00000000-0000-4000-8000-000000000006',
          createdAt: '2026-01-15T09:00:00.000Z',
        },
      ],
    } as const;

    expect(employeeDetailSchema.safeParse(employee).success).toBe(true);
    expect(
      employeeDetailSchema.safeParse({
        ...employee,
        documents: [{ ...employee.documents[0], unexpected: true }],
      }).success,
    ).toBe(false);
  });

  it('does not accept a supplied employee status at creation', () => {
    expect(
      createEmployeeSchema.safeParse({
        legalEntityId: '00000000-0000-4000-8000-000000000010',
        employeeNumber: 'EMP-001',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'active',
      }).success,
    ).toBe(false);
  });

  it('accepts a reason only for inactive-to-active history', () => {
    const item = {
      id: '00000000-0000-4000-8000-000000000002',
      employeeId,
      fromStatus: 'inactive',
      toStatus: 'active',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      reason: 'Return from leave',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;
    expect(employeeStatusHistoryItemSchema.safeParse(item).success).toBe(true);
    expect(
      employeeStatusHistoryItemSchema.safeParse({
        ...item,
        fromStatus: 'active',
        toStatus: 'inactive',
      }).success,
    ).toBe(false);
  });
});

describe('checklist browser contract', () => {
  it('requires a complete, valid start payload', () => {
    expect(
      createEmployeeChecklistSchema.safeParse({
        templateId: employeeId,
        startedOn: '2026-09-21',
        ownerUserId: 'owner-1',
      }).success,
    ).toBe(true);
    expect(
      createEmployeeChecklistSchema.safeParse({
        templateId: 'not-an-id',
        startedOn: '2026-09-21',
        ownerUserId: 'owner-1',
      }).success,
    ).toBe(false);
  });

  it('allows a skip reason only for skip commands', () => {
    expect(
      updateChecklistTaskSchema.safeParse({
        status: 'skipped',
        skipReason: 'No longer required',
      }).success,
    ).toBe(true);
    expect(
      updateChecklistTaskSchema.safeParse({ status: 'skipped' }).success,
    ).toBe(false);
    expect(
      updateChecklistTaskSchema.safeParse({
        status: 'completed',
        skipReason: 'No longer required',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown checklist filters and strict template/item payload fields', () => {
    expect(
      checklistTemplateListQuerySchema.safeParse({
        legalEntityId: employeeId,
        unknown: 'value',
      }).success,
    ).toBe(false);
    expect(
      employeeChecklistListQuerySchema.safeParse({ dueBefore: '2026-13-01' })
        .success,
    ).toBe(false);
    expect(
      createChecklistTemplateSchema.safeParse({
        legalEntityId: employeeId,
        kind: 'onboarding',
        code: 'ONBOARD',
        name: 'Onboarding',
        active: true,
      }).success,
    ).toBe(false);
    expect(
      createChecklistTemplateItemSchema.safeParse({
        position: 1,
        title: 'Collect document',
        defaultDueOffsetDays: 0,
        documentCategoryId: null,
        active: true,
      }).success,
    ).toBe(false);
    expect(updateChecklistTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateChecklistTemplateItemSchema.safeParse({}).success).toBe(false);
  });

  it('uses only fixed checklist client paths and encodes dynamic identifiers', () => {
    const idWithSlash = 'template/id';
    expect(checklistTemplatesPath('org_1')).toBe(
      '/api/bff/application/organizations/org_1/hr/checklist-templates',
    );
    expect(
      checklistTemplatesPath(
        'org_1',
        new URLSearchParams('page=2&pageSize=50'),
      ),
    ).toBe(
      '/api/bff/application/organizations/org_1/hr/checklist-templates?page=2&pageSize=50',
    );
    expect(checklistTemplatePath('org_1', idWithSlash)).toBe(
      '/api/bff/application/organizations/org_1/hr/checklist-templates/template%2Fid',
    );
    expect(checklistTemplateItemsPath('org_1', idWithSlash)).toBe(
      '/api/bff/application/organizations/org_1/hr/checklist-templates/template%2Fid/items',
    );
    expect(checklistTemplateItemPath('org_1', idWithSlash, 'item/id')).toBe(
      '/api/bff/application/organizations/org_1/hr/checklist-templates/template%2Fid/items/item%2Fid',
    );
    expect(
      employeeChecklistsPath(
        'org_1',
        'employee/id',
        new URLSearchParams('status=open'),
      ),
    ).toBe(
      '/api/bff/application/organizations/org_1/employees/employee%2Fid/checklists?status=open',
    );
    expect(
      checklistTaskPath('org_1', 'employee/id', 'checklist/id', 'task/id'),
    ).toBe(
      '/api/bff/application/organizations/org_1/employees/employee%2Fid/checklists/checklist%2Fid/tasks/task%2Fid',
    );
  });
});

describe('payroll browser contract', () => {
  const entityId = '00000000-0000-4000-8000-000000000010';
  const componentId = '00000000-0000-4000-8000-000000000011';
  const mappingId = '00000000-0000-4000-8000-000000000012';
  const relationshipId = '00000000-0000-4000-8000-000000000013';
  const timestamp = '2026-09-21T00:00:00.000Z';
  const component = {
    accountingKey: 'BASE_PAY',
    active: true,
    code: 'BASE',
    createdAt: timestamp,
    id: componentId,
    kind: 'earning',
    legalEntityId: entityId,
    name: 'Base pay',
    recurrence: 'recurring',
    updatedAt: timestamp,
  } as const;
  const compensation = {
    amount: '1000.0000',
    componentDefinitionId: componentId,
    createdAt: timestamp,
    currency: 'CZK',
    employeeId,
    id: mappingId,
    relationshipId,
    updatedAt: timestamp,
    validFrom: '2026-09-01',
    validTo: null,
  } as const;
  const mapping = {
    accountCode: '521000',
    accountingKey: 'BASE_PAY',
    createdAt: timestamp,
    id: mappingId,
    legalEntityId: entityId,
    side: 'debit',
    updatedAt: timestamp,
    validFrom: '2026-09-01',
    validTo: null,
  } as const;

  it('mirrors strict component and mapping responses and list envelopes', () => {
    expect(payrollComponentSchema.safeParse(component).success).toBe(true);
    expect(payrollAccountMappingSchema.safeParse(mapping).success).toBe(true);
    expect(
      payrollComponentListSchema.safeParse({
        components: [component],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(true);
    expect(
      payrollAccountMappingListSchema.safeParse({
        mappings: [mapping],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(true);
    expect(
      payrollComponentListSchema.safeParse({ components: [component] }).success,
    ).toBe(false);
    expect(
      payrollAccountMappingSchema.safeParse({ ...mapping, unexpected: true })
        .success,
    ).toBe(false);
  });

  it('accepts nullable and defaulted compensation and mapping fields only at creation', () => {
    expect(compensationComponentSchema.safeParse(compensation).success).toBe(
      true,
    );
    expect(
      compensationComponentListSchema.safeParse({
        compensationComponents: [compensation],
        page: 1,
        pageSize: 25,
        total: 1,
      }).success,
    ).toBe(true);
    expect(
      createCompensationComponentSchema.parse({
        amount: compensation.amount,
        componentDefinitionId: componentId,
        relationshipId,
        validFrom: compensation.validFrom,
      }),
    ).toMatchObject({ currency: 'CZK', validTo: null });
    expect(
      createPayrollAccountMappingSchema.parse({
        accountCode: mapping.accountCode,
        accountingKey: mapping.accountingKey,
        legalEntityId: entityId,
        side: mapping.side,
        validFrom: mapping.validFrom,
      }),
    ).toMatchObject({ validTo: null });
  });

  it('permits only immutable successor or allowed component update shapes', () => {
    expect(
      updateCompensationComponentSchema.safeParse({
        amount: '1200',
        currency: 'CZK',
        validFrom: '2026-10-01',
      }).success,
    ).toBe(true);
    expect(
      updateCompensationComponentSchema.safeParse({
        ...compensation,
        componentDefinitionId: mappingId,
      }).success,
    ).toBe(false);
    expect(
      updatePayrollComponentSchema.safeParse({ name: 'Renamed', active: false })
        .success,
    ).toBe(true);
    expect(
      updatePayrollComponentSchema.safeParse({ code: 'MUTATED' }).success,
    ).toBe(false);
    expect(
      updatePayrollAccountMappingSchema.safeParse({
        accountCode: '522000',
        side: 'credit',
        validFrom: '2026-10-01',
      }).success,
    ).toBe(true);
    expect(
      updatePayrollAccountMappingSchema.safeParse({
        ...mapping,
        accountingKey: 'MUTATED',
      }).success,
    ).toBe(false);
  });

  it('uses only fixed payroll BFF paths and encoded dynamic identifiers', () => {
    expect(payrollComponentsPath('org_1')).toBe(
      '/api/bff/application/organizations/org_1/payroll/components',
    );
    expect(payrollComponentPath('org_1', 'component/id')).toBe(
      '/api/bff/application/organizations/org_1/payroll/components/component%2Fid',
    );
    expect(employeeCompensationComponentsPath('org_1', 'employee/id')).toBe(
      '/api/bff/application/organizations/org_1/employees/employee%2Fid/compensation-components',
    );
    expect(
      employeeCompensationComponentPath('org_1', 'employee/id', 'component/id'),
    ).toBe(
      '/api/bff/application/organizations/org_1/employees/employee%2Fid/compensation-components/component%2Fid',
    );
    expect(payrollAccountMappingsPath('org_1')).toBe(
      '/api/bff/application/organizations/org_1/payroll/account-mappings',
    );
    expect(payrollAccountMappingPath('org_1', 'mapping/id')).toBe(
      '/api/bff/application/organizations/org_1/payroll/account-mappings/mapping%2Fid',
    );
    expect(
      createPayrollComponentSchema.safeParse({
        ...component,
        createdAt: timestamp,
      }).success,
    ).toBe(false);
  });
});
