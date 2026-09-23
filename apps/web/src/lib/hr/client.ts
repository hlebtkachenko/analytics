import type { z } from 'zod';
import { organizationPath } from '../datasets/client';

export class HrRequestError extends Error {
  constructor(readonly status: number) {
    super('Request failed.');
  }
}
export function withOrganization(path: string, slug: string) {
  return slug.length === 0
    ? path
    : `${path}?organization=${encodeURIComponent(slug)}`;
}
export function employeesPath(organizationId: string, query?: URLSearchParams) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/employees${q ? `?${q}` : ''}`;
}
export function hrAccessAssignmentsPath(organizationId: string) {
  return `${organizationPath(organizationId)}/hr/access-assignments`;
}
export function hrAccessAssignmentPath(
  organizationId: string,
  assignmentId: string,
) {
  return `${hrAccessAssignmentsPath(organizationId)}/${encodeURIComponent(assignmentId)}`;
}
export function employeePath(organizationId: string, employeeId: string) {
  return `${employeesPath(organizationId)}/${encodeURIComponent(employeeId)}`;
}
export function employeeRelationshipsPath(
  organizationId: string,
  employeeId: string,
) {
  return `${employeePath(organizationId, employeeId)}/relationships`;
}
export function employeeRelationshipPath(
  organizationId: string,
  employeeId: string,
  relationshipId: string,
) {
  return `${employeeRelationshipsPath(organizationId, employeeId)}/${encodeURIComponent(relationshipId)}`;
}
export function employeeDocumentsPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${employeePath(organizationId, employeeId)}/documents${q ? `?${q}` : ''}`;
}
export function employeeDocumentPath(
  organizationId: string,
  employeeId: string,
  documentId: string,
) {
  return `${employeeDocumentsPath(organizationId, employeeId)}/${encodeURIComponent(documentId)}`;
}
export function employmentTermsPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${employeePath(organizationId, employeeId)}/employment-terms${q ? `?${q}` : ''}`;
}
export function employeeStatusHistoryPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${employeePath(organizationId, employeeId)}/status-history${q ? `?${q}` : ''}`;
}
export function employeeStatusTransitionsPath(
  organizationId: string,
  employeeId: string,
) {
  return `${employeePath(organizationId, employeeId)}/status-transitions`;
}
export { payrollRunPath, payrollRunsPath } from '../payroll/client';
export function payrollComponentsPath(
  organizationId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/payroll/components${q ? `?${q}` : ''}`;
}
export function payrollComponentPath(organizationId: string, id: string) {
  return `${payrollComponentsPath(organizationId)}/${encodeURIComponent(id)}`;
}
export function employeeCompensationComponentsPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${employeePath(organizationId, employeeId)}/compensation-components${q ? `?${q}` : ''}`;
}
export function employeeCompensationComponentPath(
  organizationId: string,
  employeeId: string,
  id: string,
) {
  return `${employeeCompensationComponentsPath(organizationId, employeeId)}/${encodeURIComponent(id)}`;
}
export function payrollAccountMappingsPath(
  organizationId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/payroll/account-mappings${q ? `?${q}` : ''}`;
}
export function payrollAccountMappingPath(organizationId: string, id: string) {
  return `${payrollAccountMappingsPath(organizationId)}/${encodeURIComponent(id)}`;
}
export async function sendHrJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new HrRequestError(response.status);
  return schema.parse(await response.json());
}

type HrReferenceCollection =
  | 'departments'
  | 'positions'
  | 'cost-centres'
  | 'workplaces'
  | 'document-categories';
export function hrReferencesPath(
  organizationId: string,
  collection: HrReferenceCollection,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/hr/${collection}${q ? `?${q}` : ''}`;
}
export function hrReferencePath(
  organizationId: string,
  collection: HrReferenceCollection,
  id: string,
) {
  return `${hrReferencesPath(organizationId, collection)}/${encodeURIComponent(id)}`;
}
export function checklistTemplatesPath(
  organizationId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/hr/checklist-templates${q ? `?${q}` : ''}`;
}
export function checklistTemplatePath(
  organizationId: string,
  templateId: string,
) {
  return `${checklistTemplatesPath(organizationId)}/${encodeURIComponent(templateId)}`;
}
export function checklistTemplateItemsPath(
  organizationId: string,
  templateId: string,
) {
  return `${checklistTemplatePath(organizationId, templateId)}/items`;
}
export function checklistTemplateItemPath(
  organizationId: string,
  templateId: string,
  itemId: string,
) {
  return `${checklistTemplateItemsPath(organizationId, templateId)}/${encodeURIComponent(itemId)}`;
}
export function employeeChecklistsPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${employeePath(organizationId, employeeId)}/checklists${q ? `?${q}` : ''}`;
}
export function checklistTaskPath(
  organizationId: string,
  employeeId: string,
  checklistId: string,
  taskId: string,
) {
  return `${employeeChecklistsPath(organizationId, employeeId)}/${encodeURIComponent(checklistId)}/tasks/${encodeURIComponent(taskId)}`;
}
