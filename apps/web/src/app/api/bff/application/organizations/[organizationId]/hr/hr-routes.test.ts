import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(
  process.cwd(),
  'src/app/api/bff/application/organizations/[organizationId]/hr',
);

const routes = [
  [
    'departments/route.ts',
    ['GET', 'POST'],
    ['getDepartments', 'postDepartment'],
  ],
  ['departments/[referenceId]/route.ts', ['PATCH'], ['patchDepartment']],
  ['positions/route.ts', ['GET', 'POST'], ['getPositions', 'postPosition']],
  ['positions/[referenceId]/route.ts', ['PATCH'], ['patchPosition']],
  [
    'cost-centres/route.ts',
    ['GET', 'POST'],
    ['getCostCentres', 'postCostCentre'],
  ],
  ['cost-centres/[referenceId]/route.ts', ['PATCH'], ['patchCostCentre']],
  ['workplaces/route.ts', ['GET', 'POST'], ['getWorkplaces', 'postWorkplace']],
  ['workplaces/[referenceId]/route.ts', ['PATCH'], ['patchWorkplace']],
  [
    'document-categories/route.ts',
    ['GET', 'POST'],
    ['getDocumentCategories', 'postDocumentCategory'],
  ],
  [
    'document-categories/[referenceId]/route.ts',
    ['PATCH'],
    ['patchDocumentCategory'],
  ],
  [
    'checklist-templates/route.ts',
    ['GET', 'POST'],
    ['getChecklistTemplates', 'postChecklistTemplate'],
  ],
  [
    'checklist-templates/[templateId]/route.ts',
    ['PATCH'],
    ['patchChecklistTemplate'],
  ],
  [
    'checklist-templates/[templateId]/items/route.ts',
    ['POST'],
    ['postChecklistTemplateItem'],
  ],
  [
    'checklist-templates/[templateId]/items/[itemId]/route.ts',
    ['PATCH'],
    ['patchChecklistTemplateItem'],
  ],
] as const;

describe('HR reference BFF route inventory', () => {
  it.each(routes)(
    '%s exports only the contracted methods and delegates to %j',
    (route, methods, delegates) => {
      const source = readFileSync(join(root, route), 'utf8');
      for (const method of methods)
        expect(source).toContain(`export async function ${method}`);
      for (const delegate of delegates) expect(source).toContain(delegate);
      expect(source).toContain('getAuth');
    },
  );
});

const employeeRoot = join(
  process.cwd(),
  'src/app/api/bff/application/organizations/[organizationId]/employees/[employeeId]/checklists',
);

describe('checklist employee BFF route inventory', () => {
  it.each([
    [
      'route.ts',
      ['GET', 'POST'],
      ['getEmployeeChecklists', 'postEmployeeChecklist'],
    ],
    [
      '[checklistId]/tasks/[taskId]/route.ts',
      ['PATCH'],
      ['patchChecklistTask'],
    ],
  ] as const)(
    '%s exports only contracted checklist handlers and delegates through auth BFF',
    (route, methods, delegates) => {
      const source = readFileSync(join(employeeRoot, route), 'utf8');
      for (const method of methods)
        expect(source).toContain(`export async function ${method}`);
      for (const delegate of delegates) expect(source).toContain(delegate);
      expect(source).toContain('getAuth');
    },
  );
});
