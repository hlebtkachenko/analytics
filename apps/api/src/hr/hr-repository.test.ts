import { describe, expect, it } from 'vitest';
import type { DatabasePool } from '@bap/db/pool';

import {
  createEmployee,
  updateEmployee,
  createRelationship,
  linkEmployeeDocument,
  isDuplicateHrRecord,
  listEmployees,
  readEmployee,
  createEmploymentTerm,
  listEmploymentTerms,
  HrTermConflictError,
  transitionEmployeeStatus,
  listEmployeeStatusHistory,
  HrEmployeeNotFoundError,
  HrEmployeeStatusConflictError,
  HrEmployeeStatusReasonError,
  listEmployeeDocuments,
  updateEmployeeDocument,
  HrEmployeeDocumentNotFoundError,
  HrEmployeeDocumentConflictError,
  isEmployeeDocumentConflict,
  listChecklistTemplates,
  createChecklistTemplate,
  updateChecklistTemplate,
  createChecklistTemplateItem,
  updateChecklistTemplateItem,
  createChecklist,
  listChecklists,
  updateChecklistTask,
  isDuplicateHrRecord as duplicateChecklist,
  HrChecklistConflictError,
  HrChecklistBadRequestError,
} from './hr-repository.js';

const scope = {
  organizationId: 'org',
  userId: 'user',
  role: 'owner' as const,
};

function fakePool(handler: (sql: string, params?: unknown[]) => unknown) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { sql } : { sql, params });
      if (
        sql === 'begin' ||
        sql === 'commit' ||
        sql === 'rollback' ||
        sql.startsWith('select set_config')
      )
        return { rows: [], rowCount: 0 };
      return handler(sql, params);
    },
    release: () => undefined,
  };
  return { connect: async () => client, calls } as unknown as DatabasePool & {
    calls: { sql: string; params?: unknown[] }[];
  };
}

const employeeRow = {
  id: 'e1',
  legal_entity_id: 'le1',
  employee_number: 'E1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  work_email: null,
  work_phone: null,
  status: 'active',
  created_at: new Date(0),
  updated_at: new Date(0),
};

