import { legalEntityIdentifierSchema } from '@bap/security';
import { z } from 'zod';

import { nonNegativeDecimalStringSchema } from '../documents/contract.js';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.iso.date();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const dates = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (v) => {
      const value = v as { validFrom: string; validTo?: string | null };
      return !value.validTo || value.validFrom <= value.validTo;
    },
    {
      message: 'validTo must not precede validFrom',
    },
  );
export const componentSchema = z
  .object({
    id: uuid,
    legalEntityId: legalEntityIdentifierSchema,
    code: text(64),
    name: text(200),
    kind: z.enum(['earning', 'deduction', 'employer_contribution']),
    recurrence: z.enum(['recurring', 'one_off']),
    accountingKey: text(64),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const createComponentSchema = componentSchema
  .pick({
    legalEntityId: true,
    code: true,
    name: true,
    kind: true,
    recurrence: true,
    accountingKey: true,
  })
  .strict();
export const updateComponentSchema = componentSchema
  .pick({ name: true, active: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const compensationSchema = z
  .object({
    id: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    componentDefinitionId: uuid,
    validFrom: date,
    validTo: date.nullable(),
    amount: nonNegativeDecimalStringSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const createCompensationSchema = dates(
  compensationSchema
    .pick({
      relationshipId: true,
      componentDefinitionId: true,
      validFrom: true,
      validTo: true,
      amount: true,
      currency: true,
    })
    .extend({
      validTo: date.nullable().default(null),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default('CZK'),
    })
    .strict(),
);
export const updateCompensationSchema = dates(
  compensationSchema
    .pick({ validFrom: true, validTo: true, amount: true, currency: true })
    .extend({ validTo: date.nullable().default(null) })
    .strict(),
);
export const mappingSchema = z
  .object({
    id: uuid,
    legalEntityId: legalEntityIdentifierSchema,
    accountingKey: text(64),
    accountCode: text(16),
    side: z.enum(['debit', 'credit']),
    validFrom: date,
    validTo: date.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const createMappingSchema = dates(
  mappingSchema
    .pick({
      legalEntityId: true,
      accountingKey: true,
      accountCode: true,
      side: true,
      validFrom: true,
      validTo: true,
    })
    .extend({ validTo: date.nullable().default(null) })
    .strict(),
);
export const updateMappingSchema = dates(
  mappingSchema
    .pick({ accountCode: true, side: true, validFrom: true, validTo: true })
    .extend({ validTo: date.nullable().default(null) })
    .strict(),
);
export const componentListQuerySchema = page
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    q: text(100).optional(),
    active: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();
export const mappingListQuerySchema = page
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    accountingKey: text(64).optional(),
  })
  .strict();
export const compensationListQuerySchema = page
  .extend({ relationshipId: uuid.optional() })
  .strict();
export const listSchema = <T extends z.ZodTypeAny>(key: string, item: T) =>
  z
    .object({
      [key]: z.array(item),
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int().min(0),
    })
    .strict();
const oa = (properties: object, required: string[]) =>
  ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }) as never;
const componentProperties = {
  id: { type: 'string', format: 'uuid' },
  legalEntityId: { type: 'string', format: 'uuid' },
  code: { type: 'string' },
  name: { type: 'string' },
  kind: {
    type: 'string',
    enum: ['earning', 'deduction', 'employer_contribution'],
  },
  recurrence: { type: 'string', enum: ['recurring', 'one_off'] },
  accountingKey: { type: 'string' },
  active: { type: 'boolean' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};
export const componentOpenApiSchema = oa(
  componentProperties,
  Object.keys(componentProperties),
);
export const createComponentOpenApiSchema = oa(componentProperties, [
  'legalEntityId',
  'code',
  'name',
  'kind',
  'recurrence',
  'accountingKey',
]);
export const updateComponentOpenApiSchema = oa(
  { name: { type: 'string' }, active: { type: 'boolean' } },
  [],
);
const compensationProperties = {
  id: { type: 'string', format: 'uuid' },
  employeeId: { type: 'string', format: 'uuid' },
  relationshipId: { type: 'string', format: 'uuid' },
  componentDefinitionId: { type: 'string', format: 'uuid' },
  validFrom: { type: 'string', format: 'date' },
  validTo: { type: ['string', 'null'], format: 'date' },
  amount: { type: 'string' },
  currency: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};
export const compensationOpenApiSchema = oa(
  compensationProperties,
  Object.keys(compensationProperties),
);
export const createCompensationOpenApiSchema = oa(compensationProperties, [
  'relationshipId',
  'componentDefinitionId',
  'validFrom',
  'amount',
]);
export const updateCompensationOpenApiSchema = oa(compensationProperties, [
  'validFrom',
  'amount',
  'currency',
]);
const mappingProperties = {
  id: { type: 'string', format: 'uuid' },
  legalEntityId: { type: 'string', format: 'uuid' },
  accountingKey: { type: 'string' },
  accountCode: { type: 'string' },
  side: { type: 'string', enum: ['debit', 'credit'] },
  validFrom: { type: 'string', format: 'date' },
  validTo: { type: ['string', 'null'], format: 'date' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};
export const mappingOpenApiSchema = oa(
  mappingProperties,
  Object.keys(mappingProperties),
);
export const createMappingOpenApiSchema = oa(mappingProperties, [
  'legalEntityId',
  'accountingKey',
  'accountCode',
  'side',
  'validFrom',
]);
export const updateMappingOpenApiSchema = oa(mappingProperties, [
  'accountCode',
  'side',
  'validFrom',
]);
export const listOpenApiSchema = (key: string, item: object) =>
  oa(
    {
      [key]: { type: 'array', items: item },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      total: { type: 'integer', minimum: 0 },
    },
    [key, 'page', 'pageSize', 'total'],
  );
export type Component = z.infer<typeof componentSchema>;
export type Compensation = z.infer<typeof compensationSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type CreateComponent = z.infer<typeof createComponentSchema>;
export type UpdateComponent = z.infer<typeof updateComponentSchema>;
export type CreateCompensation = z.infer<typeof createCompensationSchema>;
export type UpdateCompensation = z.infer<typeof updateCompensationSchema>;
export type CreateMapping = z.infer<typeof createMappingSchema>;
export type UpdateMapping = z.infer<typeof updateMappingSchema>;
const payrollResultSchema = z
  .object({
    employeeId: uuid,
    grossPay: nonNegativeDecimalStringSchema,
    employeeSocial: nonNegativeDecimalStringSchema,
    employeeHealth: nonNegativeDecimalStringSchema,
    incomeTax: nonNegativeDecimalStringSchema,
    otherDeductions: nonNegativeDecimalStringSchema,
    netPay: nonNegativeDecimalStringSchema,
    employerSocial: nonNegativeDecimalStringSchema,
    employerHealth: nonNegativeDecimalStringSchema,
    totalEmployerCost: nonNegativeDecimalStringSchema,
  })
  .strict();
export const payrollRunSchema = z
  .object({
    id: uuid,
    legalEntityId: legalEntityIdentifierSchema,
    documentId: uuid.nullable(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    version: z.number().int().positive(),
    supersedesPayrollRunId: uuid.nullable(),
    status: z.enum([
      'draft',
      'validating',
      'ready_for_approval',
      'approved',
      'finalized',
      'paid',
      'superseded',
    ]),
    origin: z.enum(['imported', 'calculated']),
    validationSummary: z
      .object({
        valid: z.boolean(),
        issues: z.array(
          z
            .object({
              code: z.enum([
                'missing_results',
                'invalid_account_mapping',
                'unbalanced_accounting',
              ]),
              count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
    approvedBy: z.string().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    finalizedBy: z.string().nullable(),
    finalizedAt: z.iso.datetime().nullable(),
    paidBy: z.string().nullable(),
    paidAt: z.iso.datetime().nullable(),
    paymentReference: z.string().nullable(),
    ruleSetId: uuid.nullable(),
    createdAt: z.iso.datetime(),
    results: z.array(payrollResultSchema),
  })
  .strict();
export const payrollRunListQuerySchema = page
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const employeePayrollResultsQuerySchema = page
  .extend({ fromMonth: month.optional(), toMonth: month.optional() })
  .strict()
  .refine(
    (value) =>
      !value.fromMonth || !value.toMonth || value.fromMonth <= value.toMonth,
    { message: 'fromMonth must not follow toMonth' },
  );
export const createPayrollRunSchema = z
  .object({
    legalEntityId: legalEntityIdentifierSchema,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    results: z.array(payrollResultSchema).min(1).max(1000),
  })
  .strict();
export const emptyCommandSchema = z.object({}).strict();
export const rejectCommandSchema = z.object({ reason: text(500) }).strict();
export const paymentCommandSchema = z
  .object({ paidAt: z.iso.datetime(), paymentReference: text(200) })
  .strict();
export const correctionCommandSchema = z.object({ reason: text(500) }).strict();
export const approvalSchema = z
  .object({
    action: z.enum(['submitted', 'approved', 'rejected', 'finalized', 'paid']),
    reason: z.string().nullable(),
    actor: z.string(),
    actedAt: z.iso.datetime(),
  })
  .strict();
export const liabilitySchema = z
  .object({
    kind: z.enum(['net_wages', 'social', 'health', 'income_tax', 'other']),
    creditorReference: z.string().nullable(),
    amount: nonNegativeDecimalStringSchema,
    dueOn: date,
    status: z.enum(['open', 'paid']),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
export const employeePayrollResultSchema = z
  .object({
    payrollRunId: uuid,
    legalEntityId: legalEntityIdentifierSchema,
    month,
    version: z.number().int().positive(),
    supersedesPayrollRunId: uuid.nullable(),
    status: z.enum([
      'draft',
      'validating',
      'ready_for_approval',
      'approved',
      'finalized',
      'paid',
      'superseded',
    ]),
    origin: z.enum(['imported', 'calculated']),
    grossPay: nonNegativeDecimalStringSchema,
    employeeSocial: nonNegativeDecimalStringSchema,
    employeeHealth: nonNegativeDecimalStringSchema,
    incomeTax: nonNegativeDecimalStringSchema,
    otherDeductions: nonNegativeDecimalStringSchema,
    netPay: nonNegativeDecimalStringSchema,
    employerSocial: nonNegativeDecimalStringSchema,
    employerHealth: nonNegativeDecimalStringSchema,
    totalEmployerCost: nonNegativeDecimalStringSchema,
    payslipDocumentId: uuid.nullable(),
    finalizedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
const payrollResultProperties = {
  employeeId: { type: 'string', format: 'uuid' },
  grossPay: { type: 'string' },
  employeeSocial: { type: 'string' },
  employeeHealth: { type: 'string' },
  incomeTax: { type: 'string' },
  otherDeductions: { type: 'string' },
  netPay: { type: 'string' },
  employerSocial: { type: 'string' },
  employerHealth: { type: 'string' },
  totalEmployerCost: { type: 'string' },
};
export const payrollResultOpenApiSchema = oa(
  payrollResultProperties,
  Object.keys(payrollResultProperties),
);
const validationIssueOpenApiSchema = oa(
  {
    code: {
      type: 'string',
      enum: [
        'missing_results',
        'invalid_account_mapping',
        'unbalanced_accounting',
      ],
    },
    count: { type: 'integer', minimum: 0 },
  },
  ['code', 'count'],
);
const payrollRunProperties = {
  id: { type: 'string', format: 'uuid' },
  legalEntityId: { type: 'string', format: 'uuid' },
  documentId: { type: ['string', 'null'], format: 'uuid' },
  month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
  version: { type: 'integer', minimum: 1 },
  supersedesPayrollRunId: { type: ['string', 'null'], format: 'uuid' },
  status: {
    type: 'string',
    enum: [
      'draft',
      'validating',
      'ready_for_approval',
      'approved',
      'finalized',
      'paid',
      'superseded',
    ],
  },
  origin: { type: 'string', enum: ['imported', 'calculated'] },
  validationSummary: oa(
    {
      valid: { type: 'boolean' },
      issues: { type: 'array', items: validationIssueOpenApiSchema },
    },
    ['valid', 'issues'],
  ),
  approvedBy: { type: ['string', 'null'] },
  approvedAt: { type: ['string', 'null'], format: 'date-time' },
  finalizedBy: { type: ['string', 'null'] },
  finalizedAt: { type: ['string', 'null'], format: 'date-time' },
  paidBy: { type: ['string', 'null'] },
  paidAt: { type: ['string', 'null'], format: 'date-time' },
  paymentReference: { type: ['string', 'null'] },
  ruleSetId: { type: ['string', 'null'], format: 'uuid' },
  createdAt: { type: 'string', format: 'date-time' },
  results: { type: 'array', items: payrollResultOpenApiSchema },
};
export const payrollRunOpenApiSchema = oa(
  payrollRunProperties,
  Object.keys(payrollRunProperties),
);
export const createPayrollRunOpenApiSchema = oa(
  {
    legalEntityId: { type: 'string', format: 'uuid' },
    month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
    results: {
      type: 'array',
      items: payrollResultOpenApiSchema,
      minItems: 1,
      maxItems: 1000,
    },
  },
  ['legalEntityId', 'month', 'results'],
);
export const payrollRunListOpenApiSchema = listOpenApiSchema(
  'payrollRuns',
  payrollRunOpenApiSchema,
);
export const emptyCommandOpenApiSchema = oa({}, []);
export const rejectCommandOpenApiSchema = oa(
  { reason: { type: 'string', minLength: 1, maxLength: 500 } },
  ['reason'],
);
export const paymentCommandOpenApiSchema = oa(
  {
    paidAt: { type: 'string', format: 'date-time' },
    paymentReference: { type: 'string', minLength: 1, maxLength: 200 },
  },
  ['paidAt', 'paymentReference'],
);
export const correctionCommandOpenApiSchema = rejectCommandOpenApiSchema;
export const approvalOpenApiSchema = oa(
  {
    action: {
      type: 'string',
      enum: ['submitted', 'approved', 'rejected', 'finalized', 'paid'],
    },
    reason: { type: ['string', 'null'] },
    actor: { type: 'string' },
    actedAt: { type: 'string', format: 'date-time' },
  },
  ['action', 'reason', 'actor', 'actedAt'],
);
export const approvalsOpenApiSchema = oa(
  { approvals: { type: 'array', items: approvalOpenApiSchema } },
  ['approvals'],
);
export const liabilityOpenApiSchema = oa(
  {
    kind: {
      type: 'string',
      enum: ['net_wages', 'social', 'health', 'income_tax', 'other'],
    },
    creditorReference: { type: ['string', 'null'] },
    amount: { type: 'string' },
    dueOn: { type: 'string', format: 'date' },
    status: { type: 'string', enum: ['open', 'paid'] },
    paidAt: { type: ['string', 'null'], format: 'date-time' },
  },
  ['kind', 'creditorReference', 'amount', 'dueOn', 'status', 'paidAt'],
);
export const liabilitiesOpenApiSchema = oa(
  { liabilities: { type: 'array', items: liabilityOpenApiSchema } },
  ['liabilities'],
);
const employeePayrollResultProperties = {
  payrollRunId: { type: 'string', format: 'uuid' },
  legalEntityId: { type: 'string', format: 'uuid' },
  month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
  version: { type: 'integer', minimum: 1 },
  supersedesPayrollRunId: { type: ['string', 'null'], format: 'uuid' },
  status: payrollRunProperties.status,
  origin: payrollRunProperties.origin,
  grossPay: { type: 'string' },
  employeeSocial: { type: 'string' },
  employeeHealth: { type: 'string' },
  incomeTax: { type: 'string' },
  otherDeductions: { type: 'string' },
  netPay: { type: 'string' },
  employerSocial: { type: 'string' },
  employerHealth: { type: 'string' },
  totalEmployerCost: { type: 'string' },
  payslipDocumentId: { type: ['string', 'null'], format: 'uuid' },
  finalizedAt: { type: ['string', 'null'], format: 'date-time' },
  paidAt: { type: ['string', 'null'], format: 'date-time' },
};
export const employeePayrollResultOpenApiSchema = oa(
  employeePayrollResultProperties,
  Object.keys(employeePayrollResultProperties),
);
export const employeePayrollResultsOpenApiSchema = listOpenApiSchema(
  'payrollResults',
  employeePayrollResultOpenApiSchema,
);
export type PayrollRun = z.infer<typeof payrollRunSchema>;
export type CreatePayrollRun = z.infer<typeof createPayrollRunSchema>;
export type EmployeePayrollResultsQuery = z.infer<
  typeof employeePayrollResultsQuerySchema
>;
export type EmployeePayrollResult = z.infer<typeof employeePayrollResultSchema>;
export type ComponentListQuery = z.infer<typeof componentListQuerySchema>;
export type MappingListQuery = z.infer<typeof mappingListQuerySchema>;
