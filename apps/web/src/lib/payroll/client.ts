import type { z } from 'zod';

import { organizationPath } from '../datasets/client';

const payrollMonth = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const payrollFile = /\.(csv|xlsx)$/i;
const maxPayrollImportBytes = 5_000_000;

export class PayrollImportRequestError extends Error {
  constructor(readonly status: number) {
    super('Request failed.');
  }
}

export function payrollImportsPath(organizationId: string) {
  return `${organizationPath(organizationId)}/payroll/imports`;
}
export function payrollImportPath(organizationId: string, importId: string) {
  return `${payrollImportsPath(organizationId)}/${encodeURIComponent(importId)}`;
}
export function payrollImportConsumePath(
  organizationId: string,
  importId: string,
) {
  return `${payrollImportPath(organizationId, importId)}/consume`;
}
export function payrollRunsPath(
  organizationId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/payroll-runs${q ? `?${q}` : ''}`;
}
export function employeePayrollResultsPath(
  organizationId: string,
  employeeId: string,
  query?: URLSearchParams,
) {
  const q = query?.toString();
  return `${organizationPath(organizationId)}/employees/${encodeURIComponent(employeeId)}/payroll-results${q ? `?${q}` : ''}`;
}
export function payrollRunPath(organizationId: string, payrollRunId: string) {
  return `${payrollRunsPath(organizationId)}/${encodeURIComponent(payrollRunId)}`;
}
export function payrollRunCommandPath(
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
) {
  return `${payrollRunPath(organizationId, payrollRunId)}/${command}`;
}
export function payrollRunApprovalsPath(
  organizationId: string,
  payrollRunId: string,
) {
  return `${payrollRunPath(organizationId, payrollRunId)}/approvals`;
}
export function payrollRunLiabilitiesPath(
  organizationId: string,
  payrollRunId: string,
) {
  return `${payrollRunPath(organizationId, payrollRunId)}/liabilities`;
}
export async function postPayrollJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  idempotencyKey = crypto.randomUUID(),
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    method: 'POST',
  });
  if (!response.ok) throw new PayrollImportRequestError(response.status);
  return schema.parse(await response.json());
}
export function isValidPayrollImportInput(
  file: File | undefined,
  legalEntityId: string,
  month: string,
) {
  return (
    file !== undefined &&
    file.size > 0 &&
    file.size <= maxPayrollImportBytes &&
    payrollFile.test(file.name) &&
    legalEntityId.length > 0 &&
    payrollMonth.test(month)
  );
}
export async function postPayrollImport<T>(
  path: string,
  body: FormData,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    body,
    cache: 'no-store',
    headers: { 'idempotency-key': crypto.randomUUID() },
    method: 'POST',
  });
  if (!response.ok) throw new PayrollImportRequestError(response.status);
  return schema.parse(await response.json());
}
export async function postPayrollImportConsume<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', method: 'POST' });
  if (!response.ok) throw new PayrollImportRequestError(response.status);
  return schema.parse(await response.json());
}
