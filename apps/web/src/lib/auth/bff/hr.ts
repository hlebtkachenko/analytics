import { z } from 'zod';

import {
  payrollImportConsumeResponseSchema,
  payrollImportIdSchema,
  payrollImportResponseSchema,
} from '../../payroll/contract.ts';

import {
  correctPayrollRunSchema,
  createPayrollRunSchema,
  payrollApprovalsSchema,
  payrollCommandSchema,
  payrollLiabilitiesSchema,
  payrollRunListQuerySchema,
  payrollRunListSchema,
  payrollRunSchema,
  employeePayrollResultListSchema,
  employeePayrollResultQuerySchema,
  recordPayrollPaymentSchema,
  rejectPayrollRunSchema,
} from '../../payroll/contract.ts';

import {
  createEmployeeDocumentSchema,
  employeeDocumentListQuerySchema,
  employeeDocumentListSchema,
  employeeDocumentSchema,
  updateEmployeeDocumentSchema,
  createEmployeeSchema,
  createRelationshipSchema,
  employeeDetailSchema,
  employeeListQuerySchema,
  employeeListSchema,
  employeeSchema,
  relationshipSchema,
  updateEmployeeSchema,
  hrReferenceListQuerySchema,
  departmentListSchema,
  positionListSchema,
  costCentreListSchema,
  workplaceListSchema,
  documentCategoryListSchema,
  departmentSchema,
  positionSchema,
  costCentreSchema,
  workplaceSchema,
  documentCategorySchema,
  createDepartmentRequestSchema,
  createPositionRequestSchema,
  createCostCentreRequestSchema,
  createWorkplaceRequestSchema,
  createDocumentCategoryRequestSchema,
  updateDepartmentRequestSchema,
  updatePositionRequestSchema,
  updateCostCentreRequestSchema,
  updateWorkplaceRequestSchema,
  updateDocumentCategoryRequestSchema,
  employmentTermListQuerySchema,
  employmentTermListSchema,
  employmentTermSchema,
  createEmploymentTermSchema,
  employeeStatusHistoryQuerySchema,
  employeeStatusHistorySchema,
  employeeStatusTransitionSchema,
  employeeStatusHistoryItemSchema,
  checklistTemplateListQuerySchema,
  checklistTemplateListSchema,
  checklistTemplateSchema,
  checklistTemplateItemSchema,
  createChecklistTemplateSchema,
  updateChecklistTemplateSchema,
  createChecklistTemplateItemSchema,
  updateChecklistTemplateItemSchema,
  employeeChecklistListQuerySchema,
  employeeChecklistListSchema,
  createEmployeeChecklistSchema,
  updateChecklistTaskSchema,
  checklistSchema,
  checklistTaskSchema,
  createHrAccessAssignmentSchema,
  hrAccessAssignmentListSchema,
  hrAccessAssignmentSchema,
  payrollComponentListQuerySchema,
  payrollComponentListSchema,
  payrollComponentSchema,
  createPayrollComponentSchema,
  updatePayrollComponentSchema,
  compensationComponentListQuerySchema,
  compensationComponentListSchema,
  compensationComponentSchema,
  createCompensationComponentSchema,
  updateCompensationComponentSchema,
  payrollAccountMappingListQuerySchema,
  payrollAccountMappingListSchema,
  payrollAccountMappingSchema,
  createPayrollAccountMappingSchema,
  updatePayrollAccountMappingSchema,
} from '../../hr/contract.ts';

import {
  absenceListQuerySchema,
  absenceListSchema,
  absenceSchema,
  createAbsenceSchema,
  createLeaveLedgerSchema,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  createScheduleSchema,
  createTimesheetSchema,
  emptyCommandSchema,
  leaveBalancesSchema,
  leaveCancelSchema,
  leaveDecisionSchema,
  leaveLedgerSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeListQuerySchema,
  leaveTypeListSchema,
  leaveTypeSchema,
  reasonCommandSchema,
  scheduleListQuerySchema,
  scheduleListSchema,
  scheduleSchema,
  timesheetListQuerySchema,
  timesheetListSchema,
  timesheetSchema,
  updateAbsenceSchema,
  updateLeaveTypeSchema,
  updateTimesheetSchema,
} from '../../hr-time/contract.ts';

import {
  createLeaveRequestSchema as myHrCreateLeaveRequestSchema,
  createTimesheetSchema as myHrCreateTimesheetSchema,
  leaveCancelSchema as myHrLeaveCancelSchema,
  leaveRequestListQuerySchema as myHrLeaveRequestListQuerySchema,
  leaveRequestListSchema as myHrLeaveRequestListSchema,
  leaveRequestSchema as myHrLeaveRequestSchema,
  leaveTypeListSchema as myHrLeaveTypeListSchema,
  myHrAccessSchema,
  myHrDocumentsQuerySchema,
  myHrDocumentsSchema,
  myHrLeaveTypesQuerySchema,
  myHrPayslipsQuerySchema,
  myHrPayslipsSchema,
  myHrProfileSchema,
  timesheetListQuerySchema as myHrTimesheetListQuerySchema,
  timesheetListSchema as myHrTimesheetListSchema,
  timesheetSchema as myHrTimesheetSchema,
  updateTimesheetSchema as myHrUpdateTimesheetSchema,
} from '../../hr-self-service/contract.ts';

import {
  UPLOAD_TIMEOUT_MS,
  applicationPath,
  callApplicationJson,
  jsonResponse,
  legalEntityIdSchema,
  parsedIdentifier,
  prepareApplicationCall,
  readJsonBody,
  requestIdSchema,
  upstreamFailure,
} from './core.ts';
import type { BffAuth } from './core.ts';

const payrollMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const payrollImportFileNameSchema = /\.(csv|xlsx)$/i;
const MAX_PAYROLL_IMPORT_BYTES = 5_000_000;

type HrReferenceCollection =
  | 'departments'
  | 'positions'
  | 'cost-centres'
  | 'workplaces'
  | 'document-categories';

async function readPayrollImportBody(
  request: Request,
): Promise<
  | Readonly<{ data: FormData; idempotencyKey: string }>
  | Readonly<{ failure: Response }>
> {
  if (
    !(request.headers.get('content-type') ?? '').startsWith(
      'multipart/form-data',
    )
  ) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }
  const idempotencyKey = requestIdSchema.safeParse(
    request.headers.get('idempotency-key'),
  );
  if (!idempotencyKey.success) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }
  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }
  const file = incoming.get('file');
  const payrollFile =
    file !== null &&
    typeof file === 'object' &&
    'name' in file &&
    'size' in file
      ? (file as File)
      : undefined;
  const legalEntityId = legalEntityIdSchema.safeParse(
    incoming.get('legalEntityId'),
  );
  const payrollMonth = payrollMonthSchema.safeParse(
    incoming.get('payrollMonth'),
  );
  if (
    payrollFile === undefined ||
    payrollFile.size === 0 ||
    payrollFile.size > MAX_PAYROLL_IMPORT_BYTES ||
    !payrollImportFileNameSchema.test(payrollFile.name) ||
    !legalEntityId.success ||
    !payrollMonth.success ||
    [...incoming.keys()].some(
      (key) =>
        key !== 'file' && key !== 'legalEntityId' && key !== 'payrollMonth',
    ) ||
    incoming.getAll('file').length !== 1 ||
    incoming.getAll('legalEntityId').length !== 1 ||
    incoming.getAll('payrollMonth').length !== 1
  ) {
    return { failure: jsonResponse({ error: 'invalid_body' }, 400) };
  }
  const body = new FormData();
  body.set('file', payrollFile, payrollFile.name);
  body.set('legalEntityId', legalEntityId.data);
  body.set('payrollMonth', payrollMonth.data);
  return { data: body, idempotencyKey: idempotencyKey.data };
}

