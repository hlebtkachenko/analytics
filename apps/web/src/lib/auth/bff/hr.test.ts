import { describe, expect, it, vi } from 'vitest';

import {
  getEmployee,
  getEmployeeRelationships,
  getEmployees,
  patchEmployee,
  postEmployee,
  postPayrollRun,
  postPayrollRunApproval,
  postPayrollRunCorrection,
  postPayrollRunFinalization,
  postPayrollRunPayment,
  postPayrollRunRejection,
  postPayrollRunSubmitForApproval,
  postPayrollRunValidation,
  getDepartments,
  getPositions,
  getCostCentres,
  getWorkplaces,
  getDocumentCategories,
  postDepartment,
  postPosition,
  postCostCentre,
  postWorkplace,
  postDocumentCategory,
  patchDepartment,
  patchPosition,
  patchCostCentre,
  patchWorkplace,
  patchDocumentCategory,
  getEmploymentTerms,
  getEmployeeStatusHistory,
  getEmployeePayrollResults,
  postEmploymentTerm,
  postEmployeeStatusTransition,
  getEmployeeDocuments,
  postEmployeeDocument,
  patchEmployeeDocument,
  getChecklistTemplates,
  postChecklistTemplate,
  patchChecklistTemplate,
  postChecklistTemplateItem,
  patchChecklistTemplateItem,
  getEmployeeChecklists,
  postEmployeeChecklist,
  patchChecklistTask,
  deleteHrAccessAssignment,
  getHrAccessAssignments,
  postHrAccessAssignment,
  getPayrollComponents,
  postPayrollComponent,
  patchPayrollComponent,
  getEmployeeCompensationComponents,
  postEmployeeCompensationComponent,
  patchEmployeeCompensationComponent,
  getPayrollAccountMappings,
  postPayrollAccountMapping,
  patchPayrollAccountMapping,
  getPayrollImport,
  postPayrollImport,
  postPayrollImportConsume,
  getSchedules,
  postSchedule,
  postSchedulePublish,
  getTimesheets,
  postTimesheetSubmit,
  postTimesheetApprove,
  postTimesheetReject,
  postTimesheetCorrect,
  getLeaveTypes,
  getLeaveRequests,
  postLeaveRequestDecide,
  postLeaveRequestCancel,
  getLeaveBalances,
  getAbsences,
  getMyHrAccess,
  getMyHrProfile,
  getMyHrDocuments,
  getMyHrPayslips,
  getMyHrTimesheets,
  postMyHrTimesheet,
  patchMyHrTimesheet,
  postMyHrTimesheetSubmit,
  getMyHrLeaveTypes,
  getMyHrLeaveRequests,
  postMyHrLeaveRequest,
  postMyHrLeaveRequestCancel,
} from '../bff.js';
import type { BffAuth } from '../bff.js';

const getSession = vi
  .fn<BffAuth['getSession']>()
  .mockResolvedValue({ user: { emailVerified: true, id: 'user_1' } });
const signJWT = vi
  .fn<BffAuth['signJWT']>()
  .mockResolvedValue({ token: 'resource-token' });
const auth: BffAuth = { getSession, signJWT };

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';

const datasetRequest = (path: string) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    { headers: { 'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000' } },
  );

const hrTimeId = '00000000-0000-4000-8000-000000000901';
const hrTimeRequest = (path: string, body?: unknown) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );

const entityRequest = (path: string, init?: RequestInit) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      },
    },
  );

