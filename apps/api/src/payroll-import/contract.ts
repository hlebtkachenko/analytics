import { z } from 'zod';

import { organizationIdentifierSchema } from '@bap/security';
import { subjectIdentifierSchema } from '../worker/job-context.js';

export const PAYROLL_IMPORT_QUEUE = 'validate_payroll_import';
export const MAX_PAYROLL_IMPORT_BYTES = 5_000_000;
export const payrollImportIdSchema = z.string().uuid();
export const payrollImportJobSchema = z
  .object({
    organizationId: organizationIdentifierSchema,
    payrollImportId: payrollImportIdSchema,
    userId: subjectIdentifierSchema,
  })
  .strict();
export type PayrollImportJob = z.infer<typeof payrollImportJobSchema>;
export const payrollImportErrorSchema = z
  .object({
    row: z.number().int().positive(),
    field: z.string(),
    code: z.enum([
      'malformed_file',
      'invalid_header',
      'row_limit_exceeded',
      'required',
      'invalid_employee_number',
      'employee_not_found',
      'duplicate_employee',
      'invalid_amount',
      'arithmetic_mismatch',
      'component_not_found',
    ]),
  })
  .strict();
export type PayrollImportError = z.infer<typeof payrollImportErrorSchema>;
export const payrollImportSchema = z
  .object({
    id: payrollImportIdSchema,
    legalEntityId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    payrollMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
    format: z.enum(['csv', 'xlsx']),
    status: z.enum(['staged', 'validated', 'failed', 'consumed']),
    rowCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    errorReport: z.array(payrollImportErrorSchema),
    payrollRunId: z.string().uuid().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type PayrollImport = z.infer<typeof payrollImportSchema>;