export async function postPayrollImport(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readPayrollImportBody(request);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  let response: Response;
  try {
    response = await fetchImplementation(
      applicationPath(prepared.selector, 'payroll/imports'),
      {
        body: body.data,
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${prepared.token}`,
          'idempotency-key': body.idempotencyKey,
          'x-bap-request-id': prepared.requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      },
    );
  } catch {
    return upstreamFailure('postPayrollImport', 'unreachable');
  }
  if (!response.ok) {
    if (response.status >= 500)
      return upstreamFailure('postPayrollImport', 'unreachable');
    return jsonResponse({ error: 'payroll_import_rejected' }, response.status);
  }
  const payload = payrollImportResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!payload.success)
    return upstreamFailure('postPayrollImport', 'unexpected_shape');
  return jsonResponse(payload.data, 201, {
    'x-request-id': prepared.requestId,
  });
}

export async function getPayrollImport(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  importId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = payrollImportIdSchema.safeParse(importId);
  if (!id.success)
    return jsonResponse({ error: 'payroll_import_not_found' }, 404);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_import_unavailable',
      method: 'GET',
      operation: 'getPayrollImport',
      path: `payroll/imports/${id.data}`,
      schema: payrollImportResponseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postPayrollImportConsume(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  importId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = payrollImportIdSchema.safeParse(importId);
  if (!id.success)
    return jsonResponse({ error: 'payroll_import_not_found' }, 404);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  const response = await callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_import_rejected',
      method: 'POST',
      operation: 'postPayrollImportConsume',
      path: `payroll/imports/${id.data}/consume`,
      schema: payrollImportConsumeResponseSchema,
      successStatus: [200, 201],
    },
    fetchImplementation,
  );
  return response;
}

// A malformed identifier answers exactly like an invisible one, so nothing can be enumerated.
function hrQuery(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}

export async function getEmployees(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = employeeListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      errorCode: 'employees_unavailable',
      method: 'GET',
      operation: 'getEmployees',
      path: `employees?${hrQuery(query.data)}`,
      schema: employeeListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postEmployee(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createEmployeeSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_rejected',
      method: 'POST',
      operation: 'postEmployee',
      path: 'employees',
      schema: employeeSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function getEmployee(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      errorCode: 'employee_unavailable',
      method: 'GET',
      operation: 'getEmployee',
      path: `employees/${id.value}`,
      schema: employeeDetailSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function patchEmployee(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, updateEmployeeSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_rejected',
      method: 'PATCH',
      operation: 'patchEmployee',
      path: `employees/${id.value}`,
      schema: employeeSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
async function employeeChild(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  suffix: string,
  operation: string,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_rejected',
      method: 'POST',
      operation,
      path: `employees/${id.value}/${suffix}`,
      schema: responseSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function postEmployeeRelationship(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
) {
  return employeeChild(
    auth,
    request,
    organizationId,
    employeeId,
    createRelationshipSchema,
    relationshipSchema,
    'relationships',
    'postEmployeeRelationship',
    fetchImplementation,
  );
}
export async function getEmployeeRelationships(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return await callApplicationJson(
    prepared,
    {
      errorCode: 'employee_relationships_unavailable',
      method: 'GET',
      operation: 'getEmployeeRelationships',
      path: `employees/${id.value}/relationships`,
      schema: z.object({ relationships: z.array(relationshipSchema) }).strict(),
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function getEmploymentTerms(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const query = employmentTermListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'employment_terms_unavailable',
      method: 'GET',
      operation: 'getEmploymentTerms',
      path: `employees/${id.value}/employment-terms?${hrQuery(query.data)}`,
      schema: employmentTermListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postEmploymentTerm(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, createEmploymentTermSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employment_term_rejected',
      method: 'POST',
      operation: 'postEmploymentTerm',
      path: `employees/${id.value}/employment-terms`,
      schema: employmentTermSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function getEmployeeStatusHistory(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const query = employeeStatusHistoryQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'employee_status_history_unavailable',
      method: 'GET',
      operation: 'getEmployeeStatusHistory',
      path: `employees/${id.value}/status-history?${hrQuery(query.data)}`,
      schema: employeeStatusHistorySchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postEmployeeStatusTransition(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, employeeStatusTransitionSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_status_transition_rejected',
      method: 'POST',
      operation: 'postEmployeeStatusTransition',
      path: `employees/${id.value}/status-transitions`,
      schema: employeeStatusHistoryItemSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postEmployeeDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, createEmployeeDocumentSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_document_rejected',
      method: 'POST',
      operation: 'postEmployeeDocument',
      path: `employees/${id.value}/documents`,
      schema: employeeDocumentSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function getEmployeeDocuments(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const query = employeeDocumentListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'employee_documents_unavailable',
      method: 'GET',
      operation: 'getEmployeeDocuments',
      path: `employees/${id.value}/documents?${hrQuery(query.data)}`,
      schema: employeeDocumentListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function patchEmployeeDocument(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  documentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const employee = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in employee) return employee.failure;
  const document = parsedIdentifier(documentId, 'document_not_found');
  if ('failure' in document) return document.failure;
  const body = await readJsonBody(request, updateEmployeeDocumentSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_document_rejected',
      method: 'PATCH',
      operation: 'patchEmployeeDocument',
      path: `employees/${employee.value}/documents/${document.value}`,
      schema: employeeDocumentSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getChecklistTemplates(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const query = checklistTemplateListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'checklist_templates_unavailable',
      method: 'GET',
      operation: 'getChecklistTemplates',
      path: `hr/checklist-templates?${hrQuery({ legalEntityId: query.data.legalEntityId, kind: query.data.kind, active: query.data.active, q: query.data.q, page: query.data.page, pageSize: query.data.pageSize })}`,
      schema: checklistTemplateListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postChecklistTemplate(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createChecklistTemplateSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'checklist_template_rejected',
      method: 'POST',
      operation: 'postChecklistTemplate',
      path: 'hr/checklist-templates',
      schema: checklistTemplateSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function patchChecklistTemplate(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  templateId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(templateId, 'checklist_template_not_found');
  if ('failure' in id) return id.failure;
  const body = await readJsonBody(request, updateChecklistTemplateSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'checklist_template_rejected',
      method: 'PATCH',
      operation: 'patchChecklistTemplate',
      path: `hr/checklist-templates/${id.value}`,
      schema: checklistTemplateSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
async function checklistTemplateItemMutation(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  templateId: string,
  itemId: string | undefined,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const template = parsedIdentifier(templateId, 'checklist_template_not_found');
  if ('failure' in template) return template.failure;
  const item =
    itemId === undefined
      ? undefined
      : parsedIdentifier(itemId, 'checklist_template_item_not_found');
  if (item && 'failure' in item) return item.failure;
  const body = await readJsonBody(
    request,
    (item
      ? updateChecklistTemplateItemSchema
      : createChecklistTemplateItemSchema) as z.ZodType<unknown>,
  );
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'checklist_template_item_rejected',
      method: item ? 'PATCH' : 'POST',
      operation: item
        ? 'patchChecklistTemplateItem'
        : 'postChecklistTemplateItem',
      path: `hr/checklist-templates/${template.value}/items${item ? `/${item.value}` : ''}`,
      schema: checklistTemplateItemSchema,
      successStatus: item ? 200 : 201,
    },
    fetchImplementation,
  );
}
export function postChecklistTemplateItem(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  templateId: string,
  fetchImplementation: typeof fetch = fetch,
) {
  return checklistTemplateItemMutation(
    auth,
    request,
    organizationId,
    templateId,
    undefined,
    fetchImplementation,
  );
}
export function patchChecklistTemplateItem(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  templateId: string,
  itemId: string,
  fetchImplementation: typeof fetch = fetch,
) {
  return checklistTemplateItemMutation(
    auth,
    request,
    organizationId,
    templateId,
    itemId,
    fetchImplementation,
  );
}
export async function getEmployeeChecklists(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const employee = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in employee) return employee.failure;
  const query = employeeChecklistListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'employee_checklists_unavailable',
      method: 'GET',
      operation: 'getEmployeeChecklists',
      path: `employees/${employee.value}/checklists?${hrQuery({ kind: query.data.kind, status: query.data.status, ownerUserId: query.data.ownerUserId, dueBefore: query.data.dueBefore, page: query.data.page, pageSize: query.data.pageSize })}`,
      schema: employeeChecklistListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postEmployeeChecklist(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const employee = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in employee) return employee.failure;
  const body = await readJsonBody(request, createEmployeeChecklistSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'employee_checklist_rejected',
      method: 'POST',
      operation: 'postEmployeeChecklist',
      path: `employees/${employee.value}/checklists`,
      schema: checklistSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function patchChecklistTask(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  checklistId: string,
  taskId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const employee = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in employee) return employee.failure;
  const checklist = parsedIdentifier(checklistId, 'checklist_not_found');
  if ('failure' in checklist) return checklist.failure;
  const task = parsedIdentifier(taskId, 'checklist_task_not_found');
  if ('failure' in task) return task.failure;
  const body = await readJsonBody(request, updateChecklistTaskSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'checklist_task_rejected',
      method: 'PATCH',
      operation: 'patchChecklistTask',
      path: `employees/${employee.value}/checklists/${checklist.value}/tasks/${task.value}`,
      schema: checklistTaskSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function getPayrollRuns(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const permitted = new Set(['legalEntityId', 'month', 'page', 'pageSize']);
  const query =
    [...search.keys()].every((key) => permitted.has(key)) &&
    [...permitted].every((key) => search.getAll(key).length <= 1)
      ? payrollRunListQuerySchema.safeParse(Object.fromEntries(search))
      : { success: false as const };
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_unavailable',
      method: 'GET',
      operation: 'getPayrollRuns',
      path: `payroll-runs?${hrQuery(query.data)}`,
      schema: payrollRunListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function getEmployeePayrollResults(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  employeeId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  if ('failure' in id) return id.failure;
  const search = new URL(request.url).searchParams;
  const permitted = new Set(['fromMonth', 'toMonth', 'page', 'pageSize']);
  const query =
    [...search.keys()].every((key) => permitted.has(key)) &&
    [...permitted].every((key) => search.getAll(key).length <= 1)
      ? employeePayrollResultQuerySchema.safeParse(Object.fromEntries(search))
      : { success: false as const };
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  const outbound = new URLSearchParams();
  if (query.data.fromMonth !== undefined)
    outbound.set('fromMonth', query.data.fromMonth);
  if (query.data.toMonth !== undefined)
    outbound.set('toMonth', query.data.toMonth);
  outbound.set('page', String(query.data.page));
  outbound.set('pageSize', String(query.data.pageSize));
  return callApplicationJson(
    prepared,
    {
      errorCode: 'employee_payroll_results_unavailable',
      method: 'GET',
      operation: 'getEmployeePayrollResults',
      path: `employees/${id.value}/payroll-results?${outbound.toString()}`,
      schema: employeePayrollResultListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postPayrollRun(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createPayrollRunSchema);
  if ('failure' in body) return body.failure;
  const idempotencyKey = requestIdSchema.safeParse(
    request.headers.get('idempotency-key'),
  );
  if (!idempotencyKey.success)
    return jsonResponse({ error: 'invalid_body' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'payroll_rejected',
      headers: { 'idempotency-key': idempotencyKey.data },
      method: 'POST',
      operation: 'postPayrollRun',
      path: 'payroll-runs',
      schema: payrollRunSchema,
      successStatus: [200, 201],
    },
    fetchImplementation,
  );
}

async function payrollCommand(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  command:
    | 'validate'
    | 'submit-for-approval'
    | 'approve'
    | 'reject'
    | 'finalize'
    | 'record-payment'
    | 'corrections',
  schema: z.ZodType,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const id = parsedIdentifier(payrollRunId, 'payroll_not_found');
  if ('failure' in id) return id.failure;
  if ([...new URL(request.url).searchParams.keys()].length > 0)
    return jsonResponse({ error: 'invalid_query' }, 400);
  const body = await readJsonBody(request, schema);
  if ('failure' in body) return body.failure;
  const idempotencyKey = requestIdSchema.safeParse(
    request.headers.get('idempotency-key'),
  );
  if (!idempotencyKey.success)
    return jsonResponse({ error: 'invalid_body' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'payroll_rejected',
      headers: { 'idempotency-key': idempotencyKey.data },
      method: 'POST',
      operation: `postPayrollRun${command}`,
      path: `payroll-runs/${id.value}/${command}`,
      schema: payrollRunSchema,
      successStatus: [200, 201],
    },
    fetchImplementation,
  );
}

export const postPayrollRunValidation = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'validate',
    payrollCommandSchema,
    fetchImplementation,
  );
export const postPayrollRunSubmitForApproval = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'submit-for-approval',
    payrollCommandSchema,
    fetchImplementation,
  );
export const postPayrollRunApproval = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'approve',
    payrollCommandSchema,
    fetchImplementation,
  );
export const postPayrollRunRejection = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'reject',
    rejectPayrollRunSchema,
    fetchImplementation,
  );
export const postPayrollRunFinalization = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'finalize',
    payrollCommandSchema,
    fetchImplementation,
  );
export const postPayrollRunPayment = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'record-payment',
    recordPayrollPaymentSchema,
    fetchImplementation,
  );
export const postPayrollRunCorrection = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollCommand(
    auth,
    request,
    organizationId,
    payrollRunId,
    'corrections',
    correctPayrollRunSchema,
    fetchImplementation,
  );

async function payrollRunCollection(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  collection: 'approvals' | 'liabilities',
  schema: z.ZodType,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const id = parsedIdentifier(payrollRunId, 'payroll_not_found');
  if ('failure' in id) return id.failure;
  if ([...new URL(request.url).searchParams.keys()].length > 0)
    return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_unavailable',
      method: 'GET',
      operation: `getPayrollRun${collection}`,
      path: `payroll-runs/${id.value}/${collection}`,
      schema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export const getPayrollRunApprovals = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollRunCollection(
    auth,
    request,
    organizationId,
    payrollRunId,
    'approvals',
    payrollApprovalsSchema,
    fetchImplementation,
  );
export const getPayrollRunLiabilities = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  payrollRunCollection(
    auth,
    request,
    organizationId,
    payrollRunId,
    'liabilities',
    payrollLiabilitiesSchema,
    fetchImplementation,
  );
export async function getPayrollRun(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  payrollRunId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const id = parsedIdentifier(payrollRunId, 'payroll_not_found');
  if ('failure' in id) return id.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_unavailable',
      method: 'GET',
      operation: 'getPayrollRun',
      path: `payroll-runs/${id.value}`,
      schema: payrollRunSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function getHrAccessAssignments(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'hr_access_assignments_unavailable',
      method: 'GET',
      operation: 'getHrAccessAssignments',
      path: 'hr/access-assignments',
      schema: hrAccessAssignmentListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
export async function postHrAccessAssignment(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, createHrAccessAssignmentSchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'hr_access_assignment_rejected',
      method: 'POST',
      operation: 'postHrAccessAssignment',
      path: 'hr/access-assignments',
      schema: hrAccessAssignmentSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}
export async function deleteHrAccessAssignment(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  assignmentId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selected = parsedIdentifier(
    assignmentId,
    'hr_access_assignment_not_found',
  );
  if ('failure' in selected) return selected.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'hr_access_assignment_rejected',
      method: 'DELETE',
      operation: 'deleteHrAccessAssignment',
      path: `hr/access-assignments/${selected.value}`,
      schema: z.object({ revoked: z.literal(true) }).strict(),
      successStatus: 200,
    },
    fetchImplementation,
  );
}

function hrReferenceQuery(query: z.infer<typeof hrReferenceListQuerySchema>) {
  return hrQuery({
    legalEntityId: query.legalEntityId,
    q: query.q,
    active: query.active,
    page: query.page,
    pageSize: query.pageSize,
  });
}

async function getHrReferences(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  collection: HrReferenceCollection,
  schema: z.ZodType,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const query = hrReferenceListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'hr_references_unavailable',
      method: 'GET',
      operation: `getHr${collection}`,
      path: `hr/${collection}?${hrReferenceQuery(query.data)}`,
      schema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

async function postHrReference(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  collection: HrReferenceCollection,
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'hr_reference_rejected',
      method: 'POST',
      operation: `postHr${collection}`,
      path: `hr/${collection}`,
      schema: responseSchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

async function patchHrReference(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  collection: HrReferenceCollection,
  id: string,
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const selected = parsedIdentifier(id, 'hr_reference_not_found');
  if ('failure' in selected) return selected.failure;
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'hr_reference_rejected',
      method: 'PATCH',
      operation: `patchHr${collection}`,
      path: `hr/${collection}/${selected.value}`,
      schema: responseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export const getDepartments = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  getHrReferences(
    auth,
    request,
    organizationId,
    'departments',
    departmentListSchema,
    fetchImplementation,
  );
export const postDepartment = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  postHrReference(
    auth,
    request,
    organizationId,
    'departments',
    createDepartmentRequestSchema,
    departmentSchema,
    fetchImplementation,
  );
export const patchDepartment = (
  auth: BffAuth,
  request: Request,
  organizationId: string,
  id: string,
  fetchImplementation: typeof fetch = fetch,
) =>
  patchHrReference(
    auth,
    request,
    organizationId,
    'departments',
    id,
    updateDepartmentRequestSchema,
    departmentSchema,
    fetchImplementation,
  );
export const getPositions = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) => getHrReferences(a, r, o, 'positions', positionListSchema, f);
export const postPosition = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  postHrReference(
    a,
    r,
    o,
    'positions',
    createPositionRequestSchema,
    positionSchema,
    f,
  );
export const patchPosition = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) =>
  patchHrReference(
    a,
    r,
    o,
    'positions',
    id,
    updatePositionRequestSchema,
    positionSchema,
    f,
  );
export const getCostCentres = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) => getHrReferences(a, r, o, 'cost-centres', costCentreListSchema, f);
export const postCostCentre = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  postHrReference(
    a,
    r,
    o,
    'cost-centres',
    createCostCentreRequestSchema,
    costCentreSchema,
    f,
  );
export const patchCostCentre = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) =>
  patchHrReference(
    a,
    r,
    o,
    'cost-centres',
    id,
    updateCostCentreRequestSchema,
    costCentreSchema,
    f,
  );
export const getWorkplaces = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) => getHrReferences(a, r, o, 'workplaces', workplaceListSchema, f);
export const postWorkplace = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  postHrReference(
    a,
    r,
    o,
    'workplaces',
    createWorkplaceRequestSchema,
    workplaceSchema,
    f,
  );
export const patchWorkplace = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) =>
  patchHrReference(
    a,
    r,
    o,
    'workplaces',
    id,
    updateWorkplaceRequestSchema,
    workplaceSchema,
    f,
  );

async function payrollCollection(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  querySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  fetchImplementation: typeof fetch,
) {
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      errorCode: 'payroll_unavailable',
      method: 'GET',
      operation,
      path: `${path}?${hrQuery(query.data as Record<string, string | number | undefined>)}`,
      schema: responseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
async function payrollMutation(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  method: 'POST' | 'PATCH',
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  fetchImplementation: typeof fetch,
) {
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'payroll_rejected',
      method,
      operation,
      path,
      schema: responseSchema,
      successStatus: method === 'POST' ? 201 : 200,
    },
    fetchImplementation,
  );
}
export const getPayrollComponents = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  payrollCollection(
    a,
    r,
    o,
    'payroll/components',
    payrollComponentListQuerySchema,
    payrollComponentListSchema,
    'getPayrollComponents',
    f,
  );
export const postPayrollComponent = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  payrollMutation(
    a,
    r,
    o,
    'payroll/components',
    'POST',
    createPayrollComponentSchema,
    payrollComponentSchema,
    'postPayrollComponent',
    f,
  );
export async function patchPayrollComponent(
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) {
  const parsed = parsedIdentifier(id, 'payroll_component_not_found');
  return 'failure' in parsed
    ? parsed.failure
    : payrollMutation(
        a,
        r,
        o,
        `payroll/components/${parsed.value}`,
        'PATCH',
        updatePayrollComponentSchema,
        payrollComponentSchema,
        'patchPayrollComponent',
        f,
      );
}
export async function getEmployeeCompensationComponents(
  a: BffAuth,
  r: Request,
  o: string,
  employeeId: string,
  f: typeof fetch = fetch,
) {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  return 'failure' in id
    ? id.failure
    : payrollCollection(
        a,
        r,
        o,
        `employees/${id.value}/compensation-components`,
        compensationComponentListQuerySchema,
        compensationComponentListSchema,
        'getEmployeeCompensationComponents',
        f,
      );
}
export async function postEmployeeCompensationComponent(
  a: BffAuth,
  r: Request,
  o: string,
  employeeId: string,
  f: typeof fetch = fetch,
) {
  const id = parsedIdentifier(employeeId, 'employee_not_found');
  return 'failure' in id
    ? id.failure
    : payrollMutation(
        a,
        r,
        o,
        `employees/${id.value}/compensation-components`,
        'POST',
        createCompensationComponentSchema,
        compensationComponentSchema,
        'postEmployeeCompensationComponent',
        f,
      );
}
export async function patchEmployeeCompensationComponent(
  a: BffAuth,
  r: Request,
  o: string,
  employeeId: string,
  componentId: string,
  f: typeof fetch = fetch,
) {
  const employee = parsedIdentifier(employeeId, 'employee_not_found');
  const component = parsedIdentifier(
    componentId,
    'compensation_component_not_found',
  );
  return 'failure' in employee
    ? employee.failure
    : 'failure' in component
      ? component.failure
      : payrollMutation(
          a,
          r,
          o,
          `employees/${employee.value}/compensation-components/${component.value}`,
          'PATCH',
          updateCompensationComponentSchema,
          compensationComponentSchema,
          'patchEmployeeCompensationComponent',
          f,
        );
}
export const getPayrollAccountMappings = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  payrollCollection(
    a,
    r,
    o,
    'payroll/account-mappings',
    payrollAccountMappingListQuerySchema,
    payrollAccountMappingListSchema,
    'getPayrollAccountMappings',
    f,
  );
export const postPayrollAccountMapping = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  payrollMutation(
    a,
    r,
    o,
    'payroll/account-mappings',
    'POST',
    createPayrollAccountMappingSchema,
    payrollAccountMappingSchema,
    'postPayrollAccountMapping',
    f,
  );
export async function patchPayrollAccountMapping(
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) {
  const parsed = parsedIdentifier(id, 'payroll_account_mapping_not_found');
  return 'failure' in parsed
    ? parsed.failure
    : payrollMutation(
        a,
        r,
        o,
        `payroll/account-mappings/${parsed.value}`,
        'PATCH',
        updatePayrollAccountMappingSchema,
        payrollAccountMappingSchema,
        'patchPayrollAccountMapping',
        f,
      );
}

async function hrTimeCollection(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  querySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  const encoded = hrQuery(
    query.data as Record<string, string | number | undefined>,
  );
  return callApplicationJson(
    prepared,
    {
      errorCode: 'hr_time_unavailable',
      method: 'GET',
      operation,
      path: encoded ? `${path}?${encoded}` : path,
      schema: responseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
async function hrTimeMutation(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  method: 'POST' | 'PATCH',
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  successStatus: 200 | 201,
  fetchImplementation: typeof fetch = fetch,
) {
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'hr_time_rejected',
      method,
      operation,
      path,
      schema: responseSchema,
      successStatus,
    },
    fetchImplementation,
  );
}
const hrTimeEmployee = (employeeId: string) =>
  parsedIdentifier(employeeId, 'employee_not_found');
const hrTimeId = (id: string, error = 'hr_time_not_found') =>
  parsedIdentifier(id, error);
export const getSchedules = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeCollection(
        a,
        r,
        o,
        `employees/${id.value}/schedules`,
        scheduleListQuerySchema,
        scheduleListSchema,
        'getSchedules',
        f,
      );
};
export const postSchedule = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `employees/${id.value}/schedules`,
        'POST',
        createScheduleSchema,
        scheduleSchema,
        'postSchedule',
        201,
        f,
      );
};
export const postSchedulePublish = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  s: string,
  f: typeof fetch = fetch,
) => {
  const employee = hrTimeEmployee(e);
  const schedule = hrTimeId(s, 'schedule_not_found');
  return 'failure' in employee
    ? employee.failure
    : 'failure' in schedule
      ? schedule.failure
      : hrTimeMutation(
          a,
          r,
          o,
          `employees/${employee.value}/schedules/${schedule.value}/publish`,
          'POST',
          emptyCommandSchema,
          scheduleSchema,
          'postSchedulePublish',
          200,
          f,
        );
};
export const getTimesheets = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeCollection(
        a,
        r,
        o,
        `employees/${id.value}/timesheets`,
        timesheetListQuerySchema,
        timesheetListSchema,
        'getTimesheets',
        f,
      );
};
export const postTimesheet = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `employees/${id.value}/timesheets`,
        'POST',
        createTimesheetSchema,
        timesheetSchema,
        'postTimesheet',
        201,
        f,
      );
};
export const patchTimesheet = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  t: string,
  f: typeof fetch = fetch,
) => {
  const employee = hrTimeEmployee(e);
  const sheet = hrTimeId(t, 'timesheet_not_found');
  return 'failure' in employee
    ? employee.failure
    : 'failure' in sheet
      ? sheet.failure
      : hrTimeMutation(
          a,
          r,
          o,
          `employees/${employee.value}/timesheets/${sheet.value}`,
          'PATCH',
          updateTimesheetSchema,
          timesheetSchema,
          'patchTimesheet',
          200,
          f,
        );
};
const timesheetCommand =
  (command: 'submit' | 'approve' | 'reject' | 'correct', schema: z.ZodType) =>
  (
    a: BffAuth,
    r: Request,
    o: string,
    e: string,
    t: string,
    f: typeof fetch = fetch,
  ) => {
    const employee = hrTimeEmployee(e);
    const sheet = hrTimeId(t, 'timesheet_not_found');
    return 'failure' in employee
      ? employee.failure
      : 'failure' in sheet
        ? sheet.failure
        : hrTimeMutation(
            a,
            r,
            o,
            `employees/${employee.value}/timesheets/${sheet.value}/${command}`,
            'POST',
            schema,
            timesheetSchema,
            `postTimesheet${command}`,
            200,
            f,
          );
  };
export const postTimesheetSubmit = timesheetCommand(
  'submit',
  emptyCommandSchema,
);
export const postTimesheetApprove = timesheetCommand(
  'approve',
  emptyCommandSchema,
);
export const postTimesheetReject = timesheetCommand(
  'reject',
  reasonCommandSchema,
);
export const postTimesheetCorrect = timesheetCommand(
  'correct',
  reasonCommandSchema,
);

async function myHrCollection(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  querySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return jsonResponse({ error: 'invalid_query' }, 400);
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  const encoded = hrQuery(
    parsed.data as Record<string, string | number | undefined>,
  );
  return callApplicationJson(
    prepared,
    {
      errorCode: 'my_hr_unavailable',
      method: 'GET',
      operation,
      path: encoded ? `${path}?${encoded}` : path,
      schema: responseSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}
async function myHrMutation(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  path: string,
  method: 'POST' | 'PATCH',
  bodySchema: z.ZodType,
  responseSchema: z.ZodType,
  operation: string,
  successStatus: 200 | 201,
  fetchImplementation: typeof fetch = fetch,
) {
  const body = await readJsonBody(request, bodySchema);
  if ('failure' in body) return body.failure;
  const prepared = await prepareApplicationCall(auth, request, organizationId);
  if ('failure' in prepared) return prepared.failure;
  return callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'my_hr_rejected',
      method,
      operation,
      path,
      schema: responseSchema,
      successStatus,
    },
    fetchImplementation,
  );
}
const myHrId = (id: string) => parsedIdentifier(id, 'my_hr_not_found');
export const getMyHrAccess = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/access',
    z.object({}).strict(),
    myHrAccessSchema,
    'getMyHrAccess',
    f,
  );
export const getMyHrProfile = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/profile',
    z.object({}).strict(),
    myHrProfileSchema,
    'getMyHrProfile',
    f,
  );
export const getMyHrDocuments = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/documents',
    myHrDocumentsQuerySchema,
    myHrDocumentsSchema,
    'getMyHrDocuments',
    f,
  );
export const getMyHrPayslips = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/payslips',
    myHrPayslipsQuerySchema,
    myHrPayslipsSchema,
    'getMyHrPayslips',
    f,
  );
export const getMyHrTimesheets = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/timesheets',
    myHrTimesheetListQuerySchema,
    myHrTimesheetListSchema,
    'getMyHrTimesheets',
    f,
  );
export const postMyHrTimesheet = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrMutation(
    a,
    r,
    o,
    'my-hr/timesheets',
    'POST',
    myHrCreateTimesheetSchema,
    myHrTimesheetSchema,
    'postMyHrTimesheet',
    201,
    f,
  );
export const patchMyHrTimesheet = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) => {
  const parsed = myHrId(id);
  return 'failure' in parsed
    ? parsed.failure
    : myHrMutation(
        a,
        r,
        o,
        `my-hr/timesheets/${parsed.value}`,
        'PATCH',
        myHrUpdateTimesheetSchema,
        myHrTimesheetSchema,
        'patchMyHrTimesheet',
        200,
        f,
      );
};
export const postMyHrTimesheetSubmit = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) => {
  const parsed = myHrId(id);
  return 'failure' in parsed
    ? parsed.failure
    : myHrMutation(
        a,
        r,
        o,
        `my-hr/timesheets/${parsed.value}/submit`,
        'POST',
        emptyCommandSchema,
        myHrTimesheetSchema,
        'postMyHrTimesheetSubmit',
        200,
        f,
      );
};
export const getMyHrLeaveTypes = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/leave-types',
    myHrLeaveTypesQuerySchema,
    myHrLeaveTypeListSchema,
    'getMyHrLeaveTypes',
    f,
  );
export const getMyHrLeaveRequests = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrCollection(
    a,
    r,
    o,
    'my-hr/leave-requests',
    myHrLeaveRequestListQuerySchema,
    myHrLeaveRequestListSchema,
    'getMyHrLeaveRequests',
    f,
  );
export const postMyHrLeaveRequest = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  myHrMutation(
    a,
    r,
    o,
    'my-hr/leave-requests',
    'POST',
    myHrCreateLeaveRequestSchema,
    myHrLeaveRequestSchema,
    'postMyHrLeaveRequest',
    201,
    f,
  );
export const postMyHrLeaveRequestCancel = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) => {
  const parsed = myHrId(id);
  return 'failure' in parsed
    ? parsed.failure
    : myHrMutation(
        a,
        r,
        o,
        `my-hr/leave-requests/${parsed.value}/cancel`,
        'POST',
        myHrLeaveCancelSchema,
        myHrLeaveRequestSchema,
        'postMyHrLeaveRequestCancel',
        200,
        f,
      );
};
export const getLeaveTypes = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  hrTimeCollection(
    a,
    r,
    o,
    'hr/leave-types',
    leaveTypeListQuerySchema,
    leaveTypeListSchema,
    'getLeaveTypes',
    f,
  );
export const postLeaveType = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  hrTimeMutation(
    a,
    r,
    o,
    'hr/leave-types',
    'POST',
    createLeaveTypeSchema,
    leaveTypeSchema,
    'postLeaveType',
    201,
    f,
  );
export const patchLeaveType = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) => {
  const parsed = hrTimeId(id, 'leave_type_not_found');
  return 'failure' in parsed
    ? parsed.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `hr/leave-types/${parsed.value}`,
        'PATCH',
        updateLeaveTypeSchema,
        leaveTypeSchema,
        'patchLeaveType',
        200,
        f,
      );
};
export const getLeaveRequests = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeCollection(
        a,
        r,
        o,
        `employees/${id.value}/leave-requests`,
        leaveRequestListQuerySchema,
        leaveRequestListSchema,
        'getLeaveRequests',
        f,
      );
};
export const postLeaveRequest = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `employees/${id.value}/leave-requests`,
        'POST',
        createLeaveRequestSchema,
        leaveRequestSchema,
        'postLeaveRequest',
        201,
        f,
      );
};
const leaveCommand =
  (command: 'decide' | 'cancel', schema: z.ZodType) =>
  (
    a: BffAuth,
    r: Request,
    o: string,
    e: string,
    id: string,
    f: typeof fetch = fetch,
  ) => {
    const employee = hrTimeEmployee(e);
    const request = hrTimeId(id, 'leave_request_not_found');
    return 'failure' in employee
      ? employee.failure
      : 'failure' in request
        ? request.failure
        : hrTimeMutation(
            a,
            r,
            o,
            `employees/${employee.value}/leave-requests/${request.value}/${command}`,
            'POST',
            schema,
            leaveRequestSchema,
            `postLeaveRequest${command}`,
            200,
            f,
          );
  };
export const postLeaveRequestDecide = leaveCommand(
  'decide',
  leaveDecisionSchema,
);
export const postLeaveRequestCancel = leaveCommand('cancel', leaveCancelSchema);
export const getLeaveBalances = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeCollection(
        a,
        r,
        o,
        `employees/${id.value}/leave-balances`,
        z.object({}).strict(),
        leaveBalancesSchema,
        'getLeaveBalances',
        f,
      );
};
export const postLeaveLedger = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `employees/${id.value}/leave-ledger`,
        'POST',
        createLeaveLedgerSchema,
        leaveLedgerSchema,
        'postLeaveLedger',
        201,
        f,
      );
};
export const getAbsences = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeCollection(
        a,
        r,
        o,
        `employees/${id.value}/absences`,
        absenceListQuerySchema,
        absenceListSchema,
        'getAbsences',
        f,
      );
};
export const postAbsence = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  f: typeof fetch = fetch,
) => {
  const id = hrTimeEmployee(e);
  return 'failure' in id
    ? id.failure
    : hrTimeMutation(
        a,
        r,
        o,
        `employees/${id.value}/absences`,
        'POST',
        createAbsenceSchema,
        absenceSchema,
        'postAbsence',
        201,
        f,
      );
};
export const patchAbsence = (
  a: BffAuth,
  r: Request,
  o: string,
  e: string,
  id: string,
  f: typeof fetch = fetch,
) => {
  const employee = hrTimeEmployee(e);
  const absence = hrTimeId(id, 'absence_not_found');
  return 'failure' in employee
    ? employee.failure
    : 'failure' in absence
      ? absence.failure
      : hrTimeMutation(
          a,
          r,
          o,
          `employees/${employee.value}/absences/${absence.value}`,
          'PATCH',
          updateAbsenceSchema,
          absenceSchema,
          'patchAbsence',
          200,
          f,
        );
};
export const getDocumentCategories = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  getHrReferences(
    a,
    r,
    o,
    'document-categories',
    documentCategoryListSchema,
    f,
  );
export const postDocumentCategory = (
  a: BffAuth,
  r: Request,
  o: string,
  f: typeof fetch = fetch,
) =>
  postHrReference(
    a,
    r,
    o,
    'document-categories',
    createDocumentCategoryRequestSchema,
    documentCategorySchema,
    f,
  );
export const patchDocumentCategory = (
  a: BffAuth,
  r: Request,
  o: string,
  id: string,
  f: typeof fetch = fetch,
) =>
  patchHrReference(
    a,
    r,
    o,
    'document-categories',
    id,
    updateDocumentCategoryRequestSchema,
    documentCategorySchema,
    f,
  );