describe('employee payroll-results BFF', () => {
  const employeeId = '00000000-0000-4000-8000-000000000020';
  const payrollResult = {
    payrollRunId: '00000000-0000-4000-8000-000000000021',
    legalEntityId: LEGAL_ENTITY_ID,
    month: '2026-09',
    version: 1,
    supersedesPayrollRunId: null,
    status: 'finalized',
    origin: 'calculated',
    grossPay: '1000',
    employeeSocial: '65',
    employeeHealth: '45',
    incomeTax: '100',
    otherDeductions: '0',
    netPay: '790',
    employerSocial: '248',
    employerHealth: '90',
    totalEmployerCost: '1338',
    payslipDocumentId: null,
    finalizedAt: '2026-09-30T00:00:00.000Z',
    paidAt: null,
  };

  it('validates and rebuilds the strict history query before one outbound call', async () => {
    const response = await getEmployeePayrollResults(
      auth,
      entityRequest(
        `employees/${employeeId}/payroll-results?toMonth=2026-09&fromMonth=2026-08&page=2&pageSize=50`,
      ),
      'org_1',
      employeeId,
      async (input, init) => {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/employees/${employeeId}/payroll-results?fromMonth=2026-08&toMonth=2026-09&page=2&pageSize=50`,
        );
        expect(init?.method).toBe('GET');
        return Response.json({
          payrollResults: [payrollResult],
          page: 2,
          pageSize: 50,
          total: 1,
        });
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      payrollResults: [payrollResult],
      page: 2,
      pageSize: 50,
      total: 1,
    });
  });

  it('refuses malformed identifiers and query drift without forwarding', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const [badQuery, badEmployee] = await Promise.all([
      getEmployeePayrollResults(
        auth,
        entityRequest(
          `employees/${employeeId}/payroll-results?fromMonth=2026-10&toMonth=2026-09`,
        ),
        'org_1',
        employeeId,
        fetchImplementation,
      ),
      getEmployeePayrollResults(
        auth,
        entityRequest('employees/not-a-uuid/payroll-results'),
        'org_1',
        'not-a-uuid',
        fetchImplementation,
      ),
    ]);

    expect([badQuery.status, badEmployee.status]).toEqual([400, 404]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('fails closed with a generic gateway error when the upstream response drifts', async () => {
    const response = await getEmployeePayrollResults(
      auth,
      entityRequest(`employees/${employeeId}/payroll-results`),
      'org_1',
      employeeId,
      async () =>
        Response.json({
          payrollResults: [{ ...payrollResult, untrustedField: true }],
          page: 1,
          pageSize: 25,
          total: 1,
        }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('payroll run command BFF', () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const payrollRun = {
    id: runId,
    legalEntityId: LEGAL_ENTITY_ID,
    documentId: null,
    month: '2026-09',
    version: 1,
    supersedesPayrollRunId: null,
    status: 'draft',
    origin: 'calculated',
    validationSummary: {
      valid: false,
      issues: [{ code: 'missing_results', count: 1 }],
    },
    approvedBy: null,
    approvedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    paidBy: null,
    paidAt: null,
    paymentReference: null,
    ruleSetId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    results: [],
  };
  const commands = [
    ['validate', postPayrollRunValidation, {}],
    ['submit-for-approval', postPayrollRunSubmitForApproval, {}],
    ['approve', postPayrollRunApproval, {}],
    ['reject', postPayrollRunRejection, { reason: 'retry' }],
    ['finalize', postPayrollRunFinalization, {}],
    [
      'record-payment',
      postPayrollRunPayment,
      { paidAt: '2026-09-30T12:00:00.000Z', paymentReference: 'private-ref' },
    ],
    ['corrections', postPayrollRunCorrection, { reason: 'correction' }],
  ] as const;
  it.each(commands)(
    'rebuilds the exact %s command path, body, and idempotency key',
    async (command, call, body) => {
      const response = await call(
        auth,
        new Request(
          `https://bap.invalid/api/bff/application/organizations/org_1/payroll-runs/${runId}/${command}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': '00000000-0000-4000-8000-000000000011',
            },
            body: JSON.stringify(body),
          },
        ),
        'org_1',
        runId,
        async (input, init) => {
          expect(String(input)).toBe(
            `http://api:3001/v1/organizations/org_1/payroll-runs/${runId}/${command}`,
          );
          expect(init?.headers).toMatchObject({
            'idempotency-key': '00000000-0000-4000-8000-000000000011',
            'content-type': 'application/json',
          });
          expect(init?.body).toBe(JSON.stringify(body));
          return Response.json(payrollRun, { status: 200 });
        },
      );
      expect(response.status).toBe(200);
    },
  );
  it('propagates a non-OK command without exposing a payment reference', async () => {
    const response = await postPayrollRunPayment(
      auth,
      new Request(
        `https://bap.invalid/api/bff/application/organizations/org_1/payroll-runs/${runId}/record-payment`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': '00000000-0000-4000-8000-000000000011',
          },
          body: JSON.stringify({
            paidAt: '2026-09-30T12:00:00.000Z',
            paymentReference: 'private-ref',
          }),
        },
      ),
      'org_1',
      runId,
      async () => new Response(null, { status: 409 }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'payroll_rejected' });
  });
  it('rejects malformed bodies, identifiers, and organization selectors before forwarding', async () => {
    const invalidBody = await postPayrollRunValidation(
      auth,
      new Request('https://bap.invalid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000011',
        },
        body: JSON.stringify({ extra: true }),
      }),
      'org_1',
      runId,
      vi.fn(),
    );
    const missing = await postPayrollRunValidation(
      auth,
      new Request('https://bap.invalid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000011',
        },
        body: '{}',
      }),
      'org_1',
      'bad-id',
      vi.fn(),
    );
    const denied = await postPayrollRunValidation(
      auth,
      new Request('https://bap.invalid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000011',
        },
        body: '{}',
      }),
      'bad/org',
      runId,
      vi.fn(),
    );
    expect([invalidBody.status, missing.status, denied.status]).toEqual([
      400, 404, 403,
    ]);
  });
  it('fails closed when a command response drifts from the contract', async () => {
    const response = await postPayrollRunValidation(
      auth,
      new Request('https://bap.invalid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '00000000-0000-4000-8000-000000000011',
        },
        body: '{}',
      }),
      'org_1',
      runId,
      async () => Response.json({}),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('payroll import BFF contract', () => {
  const importId = '123e4567-e89b-42d3-a456-426614174000';
  const payload = {
    payrollImport: {
      createdAt: '2026-09-01T00:00:00.000Z',
      errorCount: 0,
      errorReport: [],
      format: 'csv',
      id: importId,
      legalEntityId: importId,
      payrollMonth: '2026-09-01',
      payrollRunId: null,
      rowCount: 0,
      sourceDocumentId: importId,
      status: 'staged',
    },
  };
  const multipartRequest = (form: FormData, key = importId) =>
    ({
      formData: async () => form,
      headers: new Headers({
        'content-type': 'multipart/form-data; boundary=test',
        'idempotency-key': key,
      }),
    }) as unknown as Request;

  it('validates exact multipart fields before minting and forwards the fixed target', async () => {
    const form = new FormData();
    form.set('file', new File(['x'], 'import.csv'));
    form.set('legalEntityId', importId);
    form.set('payrollMonth', '2026-09-01');
    const outbound = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        'http://api:3001/v1/organizations/org_1/payroll/imports',
      );
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer resource-token',
        'idempotency-key': importId,
      });
      expect(await (init?.body as FormData).get('payrollMonth')).toBe(
        '2026-09-01',
      );
      return Response.json(payload, { status: 201 });
    });
    const result = await postPayrollImport(
      auth,
      multipartRequest(form),
      'org_1',
      outbound,
    );
    expect(result.status).toBe(201);
  });

  it('rejects malformed keys, duplicate fields, months, types, and size without an upstream call', async () => {
    const invalid = new FormData();
    invalid.set('file', new File([new Uint8Array(5_000_001)], 'import.txt'));
    invalid.append('legalEntityId', importId);
    invalid.append('legalEntityId', importId);
    invalid.set('payrollMonth', '2026-09-02');
    const outbound = vi.fn<typeof fetch>();
    const result = await postPayrollImport(
      auth,
      multipartRequest(invalid, 'bad'),
      'org_1',
      outbound,
    );
    expect(result.status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('parses status and preserves first/replay consume statuses', async () => {
    const outbound = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(
        Response.json(
          { payrollRunId: importId, status: 'draft' },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { payrollRunId: importId, status: 'draft' },
          { status: 201 },
        ),
      );
    const status = await getPayrollImport(
      auth,
      new Request('https://bap.invalid'),
      'org_1',
      importId,
      outbound,
    );
    const replay = await postPayrollImportConsume(
      auth,
      new Request('https://bap.invalid', { method: 'POST' }),
      'org_1',
      importId,
      outbound,
    );
    const first = await postPayrollImportConsume(
      auth,
      new Request('https://bap.invalid', { method: 'POST' }),
      'org_1',
      importId,
      outbound,
    );
    expect(status.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.status).toBe(201);
  });
});

const PAYROLL_ENTITY_ID = '00000000-0000-4000-8000-000000000101';
const PAYROLL_COMPONENT_ID = '00000000-0000-4000-8000-000000000102';
const PAYROLL_EMPLOYEE_ID = '00000000-0000-4000-8000-000000000103';
const PAYROLL_RELATIONSHIP_ID = '00000000-0000-4000-8000-000000000104';
const PAYROLL_MAPPING_ID = '00000000-0000-4000-8000-000000000105';
const payrollTimestamp = '2026-09-21T00:00:00.000Z';
const payrollComponent = {
  accountingKey: 'BASE_PAY',
  active: true,
  code: 'BASE',
  createdAt: payrollTimestamp,
  id: PAYROLL_COMPONENT_ID,
  kind: 'earning',
  legalEntityId: PAYROLL_ENTITY_ID,
  name: 'Base pay',
  recurrence: 'recurring',
  updatedAt: payrollTimestamp,
};
const payrollCompensation = {
  amount: '1000.0000',
  componentDefinitionId: PAYROLL_COMPONENT_ID,
  createdAt: payrollTimestamp,
  currency: 'CZK',
  employeeId: PAYROLL_EMPLOYEE_ID,
  id: PAYROLL_MAPPING_ID,
  relationshipId: PAYROLL_RELATIONSHIP_ID,
  updatedAt: payrollTimestamp,
  validFrom: '2026-09-01',
  validTo: null,
};
const payrollMapping = {
  accountCode: '521000',
  accountingKey: 'BASE_PAY',
  createdAt: payrollTimestamp,
  id: PAYROLL_MAPPING_ID,
  legalEntityId: PAYROLL_ENTITY_ID,
  side: 'debit',
  updatedAt: payrollTimestamp,
  validFrom: '2026-09-01',
  validTo: null,
};
const payrollRequest = (path: string, init?: RequestInit) =>
  new Request(
    `https://bap.invalid/api/bff/application/organizations/org_1/${path}`,
    {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        'x-bap-request-id': '123e4567-e89b-42d3-a456-426614174000',
      },
    },
  );

