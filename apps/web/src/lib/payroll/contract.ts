import { z } from 'zod';

// Mirrors apps/api payroll-import contract, which apps/web must not import.
export const payrollImportIdSchema = z.string().trim().toLowerCase().uuid();
export const payrollImportErrorSchema = z
  .object({
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
    field: z.string(),
    row: z.number().int().min(1),
  })
  .strict();
export const payrollImportSchema = z
  .object({
    createdAt: z.iso.datetime(),
    errorCount: z.number().int().min(0),
    errorReport: z.array(payrollImportErrorSchema).max(1000),
    format: z.enum(['csv', 'xlsx']),
    id: payrollImportIdSchema,
    legalEntityId: payrollImportIdSchema,
    payrollMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
    payrollRunId: payrollImportIdSchema.nullable(),
    rowCount: z.number().int().min(0),
    sourceDocumentId: payrollImportIdSchema,
    status: z.enum(['staged', 'validated', 'failed', 'consumed']),
  })
  .strict();
export const payrollImportResponseSchema = z
  .object({ payrollImport: payrollImportSchema })
  .strict();
export const payrollImportConsumeResponseSchema = z
  .object({ payrollRunId: payrollImportIdSchema, status: z.literal('draft') })
  .strict();

const payrollMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const decimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/);
export const payrollResultSchema = z
  .object({
    employeeId: payrollImportIdSchema,
    grossPay: decimalSchema,
    employeeSocial: decimalSchema,
    employeeHealth: decimalSchema,
    incomeTax: decimalSchema,
    otherDeductions: decimalSchema,
    netPay: decimalSchema,
    employerSocial: decimalSchema,
    employerHealth: decimalSchema,
    totalEmployerCost: decimalSchema,
  })
  .strict();
export const payrollValidationIssueSchema = z
  .object({
    code: z.enum([
      'missing_results',
      'invalid_account_mapping',
      'unbalanced_accounting',
    ]),
    count: z.number().int().min(1),
  })
  .strict();
export const payrollRunSchema = z
  .object({
    id: payrollImportIdSchema,
    legalEntityId: payrollImportIdSchema,
    documentId: payrollImportIdSchema.nullable(),
    month: payrollMonthSchema,
    version: z.number().int().min(1),
    supersedesPayrollRunId: payrollImportIdSchema.nullable(),
    status: z.enum([
      'draft',
      'validating',
      'ready_for_approval',
      'approved',
      'finalized',
      'paid',
      'superseded',
    ]),
    origin: z.enum(['calculated', 'imported']),
    validationSummary: z
      .object({
        valid: z.boolean(),
        issues: z.array(payrollValidationIssueSchema),
      })
      .strict(),
    approvedBy: z.string().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    finalizedBy: z.string().nullable(),
    finalizedAt: z.iso.datetime().nullable(),
    paidBy: z.string().nullable(),
    paidAt: z.iso.datetime().nullable(),
    paymentReference: z.string().nullable(),
    ruleSetId: payrollImportIdSchema.nullable(),
    createdAt: z.iso.datetime(),
    results: z.array(payrollResultSchema),
  })
  .strict();
export const payrollRunListSchema = z
  .object({
    payrollRuns: z.array(payrollRunSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const payrollRunListQuerySchema = z
  .object({
    legalEntityId: payrollImportIdSchema.optional(),
    month: payrollMonthSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
// Mirrors apps/api payroll contract, which apps/web must not import.
export const employeePayrollResultQuerySchema = z
  .object({
    fromMonth: payrollMonthSchema.optional(),
    toMonth: payrollMonthSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (query) =>
      query.fromMonth === undefined ||
      query.toMonth === undefined ||
      query.fromMonth <= query.toMonth,
  );
export const employeePayrollResultSchema = z
  .object({
    payrollRunId: payrollImportIdSchema,
    legalEntityId: payrollImportIdSchema,
    month: payrollMonthSchema,
    version: z.number().int().min(1),
    supersedesPayrollRunId: payrollImportIdSchema.nullable(),
    status: payrollRunSchema.shape.status,
    origin: payrollRunSchema.shape.origin,
    grossPay: decimalSchema,
    employeeSocial: decimalSchema,
    employeeHealth: decimalSchema,
    incomeTax: decimalSchema,
    otherDeductions: decimalSchema,
    netPay: decimalSchema,
    employerSocial: decimalSchema,
    employerHealth: decimalSchema,
    totalEmployerCost: decimalSchema,
    payslipDocumentId: payrollImportIdSchema.nullable(),
    finalizedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
export const employeePayrollResultListSchema = z
  .object({
    payrollResults: z.array(employeePayrollResultSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const createPayrollRunSchema = z
  .object({
    legalEntityId: payrollImportIdSchema,
    month: payrollMonthSchema,
    results: z.array(payrollResultSchema).min(1).max(1000),
  })
  .strict();
export const payrollCommandSchema = z.object({}).strict();
export const rejectPayrollRunSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export const recordPayrollPaymentSchema = z
  .object({
    paidAt: z.iso.datetime(),
    paymentReference: z.string().trim().min(1).max(200),
  })
  .strict();
export const correctPayrollRunSchema = rejectPayrollRunSchema;
export const payrollApprovalSchema = z
  .object({
    action: z.enum(['submitted', 'approved', 'rejected', 'finalized', 'paid']),
    reason: z.string().nullable(),
    actor: z.string(),
    actedAt: z.iso.datetime(),
  })
  .strict();
export const payrollApprovalsSchema = z
  .object({ approvals: z.array(payrollApprovalSchema) })
  .strict();
export const payrollLiabilitySchema = z
  .object({
    kind: z.enum(['net_wages', 'social', 'health', 'income_tax', 'other']),
    creditorReference: z.string().nullable(),
    amount: decimalSchema,
    dueOn: z.iso.date(),
    status: z.enum(['open', 'paid']),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
export const payrollLiabilitiesSchema = z
  .object({ liabilities: z.array(payrollLiabilitySchema) })
  .strict();
