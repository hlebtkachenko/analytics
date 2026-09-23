import { legalEntityIdentifierSchema } from '@bap/security';
import {
  employeeSchema,
  employmentRelationshipSchema,
  employeeOpenApiSchema,
} from '../hr/contract.js';
import { z } from 'zod';

export {
  createLeaveRequestSchema,
  createTimesheetSchema,
  emptyCommandOpenApiSchema,
  emptyCommandSchema,
  leaveCancelOpenApiSchema,
  leaveCancelSchema,
  leaveRequestCreateOpenApiSchema,
  leaveRequestIdSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestOpenApiSchema,
  leaveRequestSchema,
  timesheetIdSchema,
  timesheetListQuerySchema,
  timesheetListSchema,
  timesheetOpenApiSchema,
  timesheetSchema,
  updateTimesheetOpenApiSchema,
  updateTimesheetSchema,
  type CreateLeaveRequest,
  type CreateTimesheet,
  type LeaveRequestListQuery,
  type TimesheetListQuery,
  type UpdateTimesheet,
} from '../hr-time/contract.js';

const userIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const employeeUserBindingIdSchema = z.string().uuid();
export const employeeUserBindingStatusSchema = z.enum([
  'pending',
  'active',
  'revoked',
]);
export const employeeUserBindingSchema = z
  .object({
    id: employeeUserBindingIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: z.string().uuid(),
    userId: userIdSchema,
    status: employeeUserBindingStatusSchema,
    verifiedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const createEmployeeUserBindingSchema = employeeUserBindingSchema
  .pick({ legalEntityId: true, employeeId: true, userId: true })
  .strict();
export const employeeUserBindingListSchema = z
  .object({
    items: z.array(employeeUserBindingSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const employeeUserBindingListQuerySchema = z
  .object({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    status: employeeUserBindingStatusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const myHrAccessSchema = z.union([
  z.object({ available: z.literal(false) }).strict(),
  z
    .object({
      available: z.literal(true),
      employeeId: z.string().uuid(),
      legalEntityId: legalEntityIdentifierSchema,
    })
    .strict(),
]);
const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const myHrProfileSchema = z
  .object({
    employee: employeeSchema,
    relationships: z.array(employmentRelationshipSchema),
  })
  .strict();
export const myHrDocumentSchema = z
  .object({
    documentId: z.string().uuid(),
    title: z.string(),
    documentDate: z.iso.date(),
    categoryId: z.string().uuid().nullable(),
    relationshipId: z.string().uuid().nullable(),
    approvalStatus: z.enum(['not_required', 'approved']),
    approvedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const myHrDocumentsQuerySchema = pageSchema;
export const myHrDocumentsSchema = z
  .object({
    items: z.array(myHrDocumentSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const myHrPayslipSchema = z
  .object({
    payrollRunId: z.string().uuid(),
    month: monthSchema,
    version: z.number().int().min(1),
    status: z.enum(['finalized', 'paid', 'superseded']),
    documentId: z.string().uuid(),
    finalizedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
export const myHrPayslipsQuerySchema = pageSchema
  .extend({
    fromMonth: monthSchema.optional(),
    toMonth: monthSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.fromMonth || !value.toMonth || value.fromMonth <= value.toMonth,
  );
export const myHrPayslipsSchema = z
  .object({
    items: z.array(myHrPayslipSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const myHrLeaveTypesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const bindingProperties = {
  id: { type: 'string', format: 'uuid' },
  legalEntityId: { type: 'string', format: 'uuid' },
  employeeId: { type: 'string', format: 'uuid' },
  userId: { type: 'string' },
  status: { type: 'string', enum: employeeUserBindingStatusSchema.options },
  verifiedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
} as const;
export const employeeUserBindingOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: bindingProperties,
  required: [
    'id',
    'legalEntityId',
    'employeeId',
    'userId',
    'status',
    'verifiedAt',
    'createdAt',
    'updatedAt',
  ],
} as const;
export const createEmployeeUserBindingOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    legalEntityId: bindingProperties.legalEntityId,
    employeeId: bindingProperties.employeeId,
    userId: bindingProperties.userId,
  },
  required: ['legalEntityId', 'employeeId', 'userId'],
} as const;
export const employeeUserBindingListOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: employeeUserBindingOpenApiSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
  required: ['items', 'page', 'pageSize', 'total'],
} as const;
export const myHrAccessOpenApiSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { available: { enum: [false], type: 'boolean' } },
      required: ['available'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        available: { enum: [true], type: 'boolean' },
        employeeId: bindingProperties.employeeId,
        legalEntityId: bindingProperties.legalEntityId,
      },
      required: ['available', 'employeeId', 'legalEntityId'],
    },
  ],
} as const;
export const myHrProfileOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    employee: employeeOpenApiSchema,
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid' },
          employeeId: { type: 'string', format: 'uuid' },
          kind: {
            type: 'string',
            enum: ['employment', 'dpp', 'dpc', 'executive'],
          },
          position: { type: 'string' },
          department: { type: ['string', 'null'] },
          costCentre: { type: ['string', 'null'] },
          weeklyHours: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: ['string', 'null'], format: 'date' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: [
          'id',
          'employeeId',
          'kind',
          'position',
          'department',
          'costCentre',
          'weeklyHours',
          'startDate',
          'endDate',
          'createdAt',
          'updatedAt',
        ],
      },
    },
  },
  required: ['employee', 'relationships'],
} as const;
export const myHrDocumentOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    documentDate: { type: 'string', format: 'date' },
    categoryId: { type: ['string', 'null'], format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    approvalStatus: { type: 'string', enum: ['not_required', 'approved'] },
    approvedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'documentId',
    'title',
    'documentDate',
    'categoryId',
    'relationshipId',
    'approvalStatus',
    'approvedAt',
    'createdAt',
  ],
} as const;
export const myHrDocumentsOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: myHrDocumentOpenApiSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
  required: ['items', 'page', 'pageSize', 'total'],
} as const;
export const myHrPayslipOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    payrollRunId: { type: 'string', format: 'uuid' },
    month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
    version: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['finalized', 'paid', 'superseded'] },
    documentId: { type: 'string', format: 'uuid' },
    finalizedAt: { type: ['string', 'null'], format: 'date-time' },
    paidAt: { type: ['string', 'null'], format: 'date-time' },
  },
  required: [
    'payrollRunId',
    'month',
    'version',
    'status',
    'documentId',
    'finalizedAt',
    'paidAt',
  ],
} as const;
export const myHrPayslipsOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: myHrPayslipOpenApiSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
  required: ['items', 'page', 'pageSize', 'total'],
} as const;
export type CreateEmployeeUserBinding = z.infer<
  typeof createEmployeeUserBindingSchema
>;
export type EmployeeUserBinding = z.infer<typeof employeeUserBindingSchema>;
export type MyHrProfile = z.infer<typeof myHrProfileSchema>;
export type MyHrDocument = z.infer<typeof myHrDocumentSchema>;
export type MyHrPayslip = z.infer<typeof myHrPayslipSchema>;