describe('W2.3 payroll BFF operations', () => {
  it('forwards every GET through exact fixed paths, rebuilt query defaults, and status 200', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(init?.method).toBe('GET');
      if (url.includes('compensation-components')) {
        return Response.json({
          compensationComponents: [payrollCompensation],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }
      if (url.includes('account-mappings')) {
        return Response.json({
          mappings: [payrollMapping],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }
      return Response.json({
        components: [payrollComponent],
        page: 1,
        pageSize: 25,
        total: 1,
      });
    });
    const component = await getPayrollComponents(
      auth,
      payrollRequest(
        `payroll/components?active=true&legalEntityId=${PAYROLL_ENTITY_ID}`,
      ),
      'org_1',
      fetchImplementation,
    );
    const compensation = await getEmployeeCompensationComponents(
      auth,
      payrollRequest(
        `employees/${PAYROLL_EMPLOYEE_ID}/compensation-components?relationshipId=${PAYROLL_RELATIONSHIP_ID}`,
      ),
      'org_1',
      PAYROLL_EMPLOYEE_ID,
      fetchImplementation,
    );
    const mapping = await getPayrollAccountMappings(
      auth,
      payrollRequest(`payroll/account-mappings?accountingKey=BASE_PAY`),
      'org_1',
      fetchImplementation,
    );
    expect([component.status, compensation.status, mapping.status]).toEqual([
      200, 200, 200,
    ]);
    expect(
      fetchImplementation.mock.calls.map(([input]) => String(input)),
    ).toEqual([
      `http://api:3001/v1/organizations/org_1/payroll/components?page=1&pageSize=25&legalEntityId=${PAYROLL_ENTITY_ID}&active=true`,
      `http://api:3001/v1/organizations/org_1/employees/${PAYROLL_EMPLOYEE_ID}/compensation-components?page=1&pageSize=25&relationshipId=${PAYROLL_RELATIONSHIP_ID}`,
      'http://api:3001/v1/organizations/org_1/payroll/account-mappings?page=1&pageSize=25&accountingKey=BASE_PAY',
    ]);
  });

  it('forwards every POST with an exact validated creation body and status 201', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(init?.method).toBe('POST');
      return Response.json(
        url.includes('compensation-components')
          ? payrollCompensation
          : url.includes('account-mappings')
            ? payrollMapping
            : payrollComponent,
        { status: 201 },
      );
    });
    const componentBody = {
      legalEntityId: PAYROLL_ENTITY_ID,
      code: 'BASE',
      name: 'Base pay',
      kind: 'earning',
      recurrence: 'recurring',
      accountingKey: 'BASE_PAY',
    };
    const compensationBody = {
      relationshipId: PAYROLL_RELATIONSHIP_ID,
      componentDefinitionId: PAYROLL_COMPONENT_ID,
      validFrom: '2026-09-01',
      validTo: null,
      amount: '1000.0000',
      currency: 'CZK',
    };
    const mappingBody = {
      legalEntityId: PAYROLL_ENTITY_ID,
      accountingKey: 'BASE_PAY',
      accountCode: '521000',
      side: 'debit',
      validFrom: '2026-09-01',
      validTo: null,
    };
    const responses = await Promise.all([
      postPayrollComponent(
        auth,
        payrollRequest('payroll/components', {
          body: JSON.stringify(componentBody),
          method: 'POST',
        }),
        'org_1',
        fetchImplementation,
      ),
      postEmployeeCompensationComponent(
        auth,
        payrollRequest(
          `employees/${PAYROLL_EMPLOYEE_ID}/compensation-components`,
          { body: JSON.stringify(compensationBody), method: 'POST' },
        ),
        'org_1',
        PAYROLL_EMPLOYEE_ID,
        fetchImplementation,
      ),
      postPayrollAccountMapping(
        auth,
        payrollRequest('payroll/account-mappings', {
          body: JSON.stringify(mappingBody),
          method: 'POST',
        }),
        'org_1',
        fetchImplementation,
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201,
    ]);
    expect(
      fetchImplementation.mock.calls.map(([input, init]) => [
        String(input),
        init?.body,
      ]),
    ).toEqual([
      [
        'http://api:3001/v1/organizations/org_1/payroll/components',
        JSON.stringify(componentBody),
      ],
      [
        `http://api:3001/v1/organizations/org_1/employees/${PAYROLL_EMPLOYEE_ID}/compensation-components`,
        JSON.stringify(compensationBody),
      ],
      [
        'http://api:3001/v1/organizations/org_1/payroll/account-mappings',
        JSON.stringify(mappingBody),
      ],
    ]);
  });

  it('forwards every PATCH only as immutable successor or allowed component update and status 200', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(init?.method).toBe('PATCH');
      return Response.json(
        url.includes('compensation-components')
          ? payrollCompensation
          : url.includes('account-mappings')
            ? payrollMapping
            : payrollComponent,
      );
    });
    const componentBody = { name: 'Renamed base pay', active: false };
    const compensationBody = {
      validFrom: '2026-10-01',
      validTo: null,
      amount: '1100',
      currency: 'CZK',
    };
    const mappingBody = {
      accountCode: '522000',
      side: 'credit',
      validFrom: '2026-10-01',
      validTo: null,
    };
    const responses = await Promise.all([
      patchPayrollComponent(
        auth,
        payrollRequest(`payroll/components/${PAYROLL_COMPONENT_ID}`, {
          body: JSON.stringify(componentBody),
          method: 'PATCH',
        }),
        'org_1',
        PAYROLL_COMPONENT_ID,
        fetchImplementation,
      ),
      patchEmployeeCompensationComponent(
        auth,
        payrollRequest(
          `employees/${PAYROLL_EMPLOYEE_ID}/compensation-components/${PAYROLL_COMPONENT_ID}`,
          { body: JSON.stringify(compensationBody), method: 'PATCH' },
        ),
        'org_1',
        PAYROLL_EMPLOYEE_ID,
        PAYROLL_COMPONENT_ID,
        fetchImplementation,
      ),
      patchPayrollAccountMapping(
        auth,
        payrollRequest(`payroll/account-mappings/${PAYROLL_MAPPING_ID}`, {
          body: JSON.stringify(mappingBody),
          method: 'PATCH',
        }),
        'org_1',
        PAYROLL_MAPPING_ID,
        fetchImplementation,
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(
      fetchImplementation.mock.calls.map(([input, init]) => [
        String(input),
        init?.body,
      ]),
    ).toEqual([
      [
        `http://api:3001/v1/organizations/org_1/payroll/components/${PAYROLL_COMPONENT_ID}`,
        JSON.stringify(componentBody),
      ],
      [
        `http://api:3001/v1/organizations/org_1/employees/${PAYROLL_EMPLOYEE_ID}/compensation-components/${PAYROLL_COMPONENT_ID}`,
        JSON.stringify(compensationBody),
      ],
      [
        `http://api:3001/v1/organizations/org_1/payroll/account-mappings/${PAYROLL_MAPPING_ID}`,
        JSON.stringify(mappingBody),
      ],
    ]);
  });

  it('fails closed before a call for malformed requests and after a malformed upstream payload', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const invalidQuery = await getPayrollComponents(
      auth,
      payrollRequest('payroll/components?page=0'),
      'org_1',
      fetchImplementation,
    );
    const invalidBody = await postPayrollAccountMapping(
      auth,
      payrollRequest('payroll/account-mappings', {
        body: JSON.stringify({ accountCode: '521000' }),
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );
    const invalidId = await patchEmployeeCompensationComponent(
      auth,
      payrollRequest('employees/nope/compensation-components/nope', {
        body: '{}',
        method: 'PATCH',
      }),
      'org_1',
      'nope',
      'nope',
      fetchImplementation,
    );
    const malformedUpstream = await getPayrollAccountMappings(
      auth,
      payrollRequest('payroll/account-mappings'),
      'org_1',
      async () => Response.json({ mappings: [], page: 1, pageSize: 25 }),
    );
    expect([
      invalidQuery.status,
      invalidBody.status,
      invalidId.status,
      malformedUpstream.status,
    ]).toEqual([400, 400, 404, 502]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('HR fixed BFF routes', () => {
  const employee = {
    id: '00000000-0000-4000-8000-000000000101',
    legalEntityId: LEGAL_ENTITY_ID,
    employeeNumber: 'EMP-001',
    firstName: 'Placeholder',
    lastName: 'Employee',
    workEmail: null,
    workPhone: null,
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const employmentTerm = {
    id: '00000000-0000-4000-8000-000000000102',
    employeeId: '00000000-0000-4000-8000-000000000101',
    relationshipId: '00000000-0000-4000-8000-000000000103',
    version: 1,
    supersedesEmploymentTermId: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    positionId: null,
    departmentId: null,
    costCentreId: null,
    workplaceId: null,
    managerEmployeeId: null,
    weeklyHours: '40',
    workingTimePattern: 'standard',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const employmentRelationship = {
    id: employmentTerm.relationshipId,
    employeeId: employee.id,
    kind: 'employment',
    position: 'Engineer',
    department: null,
    costCentre: null,
    weeklyHours: '40',
    startDate: '2026-01-01',
    endDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const;
  it('maps document list, link, and patch routes with contract bodies and no invalid outbound calls', async () => {
    const document = {
      documentId: '00000000-0000-4000-8000-000000000104',
      title: 'Employment contract',
      documentDate: '2026-09-01',
      categoryId: '00000000-0000-4000-8000-000000000105',
      relationshipId: null,
      approvalStatus: 'pending',
      approvedBy: null,
      approvedAt: null,
      supersedesDocumentId: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    } as const;
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === 'GET') {
        expect(url).toContain(
          `/employees/${employee.id}/documents?page=1&pageSize=25&currentOnly=true`,
        );
        return Response.json({
          items: [document],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }
      expect(JSON.parse(String(init?.body))).toEqual(
        init?.method === 'POST'
          ? {
              documentId: document.documentId,
              categoryId: document.categoryId,
              relationshipId: null,
              supersedesDocumentId: null,
            }
          : { approvalDecision: 'approved' },
      );
      return Response.json(document, {
        status: init?.method === 'POST' ? 201 : 200,
      });
    });
    expect(
      (
        await getEmployeeDocuments(
          auth,
          datasetRequest(`employees/${employee.id}/documents`),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    const body = {
      documentId: document.documentId,
      categoryId: document.categoryId,
      relationshipId: null,
      supersedesDocumentId: null,
    };
    expect(
      (
        await postEmployeeDocument(
          auth,
          new Request('https://bap.invalid/documents', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await patchEmployeeDocument(
          auth,
          new Request('https://bap.invalid/documents', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ approvalDecision: 'approved' }),
          }),
          'org_1',
          employee.id,
          document.documentId,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    const invalid = await patchEmployeeDocument(
      auth,
      new Request('https://bap.invalid/documents', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      'org_1',
      employee.id,
      document.documentId,
      fetchImplementation,
    );
    expect(invalid.status).toBe(400);
    expect(
      (
        await getEmployeeDocuments(
          auth,
          datasetRequest(`employees/${employee.id}/documents?pageSize=101`),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await patchEmployeeDocument(
          auth,
          new Request('https://bap.invalid/documents', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ approvalDecision: 'approved' }),
          }),
          'org_1',
          'not-a-uuid',
          document.documentId,
          fetchImplementation,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await patchEmployeeDocument(
          auth,
          new Request('https://bap.invalid/documents', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ approvalDecision: 'approved' }),
          }),
          'org_1',
          employee.id,
          'not-a-uuid',
          fetchImplementation,
        )
      ).status,
    ).toBe(404);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });
  it('lists employees and refuses malformed filters without an outbound call', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toContain('/employees?page=1&pageSize=25');
      return Response.json({
        employees: [employee],
        page: 1,
        pageSize: 25,
        total: 1,
      });
    });
    expect(
      (
        await getEmployees(
          auth,
          datasetRequest('employees'),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await getEmployees(
          auth,
          datasetRequest('employees?pageSize=500'),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
  it('forwards a full categorized employee detail response and fails closed for an unknown document field', async () => {
    const detail = {
      ...employee,
      relationships: [],
      documents: [
        {
          documentId: '00000000-0000-4000-8000-000000000104',
          title: 'Corrected employment contract',
          documentDate: '2026-09-01',
          categoryId: '00000000-0000-4000-8000-000000000105',
          relationshipId: '00000000-0000-4000-8000-000000000103',
          approvalStatus: 'approved',
          approvedBy: '00000000-0000-4000-8000-000000000106',
          approvedAt: '2026-09-02T09:00:00.000Z',
          supersedesDocumentId: '00000000-0000-4000-8000-000000000107',
          createdAt: '2026-09-01T09:00:00.000Z',
        },
      ],
    } as const;
    const request = datasetRequest(`employees/${employee.id}`);

    const valid = await getEmployee(
      auth,
      request,
      'org_1',
      employee.id,
      async () => Response.json(detail),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(detail);

    const invalid = await getEmployee(
      auth,
      request,
      'org_1',
      employee.id,
      async () =>
        Response.json({
          ...detail,
          documents: [{ ...detail.documents[0], unexpected: true }],
        }),
    );
    expect(invalid.status).toBe(502);
    expect(await invalid.json()).toEqual({ error: 'service_unavailable' });
  });
  it('posts a validated employee and refuses an invalid body before calling the API', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      return Response.json(employee, { status: 201 });
    });
    const request = (body: unknown) =>
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/employees',
        {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
    expect(
      (
        await postEmployee(
          auth,
          request({
            legalEntityId: LEGAL_ENTITY_ID,
            employeeNumber: 'EMP-001',
            firstName: 'Placeholder',
            lastName: 'Employee',
          }),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await postEmployee(
          auth,
          request({ legalEntityId: 'invalid' }),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postEmployee(
          auth,
          request({
            legalEntityId: LEGAL_ENTITY_ID,
            employeeNumber: 'EMP-001',
            firstName: 'Placeholder',
            lastName: 'Employee',
            status: 'active',
          }),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('sanitizes the employment-term history query and maps its fixed GET route', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('GET');
      return Response.json({
        items: [employmentTerm],
        page: 1,
        pageSize: 25,
        total: 1,
      });
    });
    const response = await getEmploymentTerms(
      auth,
      datasetRequest(
        `employees/${employee.id}/employment-terms?relationshipId=${employmentTerm.relationshipId.toUpperCase()}&effectiveOn=2026-02-01`,
      ),
      'org_1',
      employee.id,
      fetchImplementation,
    );
    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      `http://api:3001/v1/organizations/org_1/employees/${employee.id}/employment-terms?page=1&pageSize=25&relationshipId=${employmentTerm.relationshipId}&effectiveOn=2026-02-01`,
    );
  });

  it('forwards employee relationships through their fixed GET route and fails closed for malformed responses', async () => {
    const relationships = { relationships: [employmentRelationship] };
    const response = await getEmployeeRelationships(
      auth,
      datasetRequest(`employees/${employee.id}/relationships`),
      'org_1',
      employee.id,
      async (input, init) => {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/employees/${employee.id}/relationships`,
        );
        expect(init?.method).toBe('GET');
        return Response.json(relationships);
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(relationships);

    const malformed = await getEmployeeRelationships(
      auth,
      datasetRequest(`employees/${employee.id}/relationships`),
      'org_1',
      employee.id,
      async () =>
        Response.json({
          relationships: [{ ...employmentRelationship, unexpected: true }],
        }),
    );
    expect(malformed.status).toBe(502);
  });

  it('posts the complete employment-term snapshot to its fixed route', async () => {
    const body = {
      relationshipId: employmentTerm.relationshipId,
      supersedesEmploymentTermId: null,
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
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/employees/${employee.id}/employment-terms`,
      );
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return Response.json(employmentTerm, { status: 201 });
    });
    const response = await postEmploymentTerm(
      auth,
      new Request('https://bap.invalid/employment-terms', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      'org_1',
      employee.id,
      fetchImplementation,
    );
    expect(response.status).toBe(201);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('rejects malformed employment-term inputs and an invalid employee before calling out', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const malformedQuery = await getEmploymentTerms(
      auth,
      datasetRequest(`employees/${employee.id}/employment-terms?unknown=true`),
      'org_1',
      employee.id,
      fetchImplementation,
    );
    const malformedBody = await postEmploymentTerm(
      auth,
      new Request('https://bap.invalid/employment-terms', {
        body: JSON.stringify({ relationshipId: employmentTerm.relationshipId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      'org_1',
      employee.id,
      fetchImplementation,
    );
    const invalidEmployee = await getEmploymentTerms(
      auth,
      datasetRequest('employees/not-a-uuid/employment-terms'),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );
    expect(malformedQuery.status).toBe(400);
    expect(malformedBody.status).toBe(400);
    expect(invalidEmployee.status).toBe(404);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('maps lifecycle history and transition routes with exact paths, query, bodies, and statuses', async () => {
    const history = {
      items: [
        {
          id: '00000000-0000-4000-8000-000000000201',
          employeeId: employee.id,
          fromStatus: null,
          toStatus: 'preboarding',
          effectiveAt: '2026-01-01T00:00:00.000Z',
          reason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    };
    const transition = {
      toStatus: 'active',
      effectiveAt: '2026-01-02T00:00:00.000Z',
      reason: 'Return from leave',
    };
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/employees/${employee.id}/status-transitions`,
        );
        expect(JSON.parse(String(init.body))).toEqual(transition);
        return Response.json({
          ...history.items[0],
          fromStatus: 'inactive',
          toStatus: 'active',
          effectiveAt: transition.effectiveAt,
          reason: transition.reason,
        });
      }
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/employees/${employee.id}/status-history?page=1&pageSize=25`,
      );
      expect(init?.method).toBe('GET');
      return Response.json(history);
    });
    expect(
      (
        await getEmployeeStatusHistory(
          auth,
          datasetRequest(`employees/${employee.id}/status-history`),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postEmployeeStatusTransition(
          auth,
          new Request('https://bap.invalid/status-transitions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(transition),
          }),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const calls = fetchImplementation.mock.calls.length;
    expect(
      (
        await getEmployeeStatusHistory(
          auth,
          datasetRequest(
            `employees/${employee.id}/status-history?pageSize=101`,
          ),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postEmployeeStatusTransition(
          auth,
          new Request('https://bap.invalid/status-transitions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ toStatus: 'active' }),
          }),
          'org_1',
          employee.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await getEmployeeStatusHistory(
          auth,
          datasetRequest('employees/not-a-uuid/status-history'),
          'org_1',
          'not-a-uuid',
          fetchImplementation,
        )
      ).status,
    ).toBe(404);
    expect(fetchImplementation).toHaveBeenCalledTimes(calls);
  });
  it('refuses immutable employee updates and negative payroll amounts before calling the API', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const employeeUpdate = await patchEmployee(
      auth,
      new Request(
        `https://bap.invalid/api/bff/application/organizations/org_1/employees/${employee.id}`,
        {
          body: JSON.stringify({ employeeNumber: 'EMP-002' }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        },
      ),
      'org_1',
      employee.id,
      fetchImplementation,
    );
    const payroll = await postPayrollRun(
      auth,
      new Request(
        'https://bap.invalid/api/bff/application/organizations/org_1/payroll-runs',
        {
          body: JSON.stringify({
            legalEntityId: LEGAL_ENTITY_ID,
            month: '2026-09',
            results: [
              {
                employeeHealth: '0',
                employeeId: employee.id,
                employeeSocial: '0',
                employerHealth: '0',
                employerSocial: '0',
                grossPay: '-1',
                incomeTax: '0',
                netPay: '0',
                otherDeductions: '0',
                totalEmployerCost: '0',
              },
            ],
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      ),
      'org_1',
      fetchImplementation,
    );

    expect([employeeUpdate.status, payroll.status]).toEqual([400, 400]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects an invalid HR upstream response before returning it', async () => {
    const response = await getEmployees(
      auth,
      datasetRequest('employees'),
      'org_1',
      async () => Response.json({ employees: [] }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });
});

describe('hr-time BFF operations', () => {
  it('uses exact collection paths and forwards refusal statuses', async () => {
    const cases: ReadonlyArray<
      readonly [
        string,
        string,
        (fetchImplementation: typeof fetch) => Response | Promise<Response>,
      ]
    > = [
      [
        `employees/${hrTimeId}/schedules?status=draft`,
        `employees/${hrTimeId}/schedules?page=1&pageSize=25&status=draft`,
        (f) =>
          getSchedules(
            auth,
            datasetRequest(`employees/${hrTimeId}/schedules?status=draft`),
            'org_1',
            hrTimeId,
            f,
          ),
      ],
      [
        `employees/${hrTimeId}/timesheets`,
        `employees/${hrTimeId}/timesheets?page=1&pageSize=25`,
        (f) =>
          getTimesheets(
            auth,
            datasetRequest(`employees/${hrTimeId}/timesheets`),
            'org_1',
            hrTimeId,
            f,
          ),
      ],
      [
        'hr/leave-types?active=true',
        'hr/leave-types?page=1&pageSize=25&active=true',
        (f) =>
          getLeaveTypes(
            auth,
            datasetRequest('hr/leave-types?active=true'),
            'org_1',
            f,
          ),
      ],
      [
        `employees/${hrTimeId}/leave-requests`,
        `employees/${hrTimeId}/leave-requests?page=1&pageSize=25`,
        (f) =>
          getLeaveRequests(
            auth,
            datasetRequest(`employees/${hrTimeId}/leave-requests`),
            'org_1',
            hrTimeId,
            f,
          ),
      ],
      [
        `employees/${hrTimeId}/absences?kind=sickness`,
        `employees/${hrTimeId}/absences?page=1&pageSize=25&kind=sickness`,
        (f) =>
          getAbsences(
            auth,
            datasetRequest(`employees/${hrTimeId}/absences?kind=sickness`),
            'org_1',
            hrTimeId,
            f,
          ),
      ],
    ];
    for (const [incoming, outgoing, operation] of cases) {
      const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/${outgoing}`,
        );
        expect(init?.method).toBe('GET');
        return Response.json({}, { status: 403 });
      });
      expect(incoming).toBeTruthy();
      const response = await operation(fetchImplementation);
      expect(response.status).toBe(403);
    }
  });
  it('uses the exact balance path without a bare query string', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(
        `http://api:3001/v1/organizations/org_1/employees/${hrTimeId}/leave-balances`,
      );
      return Response.json({}, { status: 404 });
    });
    expect(
      (
        await getLeaveBalances(
          auth,
          datasetRequest(`employees/${hrTimeId}/leave-balances`),
          'org_1',
          hrTimeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(404);
  });
  it('rejects invalid queries, bodies, and identifiers before outbound calls', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    expect(
      (
        await getSchedules(
          auth,
          datasetRequest(`employees/${hrTimeId}/schedules?unknown=x`),
          'org_1',
          hrTimeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postSchedule(
          auth,
          hrTimeRequest(`employees/${hrTimeId}/schedules`, { unknown: true }),
          'org_1',
          hrTimeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await getAbsences(
          auth,
          datasetRequest('employees/not-a-uuid/absences'),
          'org_1',
          'not-a-uuid',
          fetchImplementation,
        )
      ).status,
    ).toBe(404);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('maps commands to methods, paths, and forwarded conflicts', async () => {
    const commands = [
      [
        postSchedulePublish,
        `employees/${hrTimeId}/schedules/${hrTimeId}/publish`,
        {},
      ],
      [
        postTimesheetSubmit,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/submit`,
        {},
      ],
      [
        postTimesheetApprove,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/approve`,
        {},
      ],
      [
        postTimesheetReject,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/reject`,
        { reason: 'x' },
      ],
      [
        postTimesheetCorrect,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/correct`,
        { reason: 'x' },
      ],
      [
        postLeaveRequestDecide,
        `employees/${hrTimeId}/leave-requests/${hrTimeId}/decide`,
        { decision: 'approved' },
      ],
      [
        postLeaveRequestCancel,
        `employees/${hrTimeId}/leave-requests/${hrTimeId}/cancel`,
        {},
      ],
    ] as const;
    for (const [operation, path, body] of commands) {
      const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/${path}`,
        );
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual(body);
        return Response.json({}, { status: 409 });
      });
      expect(
        (
          await operation(
            auth,
            hrTimeRequest(path, body),
            'org_1',
            hrTimeId,
            hrTimeId,
            fetchImplementation,
          )
        ).status,
      ).toBe(409);
    }
  });
  it('rejects a POST default 201 response for every command', async () => {
    const commands = [
      [
        postSchedulePublish,
        `employees/${hrTimeId}/schedules/${hrTimeId}/publish`,
        {},
      ],
      [
        postTimesheetSubmit,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/submit`,
        {},
      ],
      [
        postTimesheetApprove,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/approve`,
        {},
      ],
      [
        postTimesheetReject,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/reject`,
        { reason: 'x' },
      ],
      [
        postTimesheetCorrect,
        `employees/${hrTimeId}/timesheets/${hrTimeId}/correct`,
        { reason: 'x' },
      ],
      [
        postLeaveRequestDecide,
        `employees/${hrTimeId}/leave-requests/${hrTimeId}/decide`,
        { decision: 'approved' },
      ],
      [
        postLeaveRequestCancel,
        `employees/${hrTimeId}/leave-requests/${hrTimeId}/cancel`,
        {},
      ],
    ] as const;
    for (const [operation, path, body] of commands) {
      expect(
        (
          await operation(
            auth,
            hrTimeRequest(path, body),
            'org_1',
            hrTimeId,
            hrTimeId,
            async () => Response.json({}, { status: 201 }),
          )
        ).status,
      ).toBe(502);
    }
  });
  it('turns a malformed successful upstream response into 502', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({}),
    );
    expect(
      (
        await getSchedules(
          auth,
          datasetRequest(`employees/${hrTimeId}/schedules`),
          'org_1',
          hrTimeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(502);
  });
});

describe('HR access assignment BFF routes', () => {
  const assignment = {
    accessRole: 'payroll_approver',
    createdAt: '2026-09-21T00:00:00.000Z',
    id: '00000000-0000-4000-8000-000000000111',
    legalEntityId: LEGAL_ENTITY_ID,
    userId: 'member_1',
  } as const;

  it('forwards only the fixed list, create, and revoke methods with exact IDs', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === 'GET') {
        expect(url).toBe(
          'http://api:3001/v1/organizations/org_1/hr/access-assignments',
        );
        return Response.json({ assignments: [assignment] });
      }
      if (init?.method === 'POST') {
        expect(url).toBe(
          'http://api:3001/v1/organizations/org_1/hr/access-assignments',
        );
        expect(init.body).toBe(
          JSON.stringify({
            accessRole: assignment.accessRole,
            legalEntityId: assignment.legalEntityId,
            userId: assignment.userId,
          }),
        );
        return Response.json(assignment, { status: 201 });
      }
      expect(init?.method).toBe('DELETE');
      expect(url).toBe(
        `http://api:3001/v1/organizations/org_1/hr/access-assignments/${assignment.id}`,
      );
      return Response.json({ revoked: true });
    });
    const body = {
      accessRole: assignment.accessRole,
      legalEntityId: assignment.legalEntityId,
      userId: assignment.userId,
    };
    expect(
      (
        await getHrAccessAssignments(
          auth,
          datasetRequest('hr/access-assignments'),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postHrAccessAssignment(
          auth,
          new Request('https://bap.invalid/hr/access-assignments', {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await deleteHrAccessAssignment(
          auth,
          datasetRequest(`hr/access-assignments/${assignment.id}`),
          'org_1',
          assignment.id,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('fails closed for malformed request identifiers, bodies, and upstream responses', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ assignments: [{ accessRole: 'hr_admin' }] }),
    );
    const malformedResponse = await getHrAccessAssignments(
      auth,
      datasetRequest('hr/access-assignments'),
      'org_1',
      fetchImplementation,
    );
    const malformedBody = await postHrAccessAssignment(
      auth,
      new Request('https://bap.invalid/hr/access-assignments', {
        body: JSON.stringify({ legalEntityId: LEGAL_ENTITY_ID }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );
    const malformedId = await deleteHrAccessAssignment(
      auth,
      datasetRequest('hr/access-assignments/not-a-uuid'),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );
    expect(malformedResponse.status).toBe(502);
    expect(malformedBody.status).toBe(400);
    expect(malformedId.status).toBe(404);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

describe('HR reference BFF reads', () => {
  const reference = {
    active: true,
    code: 'OPS',
    createdAt: '2026-09-20T00:00:00.000Z',
    id: DOCUMENT_ID,
    legalEntityId: LEGAL_ENTITY_ID,
    name: 'Placeholder reference',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
  const mappings = [
    [
      'departments',
      getDepartments,
      { ...reference, parentId: null },
      'departments',
    ],
    ['positions', getPositions, reference, 'positions'],
    ['cost-centres', getCostCentres, reference, 'costCentres'],
    [
      'workplaces',
      getWorkplaces,
      { ...reference, addressLabel: null },
      'workplaces',
    ],
    [
      'document-categories',
      getDocumentCategories,
      {
        ...reference,
        confidentiality: 'operational' as const,
        retentionKey: 'ops',
        requiresApproval: false,
      },
      'documentCategories',
    ],
  ] as const;

  it.each(mappings)(
    'rebuilds the %s list query and maps only its fixed route',
    async (collection, getCollection, referenceItem, key) => {
      const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
        expect(String(input)).toBe(
          `http://api:3001/v1/organizations/org_1/hr/${collection}?legalEntityId=${LEGAL_ENTITY_ID}&q=placeholder&active=true&page=1&pageSize=25`,
        );
        return Response.json({
          [key]: [referenceItem],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      });
      const response = await getCollection(
        auth,
        datasetRequest(
          `hr/${collection}?legalEntityId=${LEGAL_ENTITY_ID.toUpperCase()}&q=placeholder&active=true`,
        ),
        'org_1',
        fetchImplementation,
      );
      expect(response.status).toBe(200);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it('rejects unknown and malformed reference queries without an outbound request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const unknown = await getDepartments(
      auth,
      datasetRequest('hr/departments?kind=positions'),
      'org_1',
      fetchImplementation,
    );
    const malformed = await getDepartments(
      auth,
      datasetRequest('hr/departments?page=0'),
      'org_1',
      fetchImplementation,
    );
    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('maps every fixed reference write with its validated body and status', async () => {
    const responseByPath: Record<string, object> = {
      departments: { ...reference, parentId: null },
      positions: reference,
      'cost-centres': reference,
      workplaces: { ...reference, addressLabel: null },
      'document-categories': {
        ...reference,
        confidentiality: 'operational',
        retentionKey: 'ops',
        requiresApproval: false,
      },
    };
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input).split('/hr/')[1]!.split('/')[0]!;
      return Response.json(responseByPath[path], {
        status: init?.method === 'POST' ? 201 : 200,
      });
    });
    const writeRequest = (body: object, method: 'POST' | 'PATCH') =>
      new Request('https://bap.invalid/reference', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method,
      });
    const createCalls = [
      [
        postDepartment,
        'departments',
        {
          legalEntityId: LEGAL_ENTITY_ID,
          code: 'OPS',
          name: 'Placeholder',
          parentId: null,
        },
      ],
      [
        postPosition,
        'positions',
        { legalEntityId: LEGAL_ENTITY_ID, code: 'OPS', name: 'Placeholder' },
      ],
      [
        postCostCentre,
        'cost-centres',
        { legalEntityId: LEGAL_ENTITY_ID, code: 'OPS', name: 'Placeholder' },
      ],
      [
        postWorkplace,
        'workplaces',
        {
          legalEntityId: LEGAL_ENTITY_ID,
          code: 'OPS',
          name: 'Placeholder',
          addressLabel: null,
        },
      ],
      [
        postDocumentCategory,
        'document-categories',
        {
          legalEntityId: LEGAL_ENTITY_ID,
          code: 'OPS',
          name: 'Placeholder',
          confidentiality: 'operational',
          retentionKey: 'ops',
          requiresApproval: false,
        },
      ],
    ] as const;
    for (const [post, collection, body] of createCalls) {
      const response = await post(
        auth,
        writeRequest(body, 'POST'),
        'org_1',
        fetchImplementation,
      );
      expect(response.status).toBe(201);
      const call = fetchImplementation.mock.calls.at(-1)!;
      expect(String(call[0])).toBe(
        `http://api:3001/v1/organizations/org_1/hr/${collection}`,
      );
      expect(call[1]?.method).toBe('POST');
      expect(JSON.parse(String(call[1]?.body))).toEqual(body);
    }
    const patchCalls = [
      [patchDepartment, 'departments', { name: 'Updated' }],
      [patchPosition, 'positions', { name: 'Updated' }],
      [patchCostCentre, 'cost-centres', { active: false }],
      [patchWorkplace, 'workplaces', { addressLabel: null }],
      [
        patchDocumentCategory,
        'document-categories',
        { retentionKey: 'updated' },
      ],
    ] as const;
    for (const [patch, collection, body] of patchCalls) {
      const response = await patch(
        auth,
        writeRequest(body, 'PATCH'),
        'org_1',
        DOCUMENT_ID,
        fetchImplementation,
      );
      expect(response.status).toBe(200);
      const call = fetchImplementation.mock.calls.at(-1)!;
      expect(String(call[0])).toBe(
        `http://api:3001/v1/organizations/org_1/hr/${collection}/${DOCUMENT_ID}`,
      );
      expect(call[1]?.method).toBe('PATCH');
      expect(JSON.parse(String(call[1]?.body))).toEqual(body);
    }
  });

  it('rejects malformed write bodies and reference identifiers before calling out', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const body = await postDepartment(
      auth,
      new Request('https://bap.invalid/reference', {
        body: JSON.stringify({ legalEntityId: LEGAL_ENTITY_ID, code: 'OPS' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      'org_1',
      fetchImplementation,
    );
    const identifier = await patchDepartment(
      auth,
      new Request('https://bap.invalid/reference', {
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      'org_1',
      'not-a-uuid',
      fetchImplementation,
    );
    expect(body.status).toBe(400);
    expect(identifier.status).toBe(404);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('checklist BFF operations', () => {
  const employeeId = '00000000-0000-4000-8000-000000000701';
  const templateId = '00000000-0000-4000-8000-000000000702';
  const itemId = '00000000-0000-4000-8000-000000000703';
  const checklistId = '00000000-0000-4000-8000-000000000704';
  const taskId = '00000000-0000-4000-8000-000000000705';
  const categoryId = '00000000-0000-4000-8000-000000000706';
  const now = '2026-09-21T00:00:00.000Z';
  const item = {
    active: true,
    createdAt: now,
    defaultDueOffsetDays: 3,
    documentCategoryId: categoryId,
    id: itemId,
    position: 1,
    templateId,
    title: 'Collect required document',
    updatedAt: now,
  };
  const template = {
    active: true,
    code: 'ONBOARD',
    createdAt: now,
    id: templateId,
    items: [item],
    kind: 'onboarding' as const,
    legalEntityId: LEGAL_ENTITY_ID,
    name: 'Onboarding',
    updatedAt: now,
  };
  const task = {
    checklistId,
    completedAt: null,
    completedBy: null,
    createdAt: now,
    documentCategoryId: categoryId,
    documentId: null,
    dueOn: '2026-09-24',
    id: taskId,
    ownerUserId: 'owner_1',
    skipReason: null,
    status: 'pending' as const,
    templateItemId: itemId,
    title: item.title,
    updatedAt: now,
  };
  const checklist = {
    completedAt: null,
    createdAt: now,
    employeeId,
    id: checklistId,
    kind: 'onboarding' as const,
    legalEntityId: LEGAL_ENTITY_ID,
    relationshipId: null,
    startedOn: '2026-09-21',
    status: 'open' as const,
    tasks: [task],
    templateId,
    updatedAt: now,
  };
  const request = (method: 'POST' | 'PATCH', body: object) =>
    new Request('https://bap.invalid/checklists', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method,
    });

  it('delegates every checklist operation to its exact API method, path, query, and body', async () => {
    const calls: Array<{ body: unknown; method: string; path: string }> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input).replace(
        'http://api:3001/v1/organizations/org_1/',
        '',
      );
      calls.push({
        body:
          init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        method: String(init?.method),
        path,
      });
      if (path.startsWith('hr/checklist-templates?'))
        return Response.json({
          items: [template],
          page: 2,
          pageSize: 50,
          total: 1,
        });
      if (path.includes(`/tasks/${taskId}`)) return Response.json(task);
      if (path.includes(`/items/${itemId}`)) return Response.json(item);
      if (path.endsWith('/items')) return Response.json(item, { status: 201 });
      if (path === `hr/checklist-templates/${templateId}`)
        return Response.json(template);
      if (path === 'hr/checklist-templates')
        return Response.json(template, { status: 201 });
      if (path.includes('/checklists?'))
        return Response.json({
          items: [checklist],
          page: 3,
          pageSize: 25,
          total: 1,
        });
      return Response.json(checklist, { status: 201 });
    });
    const templateBody = {
      code: template.code,
      kind: template.kind,
      legalEntityId: LEGAL_ENTITY_ID,
      name: template.name,
    };
    const itemBody = {
      defaultDueOffsetDays: 3,
      documentCategoryId: categoryId,
      position: 1,
      title: item.title,
    };
    const startBody = {
      ownerUserId: 'owner_1',
      relationshipId: null,
      startedOn: '2026-09-21',
      templateId,
    };
    expect(
      (
        await getChecklistTemplates(
          auth,
          datasetRequest(
            `hr/checklist-templates?legalEntityId=${LEGAL_ENTITY_ID.toUpperCase()}&kind=onboarding&active=true&q=onboard&page=2&pageSize=50`,
          ),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postChecklistTemplate(
          auth,
          request('POST', templateBody),
          'org_1',
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await patchChecklistTemplate(
          auth,
          request('PATCH', { name: 'Updated onboarding' }),
          'org_1',
          templateId,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postChecklistTemplateItem(
          auth,
          request('POST', itemBody),
          'org_1',
          templateId,
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await patchChecklistTemplateItem(
          auth,
          request('PATCH', { active: false }),
          'org_1',
          templateId,
          itemId,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await getEmployeeChecklists(
          auth,
          datasetRequest(
            `employees/${employeeId}/checklists?kind=onboarding&status=open&ownerUserId=owner_1&dueBefore=2026-10-01&page=3&pageSize=25`,
          ),
          'org_1',
          employeeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postEmployeeChecklist(
          auth,
          request('POST', startBody),
          'org_1',
          employeeId,
          fetchImplementation,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await patchChecklistTask(
          auth,
          request('PATCH', { documentId: null, status: 'completed' }),
          'org_1',
          employeeId,
          checklistId,
          taskId,
          fetchImplementation,
        )
      ).status,
    ).toBe(200);
    expect(calls).toEqual([
      {
        body: undefined,
        method: 'GET',
        path: `hr/checklist-templates?legalEntityId=${LEGAL_ENTITY_ID}&kind=onboarding&active=true&q=onboard&page=2&pageSize=50`,
      },
      { body: templateBody, method: 'POST', path: 'hr/checklist-templates' },
      {
        body: { name: 'Updated onboarding' },
        method: 'PATCH',
        path: `hr/checklist-templates/${templateId}`,
      },
      {
        body: itemBody,
        method: 'POST',
        path: `hr/checklist-templates/${templateId}/items`,
      },
      {
        body: { active: false },
        method: 'PATCH',
        path: `hr/checklist-templates/${templateId}/items/${itemId}`,
      },
      {
        body: undefined,
        method: 'GET',
        path: `employees/${employeeId}/checklists?kind=onboarding&status=open&ownerUserId=owner_1&dueBefore=2026-10-01&page=3&pageSize=25`,
      },
      {
        body: startBody,
        method: 'POST',
        path: `employees/${employeeId}/checklists`,
      },
      {
        body: { documentId: null, status: 'completed' },
        method: 'PATCH',
        path: `employees/${employeeId}/checklists/${checklistId}/tasks/${taskId}`,
      },
    ]);
  });

  it.each([400, 403, 404, 409])(
    'propagates upstream checklist rejection status %i',
    async (status) => {
      const fetchImplementation = vi.fn<typeof fetch>(async () =>
        Response.json({ detail: 'internal upstream detail' }, { status }),
      );
      const response = await patchChecklistTask(
        auth,
        request('PATCH', { status: 'in_progress' }),
        'org_1',
        employeeId,
        checklistId,
        taskId,
        fetchImplementation,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: 'checklist_task_rejected',
      });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it('propagates 400, 403, 404, and 409 from every checklist operation', async () => {
    const operations = [
      (fetchImplementation: typeof fetch) =>
        getChecklistTemplates(
          auth,
          datasetRequest('hr/checklist-templates'),
          'org_1',
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        postChecklistTemplate(
          auth,
          request('POST', {
            legalEntityId: LEGAL_ENTITY_ID,
            kind: 'onboarding',
            code: 'ONBOARD',
            name: 'Onboarding',
          }),
          'org_1',
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        patchChecklistTemplate(
          auth,
          request('PATCH', { name: 'Updated' }),
          'org_1',
          templateId,
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        postChecklistTemplateItem(
          auth,
          request('POST', {
            position: 1,
            title: item.title,
            defaultDueOffsetDays: 0,
            documentCategoryId: null,
          }),
          'org_1',
          templateId,
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        patchChecklistTemplateItem(
          auth,
          request('PATCH', { active: false }),
          'org_1',
          templateId,
          itemId,
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        getEmployeeChecklists(
          auth,
          datasetRequest(`employees/${employeeId}/checklists`),
          'org_1',
          employeeId,
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        postEmployeeChecklist(
          auth,
          request('POST', {
            templateId,
            relationshipId: null,
            startedOn: '2026-09-21',
            ownerUserId: 'owner_1',
          }),
          'org_1',
          employeeId,
          fetchImplementation,
        ),
      (fetchImplementation: typeof fetch) =>
        patchChecklistTask(
          auth,
          request('PATCH', { status: 'in_progress' }),
          'org_1',
          employeeId,
          checklistId,
          taskId,
          fetchImplementation,
        ),
    ];
    for (const status of [400, 403, 404, 409]) {
      for (const operation of operations) {
        const upstream = vi.fn<typeof fetch>(async () =>
          Response.json({}, { status }),
        );
        expect((await operation(upstream)).status).toBe(status);
        expect(upstream).toHaveBeenCalledOnce();
      }
    }
  });

  it('rejects malformed checklist IDs, queries, and bodies before any outbound API call', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const responses = await Promise.all([
      getChecklistTemplates(
        auth,
        datasetRequest('hr/checklist-templates?unknown=true'),
        'org_1',
        fetchImplementation,
      ),
      postChecklistTemplate(
        auth,
        request('POST', { legalEntityId: LEGAL_ENTITY_ID }),
        'org_1',
        fetchImplementation,
      ),
      patchChecklistTemplate(
        auth,
        request('PATCH', {}),
        'org_1',
        'bad-id',
        fetchImplementation,
      ),
      postChecklistTemplateItem(
        auth,
        request('POST', { position: 0 }),
        'org_1',
        'bad-id',
        fetchImplementation,
      ),
      patchChecklistTemplateItem(
        auth,
        request('PATCH', {}),
        'org_1',
        templateId,
        'bad-id',
        fetchImplementation,
      ),
      getEmployeeChecklists(
        auth,
        datasetRequest(
          `employees/${employeeId}/checklists?dueBefore=not-a-date`,
        ),
        'org_1',
        employeeId,
        fetchImplementation,
      ),
      postEmployeeChecklist(
        auth,
        request('POST', { templateId, startedOn: 'bad' }),
        'org_1',
        'bad-id',
        fetchImplementation,
      ),
      patchChecklistTask(
        auth,
        request('PATCH', { status: 'skipped' }),
        'org_1',
        employeeId,
        checklistId,
        taskId,
        fetchImplementation,
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 404, 404, 404, 400, 404, 400,
    ]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe('My HR fixed BFF routes', () => {
  const employeeId = '00000000-0000-4000-8000-000000000201';
  const relationshipId = '00000000-0000-4000-8000-000000000202';
  const timesheetId = '00000000-0000-4000-8000-000000000203';
  const leaveTypeId = '00000000-0000-4000-8000-000000000204';
  const leaveRequestId = '00000000-0000-4000-8000-000000000205';
  const createdAt = '2026-09-21T00:00:00.000Z';
  const entry = {
    activityCode: null,
    breakMinutes: 0,
    endedAt: '2026-09-21T17:00:00.000Z',
    holidayMinutes: 0,
    id: '00000000-0000-4000-8000-000000000206',
    nightMinutes: 0,
    overtimeMinutes: 0,
    standbyMinutes: 0,
    startedAt: '2026-09-21T09:00:00.000Z',
    updatedAt: createdAt,
    createdAt,
    workDate: '2026-09-21',
  };
  const timesheet = {
    approvedAt: null,
    approvedBy: null,
    createdAt,
    employeeId,
    entries: [entry],
    id: timesheetId,
    legalEntityId: LEGAL_ENTITY_ID,
    periodEnd: '2026-09-21',
    periodStart: '2026-09-21',
    rejectionReason: null,
    relationshipId,
    status: 'draft',
    submittedAt: null,
    supersedesTimesheetId: null,
    totalBreakMinutes: 0,
    totalHolidayMinutes: 0,
    totalNightMinutes: 0,
    totalOvertimeMinutes: 0,
    totalStandbyMinutes: 0,
    totalWorkedMinutes: 480,
    updatedAt: createdAt,
    version: 1,
  };
  const leaveRequest = {
    createdAt,
    decidedAt: null,
    decidedBy: null,
    employeeId,
    endsOn: '2026-09-22',
    id: leaveRequestId,
    leaveTypeId,
    legalEntityId: LEGAL_ENTITY_ID,
    reason: null,
    relationshipId,
    requestedAmount: '1',
    startsOn: '2026-09-22',
    status: 'requested',
    updatedAt: createdAt,
  };
  const request = (path: string, init?: RequestInit) =>
    new Request(`https://bap.invalid/${path}`, init);

  it('rebuilds own queries with defaults and maps every fixed own operation', async () => {
    const outbound: Array<{ method: string; url: string }> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      outbound.push({ method, url });
      if (url.endsWith('/access'))
        return Response.json({
          available: true,
          employeeId,
          legalEntityId: LEGAL_ENTITY_ID,
        });
      if (url.endsWith('/profile'))
        return Response.json({
          employee: {
            id: employeeId,
            legalEntityId: LEGAL_ENTITY_ID,
            employeeNumber: 'SELF-1',
            firstName: 'Self',
            lastName: 'Service',
            workEmail: null,
            workPhone: null,
            status: 'active',
            createdAt,
            updatedAt: createdAt,
          },
          relationships: [
            {
              id: relationshipId,
              employeeId,
              kind: 'employment',
              position: 'Role',
              department: null,
              costCentre: null,
              weeklyHours: '40',
              startDate: '2026-01-01',
              endDate: null,
              createdAt,
              updatedAt: createdAt,
            },
          ],
        });
      if (url.includes('/documents'))
        return Response.json({ items: [], page: 1, pageSize: 25, total: 0 });
      if (url.includes('/payslips'))
        return Response.json({ items: [], page: 1, pageSize: 25, total: 0 });
      if (url.includes('/leave-types'))
        return Response.json({ items: [], page: 1, pageSize: 25, total: 0 });
      if (url.includes('/leave-requests')) {
        if (method === 'GET')
          return Response.json({ items: [], page: 1, pageSize: 25, total: 0 });
        return Response.json(leaveRequest, {
          status: method === 'POST' && !url.endsWith('/cancel') ? 201 : 200,
        });
      }
      if (method === 'GET')
        return Response.json({ items: [], page: 1, pageSize: 25, total: 0 });
      return Response.json(timesheet, {
        status: method === 'POST' && !url.endsWith('/submit') ? 201 : 200,
      });
    });
    const body = JSON.stringify({
      relationshipId,
      periodStart: '2026-09-21',
      periodEnd: '2026-09-21',
      entries: [
        {
          workDate: '2026-09-21',
          startedAt: '2026-09-21T09:00:00.000Z',
          endedAt: '2026-09-21T17:00:00.000Z',
        },
      ],
    });
    const leaveBody = JSON.stringify({
      relationshipId,
      leaveTypeId,
      startsOn: '2026-09-22',
      endsOn: '2026-09-22',
      requestedAmount: '1',
    });
    const responses = await Promise.all([
      getMyHrAccess(
        auth,
        request('my-hr/access'),
        'org_1',
        fetchImplementation,
      ),
      getMyHrProfile(
        auth,
        request('my-hr/profile'),
        'org_1',
        fetchImplementation,
      ),
      getMyHrDocuments(
        auth,
        request('my-hr/documents?ignored=x'),
        'org_1',
        fetchImplementation,
      ),
      getMyHrPayslips(
        auth,
        request('my-hr/payslips?fromMonth=2026-09'),
        'org_1',
        fetchImplementation,
      ),
      getMyHrTimesheets(
        auth,
        request('my-hr/timesheets?status=draft'),
        'org_1',
        fetchImplementation,
      ),
      postMyHrTimesheet(
        auth,
        request('my-hr/timesheets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        'org_1',
        fetchImplementation,
      ),
      patchMyHrTimesheet(
        auth,
        request('my-hr/timesheets', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entries: [
              {
                workDate: '2026-09-21',
                startedAt: '2026-09-21T09:00:00.000Z',
                endedAt: '2026-09-21T17:00:00.000Z',
              },
            ],
          }),
        }),
        'org_1',
        timesheetId,
        fetchImplementation,
      ),
      postMyHrTimesheetSubmit(
        auth,
        request('my-hr/timesheets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
        'org_1',
        timesheetId,
        fetchImplementation,
      ),
      getMyHrLeaveTypes(
        auth,
        request('my-hr/leave-types?q=vacation'),
        'org_1',
        fetchImplementation,
      ),
      getMyHrLeaveRequests(
        auth,
        request('my-hr/leave-requests?status=requested'),
        'org_1',
        fetchImplementation,
      ),
      postMyHrLeaveRequest(
        auth,
        request('my-hr/leave-requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: leaveBody,
        }),
        'org_1',
        fetchImplementation,
      ),
      postMyHrLeaveRequestCancel(
        auth,
        request('my-hr/leave-requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'Changed plans' }),
        }),
        'org_1',
        leaveRequestId,
        fetchImplementation,
      ),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 400, 200, 200, 201, 200, 200, 200, 200, 201, 200,
    ]);
    expect(outbound).toEqual(
      expect.arrayContaining([
        {
          method: 'GET',
          url: 'http://api:3001/v1/organizations/org_1/my-hr/payslips?page=1&pageSize=25&fromMonth=2026-09',
        },
        {
          method: 'GET',
          url: 'http://api:3001/v1/organizations/org_1/my-hr/timesheets?page=1&pageSize=25&status=draft',
        },
        {
          method: 'GET',
          url: 'http://api:3001/v1/organizations/org_1/my-hr/leave-types?page=1&pageSize=25&q=vacation',
        },
        {
          method: 'POST',
          url: `http://api:3001/v1/organizations/org_1/my-hr/timesheets/${timesheetId}/submit`,
        },
        {
          method: 'POST',
          url: `http://api:3001/v1/organizations/org_1/my-hr/leave-requests/${leaveRequestId}/cancel`,
        },
      ]),
    );
  });

  it('refuses selectors and forbidden own fields before minting an outbound call and preserves API refusals', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ detail: 'hidden' }, { status: 404 }),
    );
    const invalid = await Promise.all([
      getMyHrLeaveTypes(
        auth,
        request('my-hr/leave-types?active=true'),
        'org_1',
        fetchImplementation,
      ),
      postMyHrTimesheet(
        auth,
        request('my-hr/timesheets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            employeeId,
            relationshipId,
            periodStart: '2026-09-21',
            periodEnd: '2026-09-21',
            entries: [],
          }),
        }),
        'org_1',
        fetchImplementation,
      ),
      postMyHrLeaveRequest(
        auth,
        request('my-hr/leave-requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ legalEntityId: LEGAL_ENTITY_ID }),
        }),
        'org_1',
        fetchImplementation,
      ),
      postMyHrTimesheetSubmit(
        auth,
        request('my-hr/timesheets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: 'submit' }),
        }),
        'org_1',
        'not-a-uuid',
        fetchImplementation,
      ),
      patchMyHrTimesheet(
        auth,
        request('my-hr/timesheets', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entries: [
              {
                workDate: '2026-09-21',
                startedAt: '2026-09-21T09:00:00.000Z',
                endedAt: '2026-09-21T17:00:00.000Z',
              },
            ],
          }),
        }),
        '../org',
        timesheetId,
        fetchImplementation,
      ),
    ]);
    expect(invalid.map((response) => response.status)).toEqual([
      400, 400, 400, 404, 403,
    ]);
    expect(fetchImplementation).not.toHaveBeenCalled();
    const denied = await getMyHrAccess(
      auth,
      request('my-hr/access'),
      'org_1',
      fetchImplementation,
    );
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ error: 'my_hr_unavailable' });
  });
});