describe('HR repository filtering and paging', () => {
  const checklistTemplateRow = {
    id: 'template',
    legal_entity_id: 'le1',
    kind: 'onboarding' as const,
    code: 'ONBOARD',
    name: 'Onboard',
    active: true,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
  const checklistItemRow = {
    id: 'item',
    template_id: 'template',
    position: 1,
    title: 'Read policy',
    default_due_offset_days: 2,
    document_category_id: 'category',
    active: true,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
  const checklistRow = {
    id: 'check',
    legal_entity_id: 'le1',
    employee_id: 'e1',
    relationship_id: 'relationship',
    template_id: 'template',
    kind: 'onboarding' as const,
    status: 'open' as const,
    started_on: '2026-01-01',
    completed_at: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
  const checklistTaskRow = {
    id: 'task',
    checklist_id: 'check',
    template_item_id: 'item',
    title: 'Read policy',
    owner_user_id: 'owner',
    due_on: '2026-01-03',
    document_category_id: 'category',
    status: 'pending' as const,
    skip_reason: null,
    document_id: null,
    completed_by: null,
    completed_at: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
  it('creates, updates, retires templates and items with operational-category visibility, identifier-only audit, and rollback', async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith('insert into app.hr_checklist_template('))
        return { rows: [checklistTemplateRow], rowCount: 1 };
      if (sql.startsWith('update app.hr_checklist_template set'))
        return {
          rows: [{ ...checklistTemplateRow, active: false }],
          rowCount: 1,
        };
      if (sql.includes('from app.hr_checklist_template where id=$1'))
        return { rows: [checklistTemplateRow], rowCount: 1 };
      if (sql.startsWith('insert into app.hr_checklist_template_item'))
        return { rows: [checklistItemRow], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_template_item i join'))
        return {
          rows: [{ ...checklistItemRow, legal_entity_id: 'le1' }],
          rowCount: 1,
        };
      if (sql.startsWith('update app.hr_checklist_template_item'))
        return { rows: [{ ...checklistItemRow, active: false }], rowCount: 1 };
      if (sql.includes('from app.hr_document_category'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_template_item'))
        return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const input = { ...scope, legalEntityIds: ['le1'] };
    await expect(
      createChecklistTemplate(pool, {
        ...input,
        body: {
          legalEntityId: 'le1',
          kind: 'onboarding',
          code: 'ONBOARD',
          name: 'Onboard',
        },
      }),
    ).resolves.toMatchObject({ id: 'template' });
    await expect(
      updateChecklistTemplate(pool, {
        ...input,
        templateId: 'template',
        body: { active: false },
      }),
    ).resolves.toMatchObject({ active: false });
    await expect(
      createChecklistTemplateItem(pool, {
        ...input,
        templateId: 'template',
        body: {
          position: 1,
          title: 'Read policy',
          defaultDueOffsetDays: 2,
          documentCategoryId: 'category',
        },
      }),
    ).resolves.toMatchObject({ id: 'item' });
    await expect(
      updateChecklistTemplateItem(pool, {
        ...input,
        templateId: 'template',
        itemId: 'item',
        body: { active: false },
      }),
    ).resolves.toMatchObject({ active: false });
    const category = pool.calls.find((call) =>
      call.sql.includes("confidentiality='operational'"),
    )!;
    expect(category.params).toEqual(['category', 'le1']);
    for (const audit of pool.calls.filter((call) =>
      call.sql.includes('record_audit'),
    )) {
      expect(audit.sql).toContain("'{}'::jsonb");
      expect(audit.params).toHaveLength(1);
    }
    const rollback = fakePool((sql) => {
      if (sql.startsWith('insert into app.hr_checklist_template('))
        return { rows: [checklistTemplateRow], rowCount: 1 };
      if (sql.includes('record_audit')) throw new Error('audit');
      return { rows: [], rowCount: 0 };
    });
    await expect(
      createChecklistTemplate(rollback, {
        ...input,
        body: {
          legalEntityId: 'le1',
          kind: 'onboarding',
          code: 'ONBOARD',
          name: 'Onboard',
        },
      }),
    ).rejects.toThrow('audit');
    expect(rollback.calls.map((call) => call.sql)).toContain('rollback');
  });
  it('instantiates only active snapshots, validates employee/template/relationship visibility, and lists with filters and due ordering', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('select legal_entity_id from app.employee'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_template where id=$1'))
        return { rows: [checklistTemplateRow], rowCount: 1 };
      if (sql.includes('from app.employment_relationship'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes('where template_id=$1 and active=true'))
        return { rows: [checklistItemRow], rowCount: 1 };
      if (sql.startsWith('insert into app.hr_checklist('))
        return { rows: [checklistRow], rowCount: 1 };
      if (sql.startsWith('insert into app.hr_checklist_task'))
        return { rows: [], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_task where checklist_id=$1'))
        return { rows: [checklistTaskRow], rowCount: 1 };
      if (sql.includes('from app.employee where id=$1'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '1' }], rowCount: 1 };
      if (sql.includes('select c.* from app.hr_checklist'))
        return { rows: [checklistRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const input = { ...scope, legalEntityIds: ['le1'] };
    await expect(
      createChecklist(pool, {
        ...input,
        employeeId: 'e1',
        body: {
          templateId: 'template',
          relationshipId: 'relationship',
          startedOn: '2026-01-01',
          ownerUserId: 'owner',
        },
      }),
    ).resolves.toMatchObject({
      tasks: [
        {
          title: 'Read policy',
          dueOn: '2026-01-03',
          documentCategoryId: 'category',
        },
      ],
    });
    const insert = pool.calls.find((call) =>
      call.sql.startsWith('insert into app.hr_checklist_task'),
    )!;
    expect(insert.sql).toContain('$6::date + $7::integer');
    expect(insert.params).toEqual([
      'org',
      'check',
      'item',
      'Read policy',
      'owner',
      '2026-01-01',
      2,
      'category',
      'user',
    ]);
    const listed = await listChecklists(pool, {
      ...input,
      employeeId: 'e1',
      query: {
        page: 2,
        pageSize: 10,
        kind: 'onboarding',
        status: 'open',
        ownerUserId: 'owner',
        dueBefore: '2026-02-01',
      },
    });
    expect(listed).toMatchObject({
      total: 1,
      items: [{ tasks: [{ id: 'task' }] }],
    });
    const query = pool.calls.find((call) =>
      call.sql.includes('order by (select min(t.due_on)'),
    )!;
    expect(query.params).toEqual([
      'e1',
      'onboarding',
      'open',
      'owner',
      '2026-02-01',
      10,
      10,
    ]);
  });
  it('lists checklist templates with escaped search, filters, stable paging, and ordered children', async () => {
    const pool = fakePool((sql) =>
      sql.includes('count(*)')
        ? { rows: [{ count: '1' }], rowCount: 1 }
        : sql.includes('from app.hr_checklist_template_item')
          ? { rows: [], rowCount: 0 }
          : {
              rows: [
                {
                  id: 't1',
                  legal_entity_id: 'le1',
                  kind: 'onboarding',
                  code: 'A',
                  name: 'A',
                  active: true,
                  created_at: new Date(0),
                  updated_at: new Date(0),
                },
              ],
              rowCount: 1,
            },
    );
    const result = await listChecklistTemplates(pool, {
      ...scope,
      legalEntityIds: ['le1'],
      query: {
        page: 2,
        pageSize: 10,
        legalEntityId: 'le1',
        kind: 'onboarding',
        active: true,
        q: 'a_%',
      },
    });
    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    const list = pool.calls.find((x) =>
      x.sql.includes('order by code asc,id asc'),
    )!;
    expect(list.params).toEqual([
      ['le1'],
      'le1',
      'onboarding',
      true,
      '%a\\_\\%%',
      10,
      10,
    ]);
    expect(
      pool.calls.find((x) => x.sql.includes('template_id=$1'))?.sql,
    ).toContain('order by position asc,id asc');
  });
  it('recognizes checklist duplicate constraints', () => {
    expect(
      duplicateChecklist({
        code: '23505',
        constraint: 'hr_checklist_template_entity_code_key',
      }),
    ).toBe(true);
    expect(
      duplicateChecklist({
        code: '23505',
        constraint: 'hr_checklist_template_item_template_position_key',
      }),
    ).toBe(true);
  });
  it.each([
    ['pending', 'in_progress', undefined, undefined],
    ['in_progress', 'completed', undefined, 'doc1'],
    ['pending', 'skipped', 'reason', null],
  ] as const)(
    'enforces legal checklist task edge %s to %s',
    async (oldStatus, status, skipReason, documentId) => {
      const pool = fakePool((sql) =>
        sql.includes('select c.status from app.hr_checklist')
          ? { rows: [{ status: 'open' }], rowCount: 1 }
          : sql.includes('from app.hr_checklist_task t where')
            ? {
                rows: [
                  {
                    id: 'task',
                    checklist_id: 'check',
                    template_item_id: null,
                    title: 'Task',
                    owner_user_id: 'owner',
                    due_on: '2026-01-01',
                    document_category_id: null,
                    status: oldStatus,
                    skip_reason: null,
                    document_id: null,
                    completed_by: null,
                    completed_at: null,
                    created_at: new Date(0),
                    updated_at: new Date(0),
                    checklist_status: 'open',
                  },
                ],
                rowCount: 1,
              }
            : sql.includes('from app.employee_document')
              ? { rows: [{ ok: 1 }], rowCount: 1 }
              : sql.startsWith('update app.hr_checklist_task')
                ? {
                    rows: [
                      {
                        id: 'task',
                        checklist_id: 'check',
                        template_item_id: null,
                        title: 'Task',
                        owner_user_id: 'owner',
                        due_on: '2026-01-01',
                        document_category_id: null,
                        status,
                        skip_reason: skipReason ?? null,
                        document_id: documentId ?? null,
                        completed_by: status === 'in_progress' ? null : 'user',
                        completed_at:
                          status === 'in_progress' ? null : new Date(0),
                        created_at: new Date(0),
                        updated_at: new Date(0),
                      },
                    ],
                    rowCount: 1,
                  }
                : { rows: [], rowCount: 0 },
      );
      await expect(
        updateChecklistTask(pool, {
          ...scope,
          legalEntityIds: ['le1'],
          employeeId: 'e1',
          checklistId: 'check',
          taskId: 'task',
          body: {
            status,
            ...(skipReason ? { skipReason } : {}),
            ...(documentId !== undefined ? { documentId } : {}),
          },
        }),
      ).resolves.toMatchObject({ status });
    },
  );
  it('preserves omitted documents, permits explicit null, requires categorized completion, validates current operational links, completes parent, and rolls back audit', async () => {
    const task = {
      ...checklistTaskRow,
      status: 'in_progress' as const,
      document_id: 'old-document',
    };
    const pool = fakePool((sql) => {
      if (sql.includes('select c.status from app.hr_checklist'))
        return { rows: [{ status: 'open' }], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_task t where'))
        return { rows: [task], rowCount: 1 };
      if (sql.includes('from app.employee_document'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.startsWith('update app.hr_checklist_task'))
        return {
          rows: [
            {
              ...task,
              status: 'completed',
              document_id: 'new-document',
              completed_by: 'user',
              completed_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateChecklistTask(pool, {
        ...scope,
        legalEntityIds: ['le1'],
        employeeId: 'e1',
        checklistId: 'check',
        taskId: 'task',
        body: { status: 'completed', documentId: 'new-document' },
      }),
    ).resolves.toMatchObject({ status: 'completed', completedBy: 'user' });
    const documentCheck = pool.calls.find((call) =>
      call.sql.includes('from app.employee_document'),
    )!;
    expect(documentCheck.sql).toContain("c.confidentiality='operational'");
    expect(documentCheck.sql).toContain('supersedes_document_id=l.document_id');
    expect(documentCheck.params).toEqual(['e1', 'new-document', 'category']);
    expect(
      pool.calls.find((call) =>
        call.sql.startsWith('update app.hr_checklist_task'),
      )?.params,
    ).toEqual(['task', 'completed', null, 'new-document', 'user']);
    expect(
      pool.calls.some((call) =>
        call.sql.includes("update app.hr_checklist set status='completed'"),
      ),
    ).toBe(true);
    const missing = fakePool((sql) =>
      sql.includes('select c.status')
        ? { rows: [{ status: 'open' }], rowCount: 1 }
        : sql.includes('from app.hr_checklist_task')
          ? { rows: [{ ...task, document_id: null }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    await expect(
      updateChecklistTask(missing, {
        ...scope,
        legalEntityIds: ['le1'],
        employeeId: 'e1',
        checklistId: 'check',
        taskId: 'task',
        body: { status: 'completed' },
      }),
    ).rejects.toBeInstanceOf(HrChecklistBadRequestError);
    const rollback = fakePool((sql) => {
      if (sql.includes('select c.status'))
        return { rows: [{ status: 'open' }], rowCount: 1 };
      if (sql.includes('from app.hr_checklist_task t where'))
        return { rows: [{ ...task, document_category_id: null }], rowCount: 1 };
      if (sql.startsWith('update app.hr_checklist_task'))
        return {
          rows: [
            {
              ...task,
              status: 'completed',
              document_id: null,
              completed_by: 'user',
              completed_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      if (sql.includes('record_audit')) throw new Error('audit');
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateChecklistTask(rollback, {
        ...scope,
        legalEntityIds: ['le1'],
        employeeId: 'e1',
        checklistId: 'check',
        taskId: 'task',
        body: { status: 'completed', documentId: null },
      }),
    ).rejects.toThrow('audit');
    expect(rollback.calls.map((call) => call.sql)).toContain('rollback');
  });
  it.each([
    ['pending', 'completed', {}],
    ['completed', 'in_progress', {}],
    ['pending', 'skipped', {}],
    ['pending', 'in_progress', { skipReason: 'no' }],
  ] as const)(
    'rejects forbidden checklist edge %s to %s',
    async (oldStatus, status, extra) => {
      const pool = fakePool((sql) =>
        sql.includes('select c.status from app.hr_checklist')
          ? { rows: [{ status: 'open' }], rowCount: 1 }
          : sql.includes('from app.hr_checklist_task t where')
            ? {
                rows: [{ status: oldStatus, checklist_status: 'open' }],
                rowCount: 1,
              }
            : { rows: [], rowCount: 0 },
      );
      await expect(
        updateChecklistTask(pool, {
          ...scope,
          legalEntityIds: ['le1'],
          employeeId: 'e1',
          checklistId: 'c',
          taskId: 't',
          body: { status, ...extra } as never,
        }),
      ).rejects.toBeInstanceOf(
        status === 'skipped' ||
          (status === 'in_progress' && 'skipReason' in extra)
          ? HrChecklistBadRequestError
          : HrChecklistConflictError,
      );
    },
  );
  it('binds employee-document filters and the current successor predicate exactly', async () => {
    const pool = fakePool((sql) =>
      sql.includes('from app.employee where id=$1')
        ? { rows: [{ id: 'e1' }], rowCount: 1 }
        : sql.includes('count(*)')
          ? { rows: [{ count: '0' }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    );
    await listEmployeeDocuments(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      query: {
        page: 3,
        pageSize: 10,
        categoryId: 'cat1',
        approvalStatus: 'approved',
        currentOnly: false,
      },
    });
    const list = pool.calls.find((call) =>
      call.sql.includes('order by l.created_at'),
    )!;
    expect(list.params).toEqual(['e1', 'cat1', 'approved', false, 10, 20]);
    expect(list.sql).toContain(
      'successor.supersedes_document_id=l.document_id',
    );
  });
  it('lists only operational or uncategorized document links with stable paging', async () => {
    const pool = fakePool((sql) =>
      sql.includes('count(*)')
        ? { rows: [{ count: '2' }], rowCount: 1 }
        : sql.includes('from app.employee where id=$1')
          ? { rows: [{ id: 'e1' }], rowCount: 1 }
          : {
              rows: [
                {
                  document_id: 'doc1',
                  title: 'Document',
                  document_date: '2026-01-01',
                  category_id: null,
                  relationship_id: null,
                  approval_status: 'not_required',
                  approved_by: null,
                  approved_at: null,
                  supersedes_document_id: null,
                  created_at: new Date(0),
                },
              ],
              rowCount: 1,
            },
    );
    const result = await listEmployeeDocuments(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      query: {
        page: 2,
        pageSize: 1,
        currentOnly: true,
        approvalStatus: 'pending',
      },
    });
    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    const list = pool.calls.find((call) =>
      call.sql.includes('order by l.created_at'),
    )!;
    expect(list.sql).toContain(
      "l.category_id is null or c.confidentiality='operational'",
    );
    expect(list.sql).toContain('order by l.created_at desc,l.document_id asc');
    expect(list.params).toEqual(['e1', null, 'pending', true, 1, 1]);
  });
  it('derives link approval from the category and rolls back its audit failure', async () => {
    for (const approval_status of ['pending', 'not_required'] as const) {
      const pool = fakePool((sql) =>
        sql.startsWith('insert into app.employee_document')
          ? {
              rows: [
                {
                  document_id: 'doc1',
                  title: 'Document',
                  document_date: '2026-01-01',
                  category_id: 'cat1',
                  relationship_id: null,
                  approval_status,
                  approved_by: null,
                  approved_at: null,
                  supersedes_document_id: null,
                  created_at: new Date(0),
                },
              ],
              rowCount: 1,
            }
          : { rows: [{ id: 'visible' }], rowCount: 1 },
      );
      await expect(
        linkEmployeeDocument(pool, {
          ...scope,
          employeeId: 'e1',
          legalEntityIds: ['le1'],
          body: {
            documentId: 'doc1',
            categoryId: 'cat1',
            relationshipId: null,
            supersedesDocumentId: null,
          },
        }),
      ).resolves.toMatchObject({ approvalStatus: approval_status });
      expect(
        pool.calls.find((call) =>
          call.sql.startsWith('insert into app.employee_document'),
        )?.sql,
      ).toContain(
        "case when c.requires_approval then 'pending' else 'not_required' end",
      );
    }
    const rollbackPool = fakePool((sql) => {
      if (sql.startsWith('insert into app.employee_document'))
        return {
          rows: [
            {
              document_id: 'doc1',
              title: 'Document',
              document_date: '2026-01-01',
              category_id: 'cat1',
              relationship_id: null,
              approval_status: 'pending',
              approved_by: null,
              approved_at: null,
              supersedes_document_id: null,
              created_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      if (sql.includes('record_audit')) throw new Error('audit failed');
      return { rows: [{ id: 'visible' }], rowCount: 1 };
    });
    await expect(
      linkEmployeeDocument(rollbackPool, {
        ...scope,
        employeeId: 'e1',
        legalEntityIds: ['le1'],
        body: {
          documentId: 'doc1',
          categoryId: 'cat1',
          relationshipId: null,
          supersedesDocumentId: null,
        },
      }),
    ).rejects.toThrow('audit failed');
    expect(rollbackPool.calls.map((call) => call.sql)).toContain('rollback');
    expect(
      isEmployeeDocumentConflict({
        code: '23505',
        constraint: 'employee_document_pkey',
      }),
    ).toBe(true);
  });
  it('updates document approval atomically and rejects invisible or invalid transitions', async () => {
    const row = (approval_status: 'pending' | 'not_required' | 'approved') => ({
      document_id: 'doc1',
      title: 'Document',
      document_date: '2026-01-01',
      category_id: 'cat1',
      relationship_id: null,
      approval_status,
      approved_by: null,
      approved_at: null,
      supersedes_document_id: null,
      created_at: new Date(0),
      requires_approval: approval_status === 'pending',
    });
    const pool = fakePool((sql) => {
      if (sql.includes('for update'))
        return { rows: [row('pending')], rowCount: 1 };
      if (sql.includes('select 1 where'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.startsWith('update app.employee_document'))
        return {
          rows: [
            {
              ...row('approved'),
              approved_by: 'user',
              approved_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateEmployeeDocument(pool, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { approvalDecision: 'approved' },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'approved',
      approvedBy: 'user',
    });
    const update = pool.calls.find((call) =>
      call.sql.startsWith('update app.employee_document'),
    )!;
    expect(
      pool.calls.find((call) => call.sql.includes('for update'))?.sql,
    ).toContain('for update of l');
    expect(update.sql).toContain('when $7::text is not null then $7');
    expect(
      pool.calls.find((call) => call.sql.includes('record_audit'))?.params,
    ).toEqual(['doc1']);
    const invalid = fakePool((sql) =>
      sql.includes('for update')
        ? { rows: [row('not_required')], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    await expect(
      updateEmployeeDocument(invalid, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { approvalDecision: 'approved' },
      }),
    ).rejects.toBeInstanceOf(HrEmployeeDocumentConflictError);
    const uncategorized = fakePool((sql) =>
      sql.includes('for update')
        ? { rows: [{ ...row('not_required'), category_id: null }], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    await expect(
      updateEmployeeDocument(uncategorized, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { relationshipId: null },
      }),
    ).rejects.toBeInstanceOf(HrEmployeeDocumentNotFoundError);
    const categoryThenDecision = fakePool((sql) => {
      if (sql.includes('for update'))
        return { rows: [row('not_required')], rowCount: 1 };
      if (sql.includes('select 1 where'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.startsWith('update app.employee_document'))
        return {
          rows: [
            {
              ...row('approved'),
              category_id: 'cat2',
              approved_by: 'user',
              approved_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      if (sql.includes('select requires_approval'))
        return { rows: [{ requires_approval: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateEmployeeDocument(categoryThenDecision, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { categoryId: 'cat2', approvalDecision: 'approved' },
      }),
    ).resolves.toMatchObject({
      approvalStatus: 'approved',
      categoryId: 'cat2',
      approvedBy: 'user',
    });
    const categoryWithoutApproval = fakePool((sql) => {
      if (sql.includes('for update'))
        return { rows: [row('not_required')], rowCount: 1 };
      if (sql.includes('select 1 where'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes('select requires_approval'))
        return { rows: [{ requires_approval: false }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateEmployeeDocument(categoryWithoutApproval, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { categoryId: 'cat2', approvalDecision: 'rejected' },
      }),
    ).rejects.toBeInstanceOf(HrEmployeeDocumentConflictError);
    const updateRollback = fakePool((sql) => {
      if (sql.includes('for update'))
        return { rows: [row('pending')], rowCount: 1 };
      if (sql.includes('select 1 where'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.startsWith('update app.employee_document'))
        return {
          rows: [
            {
              ...row('approved'),
              approved_by: 'user',
              approved_at: new Date(0),
            },
          ],
          rowCount: 1,
        };
      if (sql.includes('record_audit')) throw new Error('audit failed');
      return { rows: [], rowCount: 1 };
    });
    await expect(
      updateEmployeeDocument(updateRollback, {
        ...scope,
        employeeId: 'e1',
        documentId: 'doc1',
        legalEntityIds: ['le1'],
        body: { approvalDecision: 'approved' },
      }),
    ).rejects.toThrow('audit failed');
    expect(updateRollback.calls.map((call) => call.sql)).toContain('rollback');
  });
  it('filters employees, escapes wildcards, and returns page metadata', async () => {
    const pool = fakePool((sql) =>
      sql.includes('count(*)')
        ? { rows: [{ count: '3' }] }
        : { rows: [employeeRow], rowCount: 1 },
    );
    const result = await listEmployees(pool, {
      ...scope,
      legalEntityIds: ['le1'],
      query: {
        page: 2,
        pageSize: 1,
        legalEntityId: 'le1',
        status: 'active',
        q: 'a%_\\b',
      },
    });
    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    const page = pool.calls.find((x) => x.sql.includes('order by last_name'))!;
    expect(page.params).toEqual([
      ['le1'],
      'le1',
      'active',
      '%a\\%\\_\\\\b%',
      1,
      1,
    ]);
    expect(page.sql).toContain(
      'order by last_name asc, first_name asc, id asc',
    );
  });

  it('reads an employee directly by id, beyond the default page', async () => {
    const pool = fakePool((sql) =>
      sql.includes('from app.employee')
        ? { rows: [employeeRow], rowCount: 1 }
        : { rows: [] },
    );
    await expect(
      readEmployee(pool, {
        ...scope,
        employeeId: 'e1',
        legalEntityIds: ['le1'],
      }),
    ).resolves.toMatchObject({ id: 'e1' });
    expect(
      pool.calls.find((x) => x.sql.includes('where id=$1'))?.sql,
    ).toContain('where id=$1');
  });
});

describe('HR transactional audit coverage', () => {
  const relationshipRow = {
    id: 'rel1',
    employee_id: 'e1',
    kind: 'employment',
    position: 'Engineer',
    department: null,
    cost_centre: null,
    weekly_hours: '40',
    start_date: '2026-01-01',
    end_date: null,
    created_at: new Date(0),
    updated_at: new Date(0),
  };

  it('formats PostgreSQL relationship DATE values without timezone drift', async () => {
    const pool = fakePool((sql) =>
      sql.startsWith('insert into app.employment_relationship')
        ? {
            rows: [
              {
                ...relationshipRow,
                start_date: new Date('2026-01-01T00:00:00.000Z'),
                end_date: new Date('2026-12-31T00:00:00.000Z'),
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    const result = await createRelationship(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        kind: 'employment',
        position: 'Engineer',
        department: null,
        costCentre: null,
        weeklyHours: '40',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
    });
    expect(result).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
  });

  it('preserves a nullable relationship end date from PostgreSQL', async () => {
    const pool = fakePool((sql) =>
      sql.startsWith('insert into app.employment_relationship')
        ? {
            rows: [
              {
                ...relationshipRow,
                start_date: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    const result = await createRelationship(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        kind: 'employment',
        position: 'Engineer',
        department: null,
        costCentre: null,
        weeklyHours: '40',
        startDate: '2026-01-01',
        endDate: null,
      },
    });
    expect(result).toMatchObject({ startDate: '2026-01-01', endDate: null });
  });

  function expectAudit(
    pool: DatabasePool & { calls: { sql: string; params?: unknown[] }[] },
    action: string,
    resourceId: string,
    mutation: string,
    metadata?: unknown,
  ) {
    const mutationIndex = pool.calls.findIndex((call) =>
      call.sql.startsWith(mutation),
    );
    const auditIndex = pool.calls.findIndex((call) =>
      call.sql.includes(`record_audit('${action}'`),
    );
    expect(auditIndex).toBeGreaterThan(mutationIndex);
    expect(pool.calls[auditIndex]?.params?.[0]).toBe(resourceId);
    if (metadata !== undefined)
      expect(pool.calls[auditIndex]?.params?.[1]).toBe(
        JSON.stringify(metadata),
      );
    expect(JSON.stringify(pool.calls[auditIndex]?.params)).not.toMatch(
      /Ada|Lovelace|email|phone|1000|amount/i,
    );
  }

  it('audits employee creation in the same transaction with opaque metadata', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('from app.legal_entity')) {
        return { rows: [{ id: 'le1' }], rowCount: 1 };
      }
      if (sql.startsWith('insert into app.employee')) {
        return { rows: [employeeRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await createEmployee(pool, {
      ...scope,
      legalEntityIds: ['le1'],
      body: {
        legalEntityId: 'le1',
        employeeNumber: 'E1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        workEmail: 'ada@example.test',
        workPhone: '+420123456789',
      },
    });
    const audit = pool.calls.find((call) => call.sql.includes('record_audit'));
    const insert = pool.calls.find((call) =>
      call.sql.startsWith('insert into app.employee'),
    );
    expect(insert?.sql).toContain("'preboarding'");
    expect(insert?.params).toEqual([
      'org',
      'le1',
      'E1',
      'Ada',
      'Lovelace',
      'ada@example.test',
      '+420123456789',
      'user',
    ]);
    expect(audit).toBeDefined();
    expect(audit?.params).toEqual(['e1']);
    expect(
      pool.calls.findIndex((call) =>
        call.sql.startsWith('insert into app.employee'),
      ),
    ).toBeLessThan(
      pool.calls.findIndex((call) => call.sql.includes('record_audit')),
    );
    expect(JSON.stringify(audit?.params)).not.toMatch(
      /Ada|Lovelace|ada@example\.test|\+420123456789|1000/,
    );
  });

  it('audits employee updates with the employee identifier only', async () => {
    const pool = fakePool((sql) =>
      sql.startsWith('update app.employee')
        ? { rows: [employeeRow], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    await updateEmployee(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: { firstName: 'Ada' },
    });
    expectAudit(pool, 'employee.updated', 'e1', 'update app.employee');
  });

  it('audits relationship creation with the relationship identifier only', async () => {
    const createPool = fakePool((sql) =>
      sql.startsWith('insert into app.employment_relationship')
        ? { rows: [relationshipRow], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    await createRelationship(createPool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        kind: 'employment',
        position: 'Engineer',
        department: null,
        costCentre: null,
        weeklyHours: '40',
        startDate: '2026-01-01',
        endDate: null,
      },
    });
    expectAudit(
      createPool,
      'employment_relationship.created',
      'rel1',
      'insert into app.employment_relationship',
    );
  });

  it('audits employee-document links with the document identifier only', async () => {
    const pool = fakePool((sql) =>
      sql.startsWith('insert into app.employee_document')
        ? {
            rows: [
              {
                document_id: 'doc1',
                title: 'Document',
                document_date: '2026-01-01',
                category_id: 'category1',
                relationship_id: null,
                approval_status: 'not_required',
                approved_by: null,
                approved_at: null,
                supersedes_document_id: null,
                created_at: new Date(0),
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    await linkEmployeeDocument(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        documentId: 'doc1',
        categoryId: 'category1',
        relationshipId: null,
        supersedesDocumentId: null,
      },
    });
    expectAudit(
      pool,
      'employee_document.linked',
      'doc1',
      'insert into app.employee_document',
    );
  });

  it('rolls back the mutation when the in-transaction audit fails', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('from app.legal_entity')) {
        return { rows: [{ id: 'le1' }], rowCount: 1 };
      }
      if (sql.startsWith('insert into app.employee')) {
        return { rows: [employeeRow], rowCount: 1 };
      }
      if (sql.includes('record_audit')) throw new Error('audit failed');
      return { rows: [], rowCount: 0 };
    });
    await expect(
      createEmployee(pool, {
        ...scope,
        legalEntityIds: ['le1'],
        body: {
          legalEntityId: 'le1',
          employeeNumber: 'E1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          workEmail: null,
          workPhone: null,
        },
      }),
    ).rejects.toThrow('audit failed');
    expect(pool.calls.map((call) => call.sql)).toContain('rollback');
  });
});

describe('employee lifecycle transitions', () => {
  const changeRow = {
    id: '2b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
    employee_id: 'e1',
    from_status: 'preboarding',
    to_status: 'active',
    effective_at: new Date('2026-09-20T10:00:00.000Z'),
    reason: null,
    created_at: new Date('2026-09-20T10:01:00.000Z'),
  };
  function transitionPool(
    status: string,
    options: { auditFails?: boolean } = {},
  ) {
    return fakePool((sql, params) => {
      if (sql.includes('for update'))
        return { rows: [{ id: 'e1', status }], rowCount: 1 };
      if (sql.startsWith('insert into app.employee_status_change'))
        return {
          rows: [{ ...changeRow, from_status: status, to_status: params?.[3] }],
          rowCount: 1,
        };
      if (sql.includes('record_audit') && options.auditFails)
        throw new Error('audit failed');
      return { rows: [], rowCount: 1 };
    });
  }
  async function transition(status: string, toStatus: string, reason?: string) {
    return transitionEmployeeStatus(transitionPool(status), {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        toStatus: toStatus as
          'preboarding' | 'active' | 'inactive' | 'archived' | 'cancelled',
        effectiveAt: '2026-09-20T10:00:00.000Z',
        ...(reason === undefined ? {} : { reason }),
      },
    });
  }
  it('allows only the fixed edges and requires a reactivation reason', async () => {
    for (const [from, to, reason] of [
      ['preboarding', 'active', undefined],
      ['preboarding', 'cancelled', undefined],
      ['active', 'inactive', undefined],
      ['inactive', 'active', 'returning'],
      ['inactive', 'archived', undefined],
    ] as const) {
      await expect(transition(from, to, reason)).resolves.toMatchObject({
        fromStatus: from,
        toStatus: to,
      });
    }
    await expect(transition('inactive', 'active')).rejects.toBeInstanceOf(
      HrEmployeeStatusReasonError,
    );
    await expect(
      transition('preboarding', 'active', 'unneeded'),
    ).rejects.toBeInstanceOf(HrEmployeeStatusReasonError);
    for (const [from, to] of [
      ['preboarding', 'inactive'],
      ['active', 'archived'],
      ['inactive', 'cancelled'],
      ['archived', 'active'],
      ['cancelled', 'active'],
    ] as const) {
      await expect(transition(from, to)).rejects.toBeInstanceOf(
        HrEmployeeStatusConflictError,
      );
    }
  });
  it('locks before deciding, commits history/current state/audit together, and rolls back audit failure', async () => {
    const pool = transitionPool('preboarding');
    await transitionEmployeeStatus(pool, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: { toStatus: 'active', effectiveAt: '2026-09-20T10:00:00.000Z' },
    });
    const lock = pool.calls.findIndex((call) =>
      call.sql.includes('for update'),
    );
    const insert = pool.calls.findIndex((call) =>
      call.sql.startsWith('insert into app.employee_status_change'),
    );
    const update = pool.calls.findIndex((call) =>
      call.sql.startsWith('update app.employee set status'),
    );
    expect(lock).toBeLessThan(insert);
    expect(insert).toBeLessThan(update);
    expect(
      pool.calls.find((call) => call.sql.includes('record_audit'))?.params,
    ).toEqual(['e1']);
    const failing = transitionPool('preboarding', { auditFails: true });
    await expect(
      transitionEmployeeStatus(failing, {
        ...scope,
        employeeId: 'e1',
        legalEntityIds: ['le1'],
        body: { toStatus: 'active', effectiveAt: '2026-09-20T10:00:00.000Z' },
      }),
    ).rejects.toThrow('audit failed');
    expect(failing.calls.map((call) => call.sql)).toContain('rollback');
  });
  it('serializes competing commands so the loser observes the winner status', async () => {
    let status = 'preboarding';
    const pool = fakePool((sql, params) => {
      if (sql.includes('for update'))
        return { rows: [{ id: 'e1', status }], rowCount: 1 };
      if (sql.startsWith('insert into app.employee_status_change'))
        return {
          rows: [{ ...changeRow, from_status: status, to_status: params?.[3] }],
          rowCount: 1,
        };
      if (sql.startsWith('update app.employee set status')) {
        status = params?.[1] as string;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const input = {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      body: {
        toStatus: 'active' as const,
        effectiveAt: '2026-09-20T10:00:00.000Z',
      },
    };
    await expect(transitionEmployeeStatus(pool, input)).resolves.toMatchObject({
      toStatus: 'active',
    });
    await expect(transitionEmployeeStatus(pool, input)).rejects.toBeInstanceOf(
      HrEmployeeStatusConflictError,
    );
  });
  it('returns 404 for invisible employees and pages status history in contract order', async () => {
    const invisible = fakePool(() => ({ rows: [], rowCount: 0 }));
    await expect(
      transitionEmployeeStatus(invisible, {
        ...scope,
        employeeId: 'e1',
        legalEntityIds: ['le1'],
        body: { toStatus: 'active', effectiveAt: '2026-09-20T10:00:00.000Z' },
      }),
    ).rejects.toBeInstanceOf(HrEmployeeNotFoundError);
    const history = fakePool((sql) => {
      if (sql.startsWith('select 1 from app.employee'))
        return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '1' }], rowCount: 1 };
      return { rows: [changeRow], rowCount: 1 };
    });
    const result = await listEmployeeStatusHistory(history, {
      ...scope,
      employeeId: 'e1',
      legalEntityIds: ['le1'],
      query: { page: 2, pageSize: 5 },
    });
    expect(result).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 1,
      items: [
        {
          effectiveAt: '2026-09-20T10:00:00.000Z',
          createdAt: '2026-09-20T10:01:00.000Z',
        },
      ],
    });
    expect(
      history.calls.find((call) => call.sql.includes('order by effective_at'))
        ?.params,
    ).toEqual(['e1', 5, 5]);
    expect(
      history.calls.find((call) => call.sql.includes('order by effective_at'))
        ?.sql,
    ).toContain('order by effective_at desc, created_at desc, id asc');
  });
});

const termIds = {
  employee: '1b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
  relationship: '2b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
  predecessor: '3b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
  term: '4b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
};
const termRow = {
  id: termIds.term,
  employee_id: termIds.employee,
  relationship_id: termIds.relationship,
  version: 2,
  supersedes_employment_term_id: termIds.predecessor,
  effective_from: new Date('2026-02-01T00:00:00.000Z'),
  effective_to: null,
  position_id: null,
  department_id: null,
  cost_centre_id: null,
  workplace_id: null,
  manager_employee_id: null,
  weekly_hours: '40.00',
  working_time_pattern: 'standard',
  created_at: new Date(0),
};
const termBody = {
  relationshipId: termIds.relationship,
  supersedesEmploymentTermId: null,
  effectiveFrom: '2026-02-01',
  effectiveTo: null,
  positionId: null,
  departmentId: null,
  costCentreId: null,
  workplaceId: null,
  managerEmployeeId: null,
  weeklyHours: '40',
  workingTimePattern: 'standard',
};

describe('employment-term repository', () => {
  it('recognizes both term uniqueness constraints, but not an unknown conflict', () => {
    expect(
      isDuplicateHrRecord({
        code: '23505',
        constraint: 'employment_term_relationship_version_key',
      }),
    ).toBe(true);
    expect(
      isDuplicateHrRecord({
        code: '23505',
        constraint: 'employment_term_supersedes_successor_key',
      }),
    ).toBe(true);
    expect(
      isDuplicateHrRecord({
        code: '23505',
        constraint: 'employment_term_unknown_key',
      }),
    ).toBe(false);
  });

  it('returns backfilled history in stable order with relationship paging and normalized values', async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.startsWith('select 1 from app.employment_relationship'))
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '3' }], rowCount: 1 };
      if (sql.startsWith('select t.*')) return { rows: [termRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await listEmploymentTerms(pool, {
      ...scope,
      employeeId: termIds.employee,
      legalEntityIds: ['le1'],
      query: { relationshipId: termIds.relationship, page: 2, pageSize: 1 },
    });
    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(result.items[0]).toMatchObject({
      effectiveFrom: '2026-02-01',
      effectiveTo: null,
      weeklyHours: '40.00',
    });
    const page = pool.calls.find((call) => call.sql.startsWith('select t.*'))!;
    expect(page.sql).toContain(
      'order by t.effective_from desc, t.version desc, t.id asc limit $3 offset $4',
    );
    expect(page.params).toEqual([termIds.employee, termIds.relationship, 1, 1]);
    expect(
      pool.calls.find((call) => call.sql.includes('count(*)'))?.params,
    ).toEqual([termIds.employee, termIds.relationship]);
  });

  it('uses the successor-effective current-term rule before and after a correction takes effect', async () => {
    let termReads = 0;
    const predecessor = {
      ...termRow,
      id: termIds.predecessor,
      version: 1,
      effective_from: '2026-01-01',
    };
    const pool = fakePool((sql) => {
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '1' }], rowCount: 1 };
      if (sql.includes('select * from ranked')) {
        termReads += 1;
        return {
          rows: [termReads === 1 ? predecessor : termRow],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const results = [];
    for (const effectiveOn of ['2026-01-31', '2026-02-01']) {
      results.push(
        await listEmploymentTerms(pool, {
          ...scope,
          employeeId: termIds.employee,
          legalEntityIds: ['le1'],
          query: { effectiveOn, page: 1, pageSize: 25 },
        }),
      );
    }
    const currentQueries = pool.calls.filter((call) =>
      call.sql.includes('select * from ranked'),
    );
    expect(currentQueries).toHaveLength(2);
    expect(currentQueries[0]?.sql).toContain('successor.effective_from <= $3');
    expect(currentQueries[0]?.sql).toContain(
      'row_number() over (partition by t.relationship_id order by t.effective_from desc, t.version desc, t.id asc)',
    );
    expect(currentQueries.map((call) => call.params?.[2])).toEqual([
      '2026-01-31',
      '2026-02-01',
    ]);
    expect(
      pool.calls
        .filter((call) => call.sql.includes('count(*)'))
        .map((call) => call.params),
    ).toEqual([
      [termIds.employee, null, '2026-01-31'],
      [termIds.employee, null, '2026-02-01'],
    ]);
    expect(results.map((result) => result.items[0]?.id)).toEqual([
      termIds.predecessor,
      termIds.term,
    ]);
  });

  it('returns one deterministic current term per relationship from an overlapping chain', async () => {
    const otherRelationship = '5b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
    const otherTerm = {
      ...termRow,
      id: '6b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21',
      relationship_id: otherRelationship,
      version: 3,
      effective_from: '2026-03-01',
    };
    const pool = fakePool((sql) => {
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.includes('count(*)'))
        return { rows: [{ count: '2' }], rowCount: 1 };
      if (sql.includes('select * from ranked'))
        return { rows: [otherTerm, termRow], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });
    const result = await listEmploymentTerms(pool, {
      ...scope,
      employeeId: termIds.employee,
      legalEntityIds: ['le1'],
      query: { effectiveOn: '2026-03-15', page: 1, pageSize: 25 },
    });
    expect(result).toMatchObject({ total: 2 });
    expect(result.items.map((item) => item.id)).toEqual([
      otherTerm.id,
      termIds.term,
    ]);
    const query = pool.calls.find((call) =>
      call.sql.includes('select * from ranked'),
    )!;
    expect(query.sql).toContain('where term_rank=1');
  });

  it('locks one relationship, creates a root, and audits identifiers only', async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_relationship'))
        return { rows: [{ id: termIds.relationship }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_term'))
        return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into app.employment_term'))
        return { rows: [termRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const result = await createEmploymentTerm(pool, {
      ...scope,
      employeeId: termIds.employee,
      legalEntityIds: ['le1'],
      body: termBody,
    });
    expect(result).toMatchObject({ id: termIds.term, weeklyHours: '40.00' });
    const lock = pool.calls.findIndex((call) =>
      call.sql.includes('pg_advisory_xact_lock'),
    );
    const existing = pool.calls.findIndex((call) =>
      call.sql.startsWith('select id from app.employment_term'),
    );
    expect(pool.calls[lock]?.params).toEqual([termIds.relationship]);
    expect(lock).toBeLessThan(existing);
    const insert = pool.calls.find((call) =>
      call.sql.startsWith('insert into app.employment_term'),
    )!;
    expect(insert.params?.[3]).toBe(1);
    const audit = pool.calls.find((call) =>
      call.sql.includes("record_audit('employment_term.created'"),
    );
    expect(audit?.params).toEqual([termIds.term]);
    expect(JSON.stringify(audit?.params)).not.toMatch(/40|standard|amount/i);
  });

  it('permits roots for separate relationships and derives a complete correction snapshot at the next version', async () => {
    const secondRelationship = '5b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
    const pool = fakePool((sql, params) => {
      if (sql.includes('for update'))
        throw new Error(
          'immutable employment terms cannot be locked for update',
        );
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_relationship'))
        return { rows: [{ id: params?.[0] }], rowCount: 1 };
      if (sql.startsWith('select * from app.employment_term'))
        return { rows: [{ ...termRow, version: 1 }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_term'))
        return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into app.employment_term'))
        return { rows: [termRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    for (const relationshipId of [termIds.relationship, secondRelationship]) {
      await expect(
        createEmploymentTerm(pool, {
          ...scope,
          employeeId: termIds.employee,
          legalEntityIds: ['le1'],
          body: { ...termBody, relationshipId },
        }),
      ).resolves.toMatchObject({ id: termIds.term });
    }
    await createEmploymentTerm(pool, {
      ...scope,
      employeeId: termIds.employee,
      legalEntityIds: ['le1'],
      body: { ...termBody, supersedesEmploymentTermId: termIds.predecessor },
    });
    const inserts = pool.calls.filter((call) =>
      call.sql.startsWith('insert into app.employment_term'),
    );
    expect(inserts.map((call) => call.params?.[2])).toEqual([
      termIds.relationship,
      secondRelationship,
      termIds.relationship,
    ]);
    expect(inserts[2]?.params?.slice(3, 14)).toEqual([
      2,
      termIds.predecessor,
      '2026-02-01',
      null,
      null,
      null,
      null,
      null,
      null,
      '40',
      'standard',
    ]);
  });

  it('rejects invisible employee, relationship, reference, and manager dependencies before insertion', async () => {
    const scenarios = [
      ['employee', () => ({ rows: [], rowCount: 0 })],
      [
        'relationship',
        (sql: string) =>
          sql.startsWith('select legal_entity_id')
            ? { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 }
            : { rows: [], rowCount: 0 },
      ],
      [
        'reference',
        (sql: string) => {
          if (sql.startsWith('select legal_entity_id'))
            return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
          if (sql.startsWith('select id from app.employment_relationship'))
            return { rows: [{ id: termIds.relationship }], rowCount: 1 };
          if (sql.includes('from app.hr_position'))
            return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 1 };
        },
      ],
      [
        'manager',
        (sql: string) => {
          if (sql.startsWith('select legal_entity_id'))
            return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
          if (sql.startsWith('select id from app.employment_relationship'))
            return { rows: [{ id: termIds.relationship }], rowCount: 1 };
          if (
            sql.includes('from app.employee where id=$1 and legal_entity_id=$2')
          )
            return { rows: [], rowCount: 0 };
          return { rows: [], rowCount: 1 };
        },
      ],
    ] as const;
    for (const [_label, handler] of scenarios) {
      const pool = fakePool(
        handler as (sql: string, params?: unknown[]) => unknown,
      );
      await expect(
        createEmploymentTerm(pool, {
          ...scope,
          employeeId: termIds.employee,
          legalEntityIds: ['le1'],
          body: {
            ...termBody,
            positionId: _label === 'reference' ? termIds.term : null,
            managerEmployeeId: _label === 'manager' ? termIds.term : null,
          },
        }),
      ).resolves.toBeNull();
      expect(
        pool.calls.some((call) =>
          call.sql.startsWith('insert into app.employment_term'),
        ),
      ).toBe(false);
    }
  });

  it('rejects duplicate roots and branching corrections, and rolls the term back when its audit fails', async () => {
    for (const supersedesEmploymentTermId of [null, termIds.predecessor]) {
      const pool = fakePool((sql) => {
        if (sql.startsWith('select legal_entity_id'))
          return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
        if (sql.startsWith('select id from app.employment_relationship'))
          return { rows: [{ id: termIds.relationship }], rowCount: 1 };
        if (sql.startsWith('select * from app.employment_term'))
          return { rows: [termRow], rowCount: 1 };
        if (sql.startsWith('select id from app.employment_term'))
          return { rows: [{ id: termIds.term }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      });
      await expect(
        createEmploymentTerm(pool, {
          ...scope,
          employeeId: termIds.employee,
          legalEntityIds: ['le1'],
          body: { ...termBody, supersedesEmploymentTermId },
        }),
      ).rejects.toBeInstanceOf(HrTermConflictError);
    }
    const pool = fakePool((sql) => {
      if (sql.startsWith('select legal_entity_id'))
        return { rows: [{ legal_entity_id: 'le1' }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_relationship'))
        return { rows: [{ id: termIds.relationship }], rowCount: 1 };
      if (sql.startsWith('select id from app.employment_term'))
        return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into app.employment_term'))
        return { rows: [termRow], rowCount: 1 };
      if (sql.includes('record_audit')) throw new Error('audit failed');
      return { rows: [], rowCount: 1 };
    });
    await expect(
      createEmploymentTerm(pool, {
        ...scope,
        employeeId: termIds.employee,
        legalEntityIds: ['le1'],
        body: termBody,
      }),
    ).rejects.toThrow('audit failed');
    expect(pool.calls.map((call) => call.sql)).toContain('rollback');
  });
});
