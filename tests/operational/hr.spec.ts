import { expect, test } from './authenticated-test';
import { ensureLegalEntity } from './legal-entity-support';
import { signInThroughForm } from './sign-in';
import type { StorageState } from '@playwright/test';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';
const ownerEmail = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const adminEmail =
  process.env.BAP_OPERATIONAL_ADMIN_EMAIL ?? 'admin@bap.invalid';
const memberEmail =
  process.env.BAP_OPERATIONAL_MEMBER_EMAIL ?? 'member@bap.invalid';
const adminUserId = process.env.BAP_OPERATIONAL_ADMIN_USER_ID ?? '';
const root = `/api/bff/application/organizations/${organizationId}`;
const suffix = Date.now().toString(36);
const entityName = `Synthetic HR Entity ${suffix}`;
let adminStorageState: StorageState | undefined;

test.describe.serial('HR Wave 0 integration proof', () => {
  test('owner creates neutral HR records and opens both details', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(180_000);
    await ensureLegalEntity(page, organizationSlug, entityName);
    const entities = await page.request.get(`${root}/legal-entities`);
    expect(entities.status()).toBe(200);
    const entity = (
      (await entities.json()) as {
        legalEntities: { id: string; name: string }[];
      }
    ).legalEntities.find((x) => x.name === entityName);
    expect(entity).toBeDefined();
    const employee = async (number: string, firstName: string) => {
      const response = await page.request.post(`${root}/employees`, {
        data: {
          legalEntityId: entity!.id,
          employeeNumber: number,
          firstName,
          lastName: 'Synthetic',
          workEmail: null,
          workPhone: null,
        },
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: string };
    };
    const first = await employee(`SYN-${suffix}-1`, 'Neutral One');
    const second = await employee(`SYN-${suffix}-2`, 'Neutral Two');
    const relationship = await page.request.post(
      `${root}/employees/${first.id}/relationships`,
      {
        data: {
          kind: 'employment',
          position: 'Synthetic role',
          department: null,
          costCentre: null,
          weeklyHours: '40',
          startDate: '2026-01-01',
          endDate: null,
        },
      },
    );
    expect(relationship.status()).toBe(201);
    const document = await page.request.post(`${root}/documents`, {
      data: {
        documentDate: '2026-01-01',
        kind: 'other',
        legalEntityId: entity!.id,
        title: `Synthetic HR document ${suffix}`,
      },
    });
    expect(document.status()).toBe(201);
    const documentBody = (await document.json()) as {
      document: { id: string };
    };
    const documentId = documentBody.document.id;
    const category = await page.request.post(`${root}/hr/document-categories`, {
      data: {
        legalEntityId: entity!.id,
        code: `W0-DOC-${suffix}`,
        name: 'Synthetic document category',
        confidentiality: 'operational',
        retentionKey: `synthetic-w0-${suffix}`,
        requiresApproval: false,
      },
    });
    expect(category.status()).toBe(201);
    const categoryId = ((await category.json()) as { id: string }).id;
    const link = await page.request.post(
      `${root}/employees/${first.id}/documents`,
      { data: { documentId, categoryId } },
    );
    expect(link.status()).toBe(201);
    const payroll = await page.request.post(`${root}/payroll-runs`, {
      data: {
        legalEntityId: entity!.id,
        month: '2026-01',
        results: [
          {
            employeeId: first.id,
            grossPay: '1000',
            employeeSocial: '0',
            employeeHealth: '0',
            incomeTax: '0',
            otherDeductions: '0',
            netPay: '1000',
            employerSocial: '0',
            employerHealth: '0',
            totalEmployerCost: '1000',
          },
          {
            employeeId: second.id,
            grossPay: '1200',
            employeeSocial: '0',
            employeeHealth: '0',
            incomeTax: '0',
            otherDeductions: '0',
            netPay: '1200',
            employerSocial: '0',
            employerHealth: '0',
            totalEmployerCost: '1200',
          },
        ],
      },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(payroll.status()).toBe(201);
    const payrollId = ((await payroll.json()) as { id: string }).id;
    const employeeDetail = await page.request.get(
      `${root}/employees/${first.id}`,
    );
    expect(employeeDetail.status()).toBe(200);
    const payrollDetail = await page.request.get(
      `${root}/payroll-runs/${payrollId}`,
    );
    expect(payrollDetail.status()).toBe(200);
    await page.goto(`/employees/${first.id}?organization=${organizationSlug}`);
    await expect(page.getByLabel('First name')).toHaveValue('Neutral One');
    await page.goto(
      `/payroll/${payrollId}/results?organization=${organizationSlug}`,
    );
    await expect(
      page.getByRole('link', { name: 'Results', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(first.id)).toBeVisible();
  });

  test('admin can read HR while member is denied at the mutation boundaries', async ({
    browser,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    for (const [email, expected] of [
      [adminEmail, 200],
      [memberEmail, 403],
    ] as const) {
      const context = await browser.newContext({
        baseURL:
          process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
      });
      const login = await context.newPage();
      await signInThroughForm(login, email, password);
      if (email === adminEmail) {
        adminStorageState = await context.storageState();
      }
      const employees = await login.request.get(`${root}/employees`);
      expect(employees.status()).toBe(expected);
      const mutation = await login.request.post(`${root}/employees`, {
        data: {
          legalEntityId: '00000000-0000-0000-0000-000000000000',
          employeeNumber: `DENY-${suffix}`,
          firstName: 'Denied',
          lastName: 'Synthetic',
        },
      });
      expect(mutation.status()).toBe(expected === 200 ? 404 : 403);
      await context.close();
    }
  });

  test('owner proves Wave 1 HR workflows in the browser', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(180_000);
    const entities = await page.request.get(`${root}/legal-entities`);
    expect(entities.status()).toBe(200);
    const entity = (
      (await entities.json()) as {
        legalEntities: { id: string; name: string }[];
      }
    ).legalEntities.find((x) => x.name === entityName);
    expect(entity).toBeDefined();

    const createReference = async (
      collection: 'departments' | 'positions' | 'cost-centres' | 'workplaces',
      code: string,
      name: string,
    ) => {
      const response = await page.request.post(`${root}/hr/${collection}`, {
        data: { legalEntityId: entity!.id, code, name },
      });
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: string };
    };
    const department = await createReference(
      'departments',
      `DEPT-${suffix}`,
      'Synthetic department',
    );
    const position = await createReference(
      'positions',
      `POSITION-${suffix}`,
      'Synthetic position',
    );
    const costCentre = await createReference(
      'cost-centres',
      `COST-${suffix}`,
      'Synthetic cost centre',
    );
    const workplace = await createReference(
      'workplaces',
      `WORK-${suffix}`,
      'Synthetic workplace',
    );
    const categoryResponse = await page.request.post(
      `${root}/hr/document-categories`,
      {
        data: {
          legalEntityId: entity!.id,
          code: `DOC-${suffix}`,
          name: 'Synthetic approved document',
          confidentiality: 'operational',
          retentionKey: `synthetic-${suffix}`,
          requiresApproval: true,
        },
      },
    );
    expect(categoryResponse.status()).toBe(201);
    const category = (await categoryResponse.json()) as { id: string };
    await page.goto(
      `/hr-settings/structure?organization=${organizationSlug}&legalEntityId=${entity!.id}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Structure settings' }),
    ).toBeVisible();
    await expect(page.getByText('Synthetic department')).toBeVisible();

    const employeeResponse = await page.request.post(`${root}/employees`, {
      data: {
        legalEntityId: entity!.id,
        employeeNumber: `W1-${suffix}`,
        firstName: 'Wave One',
        lastName: 'Synthetic',
        workEmail: null,
        workPhone: null,
      },
    });
    expect(employeeResponse.status()).toBe(201);
    const employee = (await employeeResponse.json()) as { id: string };
    const relationshipResponse = await page.request.post(
      `${root}/employees/${employee.id}/relationships`,
      {
        data: {
          kind: 'employment',
          position: 'Synthetic position',
          department: null,
          costCentre: null,
          weeklyHours: '40',
          startDate: '2026-01-01',
          endDate: null,
        },
      },
    );
    expect(relationshipResponse.status()).toBe(201);
    const relationship = (await relationshipResponse.json()) as { id: string };
    const termResponse = await page.request.post(
      `${root}/employees/${employee.id}/employment-terms`,
      {
        data: {
          relationshipId: relationship.id,
          supersedesEmploymentTermId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          positionId: position.id,
          departmentId: department.id,
          costCentreId: costCentre.id,
          workplaceId: workplace.id,
          managerEmployeeId: null,
          weeklyHours: '40',
          workingTimePattern: 'standard',
        },
      },
    );
    expect(termResponse.status()).toBe(201);
    const term = (await termResponse.json()) as { id: string };
    const correctionResponse = await page.request.post(
      `${root}/employees/${employee.id}/employment-terms`,
      {
        data: {
          relationshipId: relationship.id,
          supersedesEmploymentTermId: term.id,
          effectiveFrom: '2026-02-01',
          effectiveTo: null,
          positionId: position.id,
          departmentId: department.id,
          costCentreId: costCentre.id,
          workplaceId: workplace.id,
          managerEmployeeId: null,
          weeklyHours: '37.5',
          workingTimePattern: 'standard',
        },
      },
    );
    expect(correctionResponse.status()).toBe(201);
    await page.goto(
      `/employees/${employee.id}/employment?organization=${organizationSlug}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Employment' }),
    ).toBeVisible();
    await expect(page.getByText('37.5')).toBeVisible();

    const documentResponse = await page.request.post(`${root}/documents`, {
      data: {
        documentDate: '2026-02-01',
        kind: 'other',
        legalEntityId: entity!.id,
        title: `Synthetic approval document ${suffix}`,
      },
    });
    expect(documentResponse.status()).toBe(201);
    const document = (await documentResponse.json()) as {
      document: { id: string };
    };
    const linkResponse = await page.request.post(
      `${root}/employees/${employee.id}/documents`,
      {
        data: {
          documentId: document.document.id,
          categoryId: category.id,
          relationshipId: relationship.id,
          supersedesDocumentId: null,
        },
      },
    );
    expect(linkResponse.status()).toBe(201);
    const approvalResponse = await page.request.patch(
      `${root}/employees/${employee.id}/documents/${document.document.id}`,
      { data: { approvalDecision: 'approved' } },
    );
    expect(approvalResponse.status()).toBe(200);
    await page.goto(
      `/employees/${employee.id}/documents?organization=${organizationSlug}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Documents' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Approved', exact: true }),
    ).toBeVisible();

    const templateResponse = await page.request.post(
      `${root}/hr/checklist-templates`,
      {
        data: {
          legalEntityId: entity!.id,
          kind: 'onboarding',
          code: `ONBOARD-${suffix}`,
          name: 'Synthetic onboarding checklist',
        },
      },
    );
    expect(templateResponse.status()).toBe(201);
    const template = (await templateResponse.json()) as { id: string };
    const itemResponse = await page.request.post(
      `${root}/hr/checklist-templates/${template.id}/items`,
      {
        data: {
          position: 1,
          title: 'Approve synthetic document',
          defaultDueOffsetDays: 0,
          documentCategoryId: category.id,
        },
      },
    );
    expect(itemResponse.status()).toBe(201);
    const checklistResponse = await page.request.post(
      `${root}/employees/${employee.id}/checklists`,
      {
        data: {
          templateId: template.id,
          relationshipId: relationship.id,
          startedOn: '2026-02-01',
          ownerUserId: 'operational-owner',
        },
      },
    );
    expect(checklistResponse.status()).toBe(201);
    const checklist = (await checklistResponse.json()) as {
      id: string;
      tasks: { id: string }[];
    };
    const taskId = checklist.tasks[0]?.id;
    expect(taskId).toBeDefined();
    const inProgress = await page.request.patch(
      `${root}/employees/${employee.id}/checklists/${checklist.id}/tasks/${taskId}`,
      { data: { status: 'in_progress' } },
    );
    expect(inProgress.status()).toBe(200);
    const completed = await page.request.patch(
      `${root}/employees/${employee.id}/checklists/${checklist.id}/tasks/${taskId}`,
      { data: { status: 'completed', documentId: document.document.id } },
    );
    expect(completed.status()).toBe(200);
    await page.goto(
      `/employees/${employee.id}/workflows?organization=${organizationSlug}&checklistId=${checklist.id}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Workflows' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'completed', exact: true }).first(),
    ).toBeVisible();
  });

  test('owner and assigned approver prove the payroll workflow in the browser', async ({
    browser,
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.skip(
      adminUserId.length === 0,
      'BAP_OPERATIONAL_ADMIN_USER_ID is required from the disposable account setup.',
    );
    test.setTimeout(180_000);

    const payrollEntityName = `Synthetic payroll entity ${suffix}`;
    await ensureLegalEntity(page, organizationSlug, payrollEntityName);
    const entities = await page.request.get(`${root}/legal-entities`);
    expect(entities.status()).toBe(200);
    const entity = (
      (await entities.json()) as {
        legalEntities: { id: string; name: string }[];
      }
    ).legalEntities.find((item) => item.name === payrollEntityName);
    expect(entity).toBeDefined();

    const employeeResponse = await page.request.post(`${root}/employees`, {
      data: {
        legalEntityId: entity!.id,
        employeeNumber: `W2-${suffix}`,
        firstName: 'Payroll',
        lastName: 'Synthetic',
        workEmail: null,
        workPhone: null,
      },
    });
    expect(employeeResponse.status()).toBe(201);
    const employee = (await employeeResponse.json()) as { id: string };
    const results = [
      {
        employeeId: employee.id,
        grossPay: '1000',
        employeeSocial: '0',
        employeeHealth: '0',
        incomeTax: '0',
        otherDeductions: '0',
        netPay: '1000',
        employerSocial: '0',
        employerHealth: '0',
        totalEmployerCost: '1000',
      },
    ];

    expect(
      adminStorageState,
      'Admin storage state was not captured by the boundary test.',
    ).toBeDefined();
    if (!adminStorageState) {
      throw new Error('Admin storage state was not captured.');
    }
    const adminContext = await browser.newContext({
      baseURL: process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
      storageState: adminStorageState,
    });
    const admin = await adminContext.newPage();
    expect((await admin.request.get(`${root}/payroll-runs`)).status()).toBe(
      403,
    );
    await admin.goto(`/payroll?organization=${organizationSlug}`);
    await expect(
      admin.getByText(
        'This account cannot read payroll data in this organization.',
      ),
    ).toBeVisible();

    await page.goto(`/hr-settings/access?organization=${organizationSlug}`);
    await expect(
      page.getByRole('heading', { name: 'Access assignments' }),
    ).toBeVisible();
    await page.getByLabel('User ID').fill(adminUserId);
    await page.getByLabel('Legal entity').fill(entity!.id);
    await page.getByLabel('Access role').selectOption('payroll_approver');
    await page.getByRole('button', { name: 'Create assignment' }).click();
    await expect(
      page.getByRole('cell', { name: 'Payroll approver', exact: true }),
    ).toBeVisible();

    await page.goto(`/payroll/new?organization=${organizationSlug}`);
    await page.getByLabel('Legal entity').selectOption(entity!.id);
    await page.getByLabel('Month').fill('2026-03');
    await page
      .getByLabel('Employee', { exact: true })
      .selectOption(employee.id);
    await page.getByLabel('Gross pay').fill('1000');
    await page.getByLabel('Employee social insurance').fill('0');
    await page.getByLabel('Employee health insurance').fill('0');
    await page.getByLabel('Income tax').fill('0');
    await page.getByLabel('Other deductions').fill('0');
    await page.getByLabel('Net pay').fill('1000');
    await page.getByLabel('Employer social insurance').fill('0');
    await page.getByLabel('Employer health insurance').fill('0');
    await page.getByLabel('Total employer cost').fill('1000');
    await page.getByRole('button', { name: 'Create payroll run' }).click();
    await expect(page).toHaveURL(
      /\/payroll\/[0-9a-f-]+\?organization=bap-operational/,
    );
    const payrollRunId = page.url().match(/\/payroll\/([0-9a-f-]+)/)?.[1];
    expect(payrollRunId).toBeDefined();
    if (!payrollRunId) throw new Error('Payroll creation did not open a run.');
    const expectRunStatus = async (runId: string, status: string) => {
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${root}/payroll-runs/${runId}`,
          );
          expect(response.status()).toBe(200);
          return ((await response.json()) as { status: string }).status;
        })
        .toBe(status);
    };

    await page.goto(
      `/payroll/${payrollRunId}/validation?organization=${organizationSlug}`,
    );
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(
      page.getByRole('button', { name: 'Submit for approval' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expectRunStatus(payrollRunId, 'ready_for_approval');

    await admin.goto(
      `/payroll/${payrollRunId}/validation?organization=${organizationSlug}`,
    );
    await expect(admin.getByRole('button', { name: 'Approve' })).toBeVisible();
    await admin.getByRole('button', { name: 'Approve' }).click();
    await expectRunStatus(payrollRunId, 'approved');

    await page.goto(
      `/payroll/${payrollRunId}/validation?organization=${organizationSlug}`,
    );
    await page.getByRole('button', { name: 'Finalize' }).click();
    await expectRunStatus(payrollRunId, 'finalized');
    await page.goto(
      `/payroll/${payrollRunId}/accounting?organization=${organizationSlug}`,
    );
    await expect(page.getByText('Recorded accounting entry')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Header payroll document' }),
    ).toBeVisible();
    await page.goto(
      `/payroll/${payrollRunId}/submissions?organization=${organizationSlug}`,
    );
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByLabel('Paid at').fill('2026-03-31T12:00');
    await page.getByLabel('Payment reference').fill(`SYN-PAY-${suffix}`);
    await page
      .getByRole('button', { name: 'Record payment', exact: true })
      .last()
      .click();
    await expectRunStatus(payrollRunId, 'paid');

    const command = async (
      runId: string,
      action: 'validate' | 'submit-for-approval' | 'approve',
      data: Record<string, string> = {},
    ) => {
      const response = await page.request.post(
        `${root}/payroll-runs/${runId}/${action}`,
        { data, headers: { 'idempotency-key': crypto.randomUUID() } },
      );
      expect(response.status()).toBe(200);
      return (await response.json()) as {
        id: string;
        status: string;
        supersedesPayrollRunId: string | null;
        version: number;
      };
    };
    const createReadyRun = async (month: string) => {
      const response = await page.request.post(`${root}/payroll-runs`, {
        data: { legalEntityId: entity!.id, month, results },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(response.status()).toBe(201);
      const run = (await response.json()) as { id: string };
      await command(run.id, 'validate');
      await command(run.id, 'submit-for-approval');
      return run.id;
    };

    const rejectedRunId = await createReadyRun('2026-04');
    await page.goto(
      `/payroll/${rejectedRunId}/validation?organization=${organizationSlug}`,
    );
    await page.getByRole('button', { name: 'Reject' }).click();
    await page
      .getByLabel('Reason')
      .fill('Synthetic recorded facts need review');
    await page
      .getByRole('button', { name: 'Reject', exact: true })
      .last()
      .click();
    await expectRunStatus(rejectedRunId, 'draft');

    await page.goto(
      `/payroll/${payrollRunId}/corrections?organization=${organizationSlug}`,
    );
    await page.getByRole('button', { name: 'Create correction' }).click();
    await page.getByLabel('Reason').fill('Synthetic paid-run correction');
    await page
      .getByRole('button', { name: 'Create correction', exact: true })
      .last()
      .click();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${root}/payroll-runs?legalEntityId=${entity!.id}&month=2026-03`,
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as {
          payrollRuns: {
            status: string;
            supersedesPayrollRunId: string | null;
            version: number;
          }[];
        };
        return body.payrollRuns.find(
          (run) => run.supersedesPayrollRunId === payrollRunId,
        );
      })
      .toMatchObject({ status: 'draft', version: 2 });
    await adminContext.close();
  });

  test('owner approves and cancels time and leave through the team UI', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(180_000);

    const timeEntityName = `Synthetic time entity ${suffix}`;
    await ensureLegalEntity(page, organizationSlug, timeEntityName);
    const entities = await page.request.get(`${root}/legal-entities`);
    expect(entities.status()).toBe(200);
    const entity = (
      (await entities.json()) as {
        legalEntities: { id: string; name: string }[];
      }
    ).legalEntities.find((item) => item.name === timeEntityName);
    expect(entity).toBeDefined();

    const employeeResponse = await page.request.post(`${root}/employees`, {
      data: {
        legalEntityId: entity!.id,
        employeeNumber: `W3-${suffix}`,
        firstName: 'Time',
        lastName: 'Synthetic',
        workEmail: null,
        workPhone: null,
      },
    });
    expect(employeeResponse.status()).toBe(201);
    const employee = (await employeeResponse.json()) as { id: string };
    const relationshipResponse = await page.request.post(
      `${root}/employees/${employee.id}/relationships`,
      {
        data: {
          kind: 'employment',
          position: 'Synthetic time role',
          department: null,
          costCentre: null,
          weeklyHours: '40',
          startDate: '2026-01-01',
          endDate: null,
        },
      },
    );
    expect(relationshipResponse.status()).toBe(201);
    const relationship = (await relationshipResponse.json()) as { id: string };

    const leaveTypeResponse = await page.request.post(
      `${root}/hr/leave-types`,
      {
        data: {
          legalEntityId: entity!.id,
          code: `W3-LEAVE-${suffix}`,
          name: 'Synthetic operational leave',
          unit: 'hours',
          paid: true,
        },
      },
    );
    expect(leaveTypeResponse.status()).toBe(201);
    const leaveType = (await leaveTypeResponse.json()) as { id: string };
    const openingLedger = await page.request.post(
      `${root}/employees/${employee.id}/leave-ledger`,
      {
        data: {
          relationshipId: relationship.id,
          leaveTypeId: leaveType.id,
          effectiveOn: '2026-06-01',
          amount: '16',
          source: 'opening',
          reason: 'Synthetic opening operational balance',
        },
      },
    );
    expect(openingLedger.status()).toBe(201);

    const timesheetResponse = await page.request.post(
      `${root}/employees/${employee.id}/timesheets`,
      {
        data: {
          relationshipId: relationship.id,
          periodStart: '2026-06-01',
          periodEnd: '2026-06-01',
          entries: [
            {
              workDate: '2026-06-01',
              startedAt: '2026-06-01T07:00:00.000Z',
              endedAt: '2026-06-01T15:00:00.000Z',
              breakMinutes: 0,
              overtimeMinutes: 0,
              nightMinutes: 0,
              holidayMinutes: 0,
              standbyMinutes: 0,
              activityCode: null,
            },
          ],
        },
      },
    );
    expect(timesheetResponse.status()).toBe(201);
    const timesheet = (await timesheetResponse.json()) as { id: string };
    const submitTimesheet = await page.request.post(
      `${root}/employees/${employee.id}/timesheets/${timesheet.id}/submit`,
      { data: {} },
    );
    expect(submitTimesheet.status()).toBe(200);

    const leaveRequestResponse = await page.request.post(
      `${root}/employees/${employee.id}/leave-requests`,
      {
        data: {
          relationshipId: relationship.id,
          leaveTypeId: leaveType.id,
          startsOn: '2026-06-15',
          endsOn: '2026-06-15',
          requestedAmount: '4',
        },
      },
    );
    expect(leaveRequestResponse.status()).toBe(201);
    const leaveRequest = (await leaveRequestResponse.json()) as { id: string };

    const selectTeamEmployee = async (path: string) => {
      await page.goto(`${path}?organization=${organizationSlug}`);
      const row = page
        .getByRole('row')
        .filter({ hasText: 'Time Synthetic' })
        .first();
      await expect(row).toBeVisible();
      const rowActions = row.getByRole('button', { name: 'Options' });
      await expect(rowActions).toBeVisible();
      await rowActions.click();
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`employeeId=${employee.id}`));
    };
    const leaveState = async () => {
      const response = await page.request.get(
        `${root}/employees/${employee.id}/leave-requests?status=approved`,
      );
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        items: { id: string; status: string }[];
      };
      return body.items.find((item) => item.id === leaveRequest.id)?.status;
    };
    const leaveBalance = async () => {
      const response = await page.request.get(
        `${root}/employees/${employee.id}/leave-balances`,
      );
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        items: { leaveTypeId: string; balance: string }[];
      };
      return body.items.find((item) => item.leaveTypeId === leaveType.id)
        ?.balance;
    };

    await selectTeamEmployee('/time/approvals');
    const timesheetRow = page
      .getByRole('row')
      .filter({ hasText: '2026-06-01' })
      .first();
    await expect(timesheetRow).toBeVisible();
    await timesheetRow.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${root}/employees/${employee.id}/timesheets?status=approved`,
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as { items: { id: string }[] };
        return body.items.some((item) => item.id === timesheet.id);
      })
      .toBe(true);

    await selectTeamEmployee('/time/leave');
    const leaveRow = page
      .getByRole('row')
      .filter({ hasText: '2026-06-15' })
      .first();
    await expect(leaveRow).toBeVisible();
    await leaveRow.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await page
      .getByRole('button', { name: 'Save', exact: true })
      .last()
      .click();
    await expect.poll(leaveState).toBe('approved');
    await expect.poll(leaveBalance).toBe('12.00');

    const approvedLeaveRow = page
      .getByRole('row')
      .filter({ hasText: '2026-06-15' })
      .first();
    await approvedLeaveRow.getByRole('button', { name: 'Options' }).click();
    await page
      .getByRole('menuitem', { name: 'Cancel request', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Save', exact: true })
      .last()
      .click();
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${root}/employees/${employee.id}/leave-requests?status=cancelled`,
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as {
          items: { id: string; status: string }[];
        };
        return body.items.find((item) => item.id === leaveRequest.id)?.status;
      })
      .toBe('cancelled');
    await expect.poll(leaveBalance).toBe('16.00');
  });

  test('two bound users see and mutate only their own My HR records', async ({
    browser,
  }) => {
    test.skip(
      password.length === 0 ||
        process.env.BAP_HR_SELF_SERVICE_FIXTURE !== 'true',
      'The disposable My HR fixture is required.',
    );
    test.setTimeout(180_000);
    const baseURL =
      process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100';
    const users = [
      {
        email: adminEmail,
        employeeName: 'Bound Admin',
        otherName: 'Bound Member',
        otherLeaveRequestId: '10000000-0000-4000-8000-000000000052',
        otherTimesheetId: '10000000-0000-4000-8000-000000000042',
        ownDocument: 'Synthetic admin document',
        ownPayslip: '10000000-0000-4000-8000-000000000073',
        relationshipId: '10000000-0000-4000-8000-000000000021',
      },
      {
        email: memberEmail,
        employeeName: 'Bound Member',
        otherName: 'Bound Admin',
        otherLeaveRequestId: '10000000-0000-4000-8000-000000000051',
        otherTimesheetId: '10000000-0000-4000-8000-000000000041',
        ownDocument: 'Synthetic member document',
        ownPayslip: '10000000-0000-4000-8000-000000000074',
        relationshipId: '10000000-0000-4000-8000-000000000022',
      },
    ] as const;
    const privateKeys = [
      'bank',
      'compensation',
      'dependant',
      'grossPay',
      'incomeTax',
      'medical',
      'netPay',
      'tax',
    ];

    for (const user of users) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await signInThroughForm(page, user.email, password);
      await page.goto(`/my-hr?organization=${organizationSlug}`);
      await expect(page.getByRole('heading', { name: 'My HR' })).toBeVisible();
      await expect(page.getByText(user.employeeName)).toBeVisible();
      await expect(page.getByText(user.otherName)).toHaveCount(0);

      const paths = [
        'profile',
        'documents',
        'payslips',
        'timesheets',
        'leave-requests',
      ] as const;
      const own = await Promise.all(
        paths.map(async (path) => {
          const response = await page.request.get(`${root}/my-hr/${path}`);
          expect(response.status(), path).toBe(200);
          return (await response.json()) as unknown;
        }),
      );
      const serialized = JSON.stringify(own);
      expect(serialized).toContain(user.ownDocument);
      expect(serialized).toContain(user.ownPayslip);
      expect(serialized).not.toContain(user.otherName);
      for (const key of privateKeys) expect(serialized).not.toContain(key);

      const ownTimesheet = await page.request.post(`${root}/my-hr/timesheets`, {
        data: {
          relationshipId: user.relationshipId,
          periodStart: '2026-09-20',
          periodEnd: '2026-09-20',
          entries: [
            {
              workDate: '2026-09-20',
              startedAt: '2026-09-20T08:00:00.000Z',
              endedAt: '2026-09-20T16:00:00.000Z',
            },
          ],
        },
      });
      expect(ownTimesheet.status()).toBe(201);
      const crossTimesheet = await page.request.patch(
        `${root}/my-hr/timesheets/${user.otherTimesheetId}`,
        {
          data: {
            entries: [
              {
                workDate: '2026-09-21',
                startedAt: '2026-09-21T08:00:00.000Z',
                endedAt: '2026-09-21T16:00:00.000Z',
              },
            ],
          },
        },
      );
      const crossLeave = await page.request.post(
        `${root}/my-hr/leave-requests/${user.otherLeaveRequestId}/cancel`,
        { data: {} },
      );
      expect(crossTimesheet.status()).toBe(404);
      expect(crossLeave.status()).toBe(404);
      await context.close();
    }
  });
});
