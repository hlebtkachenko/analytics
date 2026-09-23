import { hrAccessRoleSchema, legalEntityIdentifierSchema } from '@bap/security';
import { z } from 'zod';

export const employeeIdSchema = z.string().uuid();
export const hrAccessAssignmentIdSchema = z.string().uuid();
export const hrAccessAssignmentSchema = z
  .object({
    accessRole: hrAccessRoleSchema,
    id: hrAccessAssignmentIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    userId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const createHrAccessAssignmentRequestSchema = hrAccessAssignmentSchema
  .pick({ accessRole: true, legalEntityId: true, userId: true })
  .strict();
export const hrAccessAssignmentListSchema = z
  .object({ assignments: z.array(hrAccessAssignmentSchema) })
  .strict();
export const hrAccessAssignmentOpenApiSchema = {
  additionalProperties: false,
  properties: {
    accessRole: { enum: hrAccessRoleSchema.options, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    legalEntityId: { format: 'uuid', type: 'string' },
    userId: { type: 'string' },
  },
  required: ['id', 'legalEntityId', 'userId', 'accessRole', 'createdAt'],
  type: 'object',
} as const;
export const createHrAccessAssignmentRequestOpenApiSchema = {
  additionalProperties: false,
  properties: {
    accessRole: { enum: hrAccessRoleSchema.options, type: 'string' },
    legalEntityId: { format: 'uuid', type: 'string' },
    userId: { maxLength: 128, minLength: 1, type: 'string' },
  },
  required: ['legalEntityId', 'userId', 'accessRole'],
  type: 'object',
} as const;
export const hrAccessAssignmentListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    assignments: { items: hrAccessAssignmentOpenApiSchema, type: 'array' },
  },
  required: ['assignments'],
  type: 'object',
} as const;
export const revokeHrAccessAssignmentResponseSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export const revokeHrAccessAssignmentResponseOpenApiSchema = {
  additionalProperties: false,
  properties: { revoked: { enum: [true], type: 'boolean' } },
  required: ['revoked'],
  type: 'object',
} as const;
export type HrAccessAssignment = z.infer<typeof hrAccessAssignmentSchema>;
export type CreateHrAccessAssignmentRequest = z.infer<
  typeof createHrAccessAssignmentRequestSchema
>;
export const dateSchema = z.iso.date();
const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const employeeStatusSchema = z.enum([
  'preboarding',
  'active',
  'inactive',
  'archived',
  'cancelled',
]);
export const employmentKindSchema = z.enum([
  'employment',
  'dpp',
  'dpc',
  'executive',
]);
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const hrReferenceIdSchema = z.string().uuid();
export const hrReferenceListQuerySchema = pageSchema
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();
const hrReferenceBaseSchema = z
  .object({
    id: hrReferenceIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    code: shortText(64),
    name: shortText(200),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const departmentSchema = hrReferenceBaseSchema
  .extend({
    parentId: hrReferenceIdSchema.nullable(),
  })
  .strict();
export const positionSchema = hrReferenceBaseSchema;
export const costCentreSchema = hrReferenceBaseSchema;
export const workplaceSchema = hrReferenceBaseSchema
  .extend({
    addressLabel: shortText(300).nullable(),
  })
  .strict();
export const documentCategorySchema = hrReferenceBaseSchema
  .extend({
    confidentiality: z.literal('operational'),
    retentionKey: shortText(64),
    requiresApproval: z.boolean(),
  })
  .strict();
const referenceCreate = <T extends z.ZodObject>(schema: T) =>
  schema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    active: true,
  });
const referenceUpdate = <T extends z.ZodObject>(schema: T) =>
  schema
    .omit({
      id: true,
      legalEntityId: true,
      code: true,
      createdAt: true,
      updatedAt: true,
    })
    .partial()
    .refine((value) => Object.keys(value).length > 0);
export const createDepartmentRequestSchema = referenceCreate(
  departmentSchema,
).extend({
  parentId: hrReferenceIdSchema.nullable().default(null),
});
export const updateDepartmentRequestSchema = referenceUpdate(departmentSchema);
export const createPositionRequestSchema = referenceCreate(positionSchema);
export const updatePositionRequestSchema = referenceUpdate(positionSchema);
export const createCostCentreRequestSchema = referenceCreate(costCentreSchema);
export const updateCostCentreRequestSchema = referenceUpdate(costCentreSchema);
export const createWorkplaceRequestSchema = referenceCreate(
  workplaceSchema,
).extend({
  addressLabel: shortText(300).nullable().default(null),
});
export const updateWorkplaceRequestSchema = referenceUpdate(workplaceSchema);
export const createDocumentCategoryRequestSchema = referenceCreate(
  documentCategorySchema,
);
export const updateDocumentCategoryRequestSchema = documentCategorySchema
  .omit({
    id: true,
    legalEntityId: true,
    code: true,
    confidentiality: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const referenceListResponseSchema = <T extends z.ZodType>(
  key: string,
  item: T,
) =>
  z
    .object({
      [key]: z.array(item),
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int().min(0),
    })
    .strict();
const referenceOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'legalEntityId',
    'code',
    'name',
    'active',
    'createdAt',
    'updatedAt',
  ],
};
export const departmentOpenApiSchema = {
  ...referenceOpenApiSchema,
  properties: {
    ...referenceOpenApiSchema.properties,
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
  required: [...referenceOpenApiSchema.required, 'parentId'],
};
export const positionOpenApiSchema = referenceOpenApiSchema;
export const costCentreOpenApiSchema = referenceOpenApiSchema;
export const workplaceOpenApiSchema = {
  ...referenceOpenApiSchema,
  properties: {
    ...referenceOpenApiSchema.properties,
    addressLabel: { type: ['string', 'null'] },
  },
  required: [...referenceOpenApiSchema.required, 'addressLabel'],
};
export const documentCategoryOpenApiSchema = {
  ...referenceOpenApiSchema,
  properties: {
    ...referenceOpenApiSchema.properties,
    confidentiality: { type: 'string', enum: ['operational'] },
    retentionKey: { type: 'string' },
    requiresApproval: { type: 'boolean' },
  },
  required: [
    ...referenceOpenApiSchema.required,
    'confidentiality',
    'retentionKey',
    'requiresApproval',
  ],
};
export const referenceListOpenApiSchema = (key: string, item: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    [key]: { type: 'array', items: item },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    total: { type: 'integer', minimum: 0 },
  },
  required: [key, 'page', 'pageSize', 'total'],
});
const commonReferenceRequestProperties = {
  legalEntityId: { type: 'string', format: 'uuid' },
  code: { type: 'string', minLength: 1, maxLength: 64 },
  name: { type: 'string', minLength: 1, maxLength: 200 },
};
const commonReferencePatchProperties = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  active: { type: 'boolean' },
};
const strictOpenApi = (properties: object, required: string[]) =>
  ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }) as never;
export const createDepartmentRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferenceRequestProperties,
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
  ['legalEntityId', 'code', 'name'],
);
export const updateDepartmentRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferencePatchProperties,
    parentId: { type: ['string', 'null'], format: 'uuid' },
  },
  [],
);
export const createPositionRequestOpenApiSchema = strictOpenApi(
  commonReferenceRequestProperties,
  ['legalEntityId', 'code', 'name'],
);
export const updatePositionRequestOpenApiSchema = strictOpenApi(
  commonReferencePatchProperties,
  [],
);
export const createCostCentreRequestOpenApiSchema = strictOpenApi(
  commonReferenceRequestProperties,
  ['legalEntityId', 'code', 'name'],
);
export const updateCostCentreRequestOpenApiSchema = strictOpenApi(
  commonReferencePatchProperties,
  [],
);
export const createWorkplaceRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferenceRequestProperties,
    addressLabel: { type: ['string', 'null'], maxLength: 300 },
  },
  ['legalEntityId', 'code', 'name'],
);
export const updateWorkplaceRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferencePatchProperties,
    addressLabel: { type: ['string', 'null'], maxLength: 300 },
  },
  [],
);
export const createDocumentCategoryRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferenceRequestProperties,
    retentionKey: { type: 'string', minLength: 1, maxLength: 64 },
    requiresApproval: { type: 'boolean' },
    confidentiality: { type: 'string', enum: ['operational'] },
  },
  [
    'legalEntityId',
    'code',
    'name',
    'retentionKey',
    'requiresApproval',
    'confidentiality',
  ],
);
export const updateDocumentCategoryRequestOpenApiSchema = strictOpenApi(
  {
    ...commonReferencePatchProperties,
    retentionKey: { type: 'string', minLength: 1, maxLength: 64 },
    requiresApproval: { type: 'boolean' },
  },
  [],
);
export type HrReferenceListQuery = z.infer<typeof hrReferenceListQuerySchema>;
export type Department = z.infer<typeof departmentSchema>;
export type Position = z.infer<typeof positionSchema>;
export type CostCentre = z.infer<typeof costCentreSchema>;
export type Workplace = z.infer<typeof workplaceSchema>;
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
export type CreateDepartmentRequest = z.infer<
  typeof createDepartmentRequestSchema
>;
export type UpdateDepartmentRequest = z.infer<
  typeof updateDepartmentRequestSchema
>;
export type CreatePositionRequest = z.infer<typeof createPositionRequestSchema>;
export type UpdatePositionRequest = z.infer<typeof updatePositionRequestSchema>;
export type CreateCostCentreRequest = z.infer<
  typeof createCostCentreRequestSchema
>;
export type UpdateCostCentreRequest = z.infer<
  typeof updateCostCentreRequestSchema
>;
export type CreateWorkplaceRequest = z.infer<
  typeof createWorkplaceRequestSchema
>;
export type UpdateWorkplaceRequest = z.infer<
  typeof updateWorkplaceRequestSchema
>;
export type CreateDocumentCategoryRequest = z.infer<
  typeof createDocumentCategoryRequestSchema
>;
export type UpdateDocumentCategoryRequest = z.infer<
  typeof updateDocumentCategoryRequestSchema
>;

export const employeeSchema = z
  .object({
    id: employeeIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeNumber: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    firstName: shortText(100),
    lastName: shortText(100),
    workEmail: z.string().email().nullable(),
    workPhone: z.string().max(64).nullable(),
    status: employeeStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const createEmployeeRequestSchema = employeeSchema
  .pick({
    legalEntityId: true,
    employeeNumber: true,
    firstName: true,
    lastName: true,
    workEmail: true,
    workPhone: true,
  })
  .extend({
    workEmail: z.string().email().nullable().default(null),
    workPhone: z.string().max(64).nullable().default(null),
  });
export const updateEmployeeRequestSchema = createEmployeeRequestSchema
  .omit({ legalEntityId: true, employeeNumber: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const employeeListQuerySchema = pageSchema
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    status: employeeStatusSchema.optional(),
  })
  .strict();
export const employmentRelationshipSchema = z
  .object({
    id: z.string().uuid(),
    employeeId: employeeIdSchema,
    kind: employmentKindSchema,
    position: shortText(200),
    department: z.string().max(200).nullable(),
    costCentre: z.string().max(64).nullable(),
    weeklyHours: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const employmentRelationshipRequestShape = employmentRelationshipSchema.omit({
  id: true,
  employeeId: true,
  createdAt: true,
  updatedAt: true,
});
export const createEmploymentRelationshipRequestSchema =
  employmentRelationshipRequestShape.refine(
    (v) => v.endDate === null || v.startDate <= v.endDate,
    {
      message: 'End date must not precede start date.',
    },
  );
export const employeeDocumentSchema = z
  .object({
    documentId: z.string().uuid(),
    title: z.string(),
    documentDate: dateSchema,
    categoryId: hrReferenceIdSchema.nullable(),
    relationshipId: hrReferenceIdSchema.nullable(),
    approvalStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']),
    approvedBy: z.string().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    supersedesDocumentId: z.string().uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const employeeListResponseSchema = z
  .object({
    employees: z.array(employeeSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const employeeDetailSchema = employeeSchema
  .extend({
    relationships: z.array(employmentRelationshipSchema),
    documents: z.array(employeeDocumentSchema),
  })
  .strict();
export const relationshipListResponseSchema = z
  .object({ relationships: z.array(employmentRelationshipSchema) })
  .strict();
export const employeeDocumentListResponseSchema = z
  .object({
    items: z.array(employeeDocumentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const employeeDocumentLinkResponseSchema = employeeDocumentSchema;
export const employeeDocumentOpenApiSchema = strictOpenApi(
  {
    documentId: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    documentDate: { type: 'string', format: 'date' },
    categoryId: { type: ['string', 'null'], format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending', 'approved', 'rejected'],
    },
    approvedBy: { type: ['string', 'null'] },
    approvedAt: { type: ['string', 'null'], format: 'date-time' },
    supersedesDocumentId: { type: ['string', 'null'], format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  [
    'documentId',
    'title',
    'documentDate',
    'categoryId',
    'relationshipId',
    'approvalStatus',
    'approvedBy',
    'approvedAt',
    'supersedesDocumentId',
    'createdAt',
  ],
);
export const linkEmployeeDocumentRequestOpenApiSchema = strictOpenApi(
  {
    documentId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    supersedesDocumentId: { type: ['string', 'null'], format: 'uuid' },
  },
  ['documentId', 'categoryId'],
);
export const updateEmployeeDocumentRequestOpenApiSchema = strictOpenApi(
  {
    categoryId: { type: 'string', format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    supersedesDocumentId: { type: ['string', 'null'], format: 'uuid' },
    approvalDecision: { type: 'string', enum: ['approved', 'rejected'] },
  },
  [],
);
export const employeeDocumentListQuerySchema = pageSchema
  .extend({
    categoryId: hrReferenceIdSchema.optional(),
    approvalStatus: z
      .enum(['not_required', 'pending', 'approved', 'rejected'])
      .optional(),
    currentOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
  })
  .strict();
export const linkEmployeeDocumentRequestSchema = z
  .object({
    documentId: z.string().uuid(),
    categoryId: hrReferenceIdSchema,
    relationshipId: hrReferenceIdSchema.nullable().default(null),
    supersedesDocumentId: z.string().uuid().nullable().default(null),
  })
  .strict();
export const updateEmployeeDocumentRequestSchema = z
  .object({
    categoryId: hrReferenceIdSchema.optional(),
    relationshipId: hrReferenceIdSchema.nullable().optional(),
    supersedesDocumentId: z.string().uuid().nullable().optional(),
    approvalDecision: z.enum(['approved', 'rejected']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const employmentTermListQuerySchema = pageSchema
  .extend({
    relationshipId: hrReferenceIdSchema.optional(),
    effectiveOn: dateSchema.optional(),
  })
  .strict();
const weeklyHoursSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0 && Number(value) <= 168);
const employmentTermBaseSchema = z
  .object({
    id: z.string().uuid(),
    employeeId: employeeIdSchema,
    relationshipId: hrReferenceIdSchema,
    version: z.number().int().min(1),
    supersedesEmploymentTermId: hrReferenceIdSchema.nullable(),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.nullable(),
    positionId: hrReferenceIdSchema.nullable(),
    departmentId: hrReferenceIdSchema.nullable(),
    costCentreId: hrReferenceIdSchema.nullable(),
    workplaceId: hrReferenceIdSchema.nullable(),
    managerEmployeeId: employeeIdSchema.nullable(),
    weeklyHours: weeklyHoursSchema,
    workingTimePattern: shortText(64),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const employmentTermSchema = employmentTermBaseSchema.refine(
  (value) =>
    value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
  { message: 'effectiveTo must not precede effectiveFrom' },
);
export const createEmploymentTermRequestSchema = employmentTermBaseSchema
  .omit({ id: true, employeeId: true, version: true, createdAt: true })
  .extend({
    supersedesEmploymentTermId: hrReferenceIdSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (value) =>
      value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
    { message: 'effectiveTo must not precede effectiveFrom' },
  );
export const employmentTermListResponseSchema = z
  .object({
    items: z.array(employmentTermSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const employeeStatusTransitionRequestSchema = z
  .object({
    toStatus: employeeStatusSchema,
    effectiveAt: z.iso.datetime(),
    reason: shortText(500).optional(),
  })
  .strict();
export const employeeStatusHistoryQuerySchema = pageSchema;
export const employeeStatusChangeSchema = z
  .object({
    id: z.string().uuid(),
    employeeId: employeeIdSchema,
    fromStatus: employeeStatusSchema.nullable(),
    toStatus: employeeStatusSchema,
    effectiveAt: z.iso.datetime(),
    reason: shortText(500).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const employeeStatusHistoryResponseSchema = z
  .object({
    items: z.array(employeeStatusChangeSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export type Employee = z.infer<typeof employeeSchema>;
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
export type EmploymentRelationship = z.infer<
  typeof employmentRelationshipSchema
>;
export type CreateEmploymentRelationshipRequest = z.infer<
  typeof createEmploymentRelationshipRequestSchema
>;
export type EmploymentTerm = z.infer<typeof employmentTermSchema>;
export type EmploymentTermListQuery = z.infer<
  typeof employmentTermListQuerySchema
>;
export type CreateEmploymentTermRequest = z.infer<
  typeof createEmploymentTermRequestSchema
>;
export type EmployeeStatusTransitionRequest = z.infer<
  typeof employeeStatusTransitionRequestSchema
>;
export type EmployeeStatusHistoryQuery = z.infer<
  typeof employeeStatusHistoryQuerySchema
>;
export type EmployeeStatusChange = z.infer<typeof employeeStatusChangeSchema>;
export type EmployeeDocument = z.infer<typeof employeeDocumentSchema>;
export type EmployeeDocumentListQuery = z.infer<
  typeof employeeDocumentListQuerySchema
>;
export type LinkEmployeeDocumentRequest = z.infer<
  typeof linkEmployeeDocumentRequestSchema
>;
export type UpdateEmployeeDocumentRequest = z.infer<
  typeof updateEmployeeDocumentRequestSchema
>;
export const employeeOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    employeeNumber: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    workEmail: { type: ['string', 'null'] },
    workPhone: { type: ['string', 'null'] },
    status: {
      enum: ['preboarding', 'active', 'inactive', 'archived', 'cancelled'],
      type: 'string',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'legalEntityId',
    'employeeNumber',
    'firstName',
    'lastName',
    'workEmail',
    'workPhone',
    'status',
    'createdAt',
    'updatedAt',
  ],
};
export const createEmployeeRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    legalEntityId: { type: 'string', format: 'uuid' },
    employeeNumber: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    workEmail: { type: ['string', 'null'] },
    workPhone: { type: ['string', 'null'] },
  },
  required: ['legalEntityId', 'employeeNumber', 'firstName', 'lastName'],
};
export const updateEmployeeRequestOpenApiSchema = strictOpenApi(
  {
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    workEmail: { type: ['string', 'null'] },
    workPhone: { type: ['string', 'null'], maxLength: 64 },
  },
  [],
);
export const employeeStatusChangeOpenApiSchema = strictOpenApi(
  {
    id: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    fromStatus: {
      type: ['string', 'null'],
      enum: ['preboarding', 'active', 'inactive', 'archived', 'cancelled'],
    },
    toStatus: {
      type: 'string',
      enum: ['preboarding', 'active', 'inactive', 'archived', 'cancelled'],
    },
    effectiveAt: { type: 'string', format: 'date-time' },
    reason: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
    createdAt: { type: 'string', format: 'date-time' },
  },
  [
    'id',
    'employeeId',
    'fromStatus',
    'toStatus',
    'effectiveAt',
    'reason',
    'createdAt',
  ],
);
export const employeeStatusTransitionRequestOpenApiSchema = strictOpenApi(
  {
    toStatus: {
      type: 'string',
      enum: ['preboarding', 'active', 'inactive', 'archived', 'cancelled'],
    },
    effectiveAt: { type: 'string', format: 'date-time' },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
  ['toStatus', 'effectiveAt'],
);
export const employmentTermOpenApiSchema = strictOpenApi(
  {
    id: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    relationshipId: { type: 'string', format: 'uuid' },
    version: { type: 'integer', minimum: 1 },
    supersedesEmploymentTermId: { type: ['string', 'null'], format: 'uuid' },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { type: ['string', 'null'], format: 'date' },
    positionId: { type: ['string', 'null'], format: 'uuid' },
    departmentId: { type: ['string', 'null'], format: 'uuid' },
    costCentreId: { type: ['string', 'null'], format: 'uuid' },
    workplaceId: { type: ['string', 'null'], format: 'uuid' },
    managerEmployeeId: { type: ['string', 'null'], format: 'uuid' },
    weeklyHours: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
    workingTimePattern: { type: 'string', minLength: 1, maxLength: 64 },
    createdAt: { type: 'string', format: 'date-time' },
  },
  [
    'id',
    'employeeId',
    'relationshipId',
    'version',
    'supersedesEmploymentTermId',
    'effectiveFrom',
    'effectiveTo',
    'positionId',
    'departmentId',
    'costCentreId',
    'workplaceId',
    'managerEmployeeId',
    'weeklyHours',
    'workingTimePattern',
    'createdAt',
  ],
);
export const createEmploymentTermRequestOpenApiSchema = strictOpenApi(
  {
    relationshipId: { type: 'string', format: 'uuid' },
    supersedesEmploymentTermId: { type: ['string', 'null'], format: 'uuid' },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { type: ['string', 'null'], format: 'date' },
    positionId: { type: ['string', 'null'], format: 'uuid' },
    departmentId: { type: ['string', 'null'], format: 'uuid' },
    costCentreId: { type: ['string', 'null'], format: 'uuid' },
    workplaceId: { type: ['string', 'null'], format: 'uuid' },
    managerEmployeeId: { type: ['string', 'null'], format: 'uuid' },
    weeklyHours: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
    workingTimePattern: { type: 'string', minLength: 1, maxLength: 64 },
  },
  [
    'relationshipId',
    'effectiveFrom',
    'effectiveTo',
    'positionId',
    'departmentId',
    'costCentreId',
    'workplaceId',
    'managerEmployeeId',
    'weeklyHours',
    'workingTimePattern',
  ],
);

export const checklistKindSchema = z.enum([
  'onboarding',
  'change',
  'offboarding',
]);
export const checklistStatusSchema = z.enum(['open', 'completed', 'cancelled']);
export const checklistTaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);
export const checklistTemplateItemSchema = z
  .object({
    id: z.string().uuid(),
    templateId: z.string().uuid(),
    position: z.number().int().min(1),
    title: shortText(200),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650),
    documentCategoryId: z.string().uuid().nullable(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const checklistTemplateSchema = z
  .object({
    id: z.string().uuid(),
    legalEntityId: z.string().uuid(),
    kind: checklistKindSchema,
    code: shortText(64),
    name: shortText(200),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    items: z.array(checklistTemplateItemSchema),
  })
  .strict();
export const checklistTaskSchema = z
  .object({
    id: z.string().uuid(),
    checklistId: z.string().uuid(),
    templateItemId: z.string().uuid().nullable(),
    title: shortText(200),
    ownerUserId: shortText(200),
    dueOn: dateSchema,
    documentCategoryId: z.string().uuid().nullable(),
    status: checklistTaskStatusSchema,
    skipReason: shortText(500).nullable(),
    documentId: z.string().uuid().nullable(),
    completedBy: z.string().nullable(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const checklistSchema = z
  .object({
    id: z.string().uuid(),
    legalEntityId: z.string().uuid(),
    employeeId: z.string().uuid(),
    relationshipId: z.string().uuid().nullable(),
    templateId: z.string().uuid(),
    kind: checklistKindSchema,
    status: checklistStatusSchema,
    startedOn: dateSchema,
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    tasks: z.array(checklistTaskSchema),
  })
  .strict();
export const checklistTemplateListQuerySchema = pageSchema
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    kind: checklistKindSchema.optional(),
    active: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const checklistListQuerySchema = pageSchema
  .extend({
    kind: checklistKindSchema.optional(),
    status: checklistStatusSchema.optional(),
    ownerUserId: shortText(200).optional(),
    dueBefore: dateSchema.optional(),
  })
  .strict();
export const createChecklistTemplateRequestSchema = z
  .object({
    legalEntityId: legalEntityIdentifierSchema,
    kind: checklistKindSchema,
    code: shortText(64),
    name: shortText(200),
  })
  .strict();
export const updateChecklistTemplateRequestSchema = z
  .object({ name: shortText(200).optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const createChecklistTemplateItemRequestSchema = z
  .object({
    position: z.number().int().min(1),
    title: shortText(200),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650),
    documentCategoryId: z.string().uuid().nullable().default(null),
  })
  .strict();
export const updateChecklistTemplateItemRequestSchema = z
  .object({
    position: z.number().int().min(1).optional(),
    title: shortText(200).optional(),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650).optional(),
    documentCategoryId: z.string().uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const createChecklistRequestSchema = z
  .object({
    templateId: z.string().uuid(),
    relationshipId: z.string().uuid().nullable().default(null),
    startedOn: dateSchema,
    ownerUserId: shortText(200),
  })
  .strict();
export const updateChecklistTaskRequestSchema = z
  .object({
    status: z.enum(['in_progress', 'completed', 'skipped']),
    skipReason: shortText(500).optional(),
    documentId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const checklistTemplateListResponseSchema = referenceListResponseSchema(
  'items',
  checklistTemplateSchema,
);
export const checklistListResponseSchema = referenceListResponseSchema(
  'items',
  checklistSchema,
);
export const checklistTemplateItemOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    templateId: { type: 'string', format: 'uuid' },
    position: { type: 'integer' },
    title: { type: 'string' },
    defaultDueOffsetDays: { type: 'integer', minimum: -3650, maximum: 3650 },
    documentCategoryId: { type: ['string', 'null'], format: 'uuid' },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'templateId',
    'position',
    'title',
    'defaultDueOffsetDays',
    'documentCategoryId',
    'active',
    'createdAt',
    'updatedAt',
  ],
};
export const checklistTemplateOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: ['onboarding', 'change', 'offboarding'] },
    code: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    items: { type: 'array', items: checklistTemplateItemOpenApiSchema },
  },
  required: [
    'id',
    'legalEntityId',
    'kind',
    'code',
    'name',
    'active',
    'createdAt',
    'updatedAt',
    'items',
  ],
};
export const checklistTaskOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    checklistId: { type: 'string', format: 'uuid' },
    templateItemId: { type: ['string', 'null'], format: 'uuid' },
    title: { type: 'string' },
    ownerUserId: { type: 'string' },
    dueOn: { type: 'string', format: 'date' },
    documentCategoryId: { type: ['string', 'null'], format: 'uuid' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'skipped'],
    },
    skipReason: { type: ['string', 'null'] },
    documentId: { type: ['string', 'null'], format: 'uuid' },
    completedBy: { type: ['string', 'null'] },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'checklistId',
    'templateItemId',
    'title',
    'ownerUserId',
    'dueOn',
    'documentCategoryId',
    'status',
    'skipReason',
    'documentId',
    'completedBy',
    'completedAt',
    'createdAt',
    'updatedAt',
  ],
};
export const checklistOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    templateId: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: ['onboarding', 'change', 'offboarding'] },
    status: { type: 'string', enum: ['open', 'completed', 'cancelled'] },
    startedOn: { type: 'string', format: 'date' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    tasks: { type: 'array', items: checklistTaskOpenApiSchema },
  },
  required: [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'templateId',
    'kind',
    'status',
    'startedOn',
    'completedAt',
    'createdAt',
    'updatedAt',
    'tasks',
  ],
};
export const createChecklistTemplateRequestOpenApiSchema = strictOpenApi(
  {
    legalEntityId: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: ['onboarding', 'change', 'offboarding'] },
    code: { type: 'string' },
    name: { type: 'string' },
  },
  ['legalEntityId', 'kind', 'code', 'name'],
);
export const updateChecklistTemplateRequestOpenApiSchema = strictOpenApi(
  { name: { type: 'string' }, active: { type: 'boolean' } },
  [],
);
export const createChecklistTemplateItemRequestOpenApiSchema = strictOpenApi(
  {
    position: { type: 'integer', minimum: 1 },
    title: { type: 'string' },
    defaultDueOffsetDays: { type: 'integer', minimum: -3650, maximum: 3650 },
    documentCategoryId: { type: ['string', 'null'], format: 'uuid' },
  },
  ['position', 'title', 'defaultDueOffsetDays'],
);
export const updateChecklistTemplateItemRequestOpenApiSchema = strictOpenApi(
  {
    position: { type: 'integer', minimum: 1 },
    title: { type: 'string' },
    defaultDueOffsetDays: { type: 'integer', minimum: -3650, maximum: 3650 },
    documentCategoryId: { type: ['string', 'null'], format: 'uuid' },
    active: { type: 'boolean' },
  },
  [],
);
export const createChecklistRequestOpenApiSchema = strictOpenApi(
  {
    templateId: { type: 'string', format: 'uuid' },
    relationshipId: { type: ['string', 'null'], format: 'uuid' },
    startedOn: { type: 'string', format: 'date' },
    ownerUserId: { type: 'string' },
  },
  ['templateId', 'startedOn', 'ownerUserId'],
);
export const updateChecklistTaskRequestOpenApiSchema = strictOpenApi(
  {
    status: { type: 'string', enum: ['in_progress', 'completed', 'skipped'] },
    skipReason: { type: 'string' },
    documentId: { type: ['string', 'null'], format: 'uuid' },
  },
  ['status'],
);
export const checklistTemplateListOpenApiSchema = referenceListOpenApiSchema(
  'items',
  checklistTemplateOpenApiSchema,
);
export const checklistListOpenApiSchema = referenceListOpenApiSchema(
  'items',
  checklistOpenApiSchema,
);
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;
export type ChecklistTemplateItem = z.infer<typeof checklistTemplateItemSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistTask = z.infer<typeof checklistTaskSchema>;
export type ChecklistTemplateListQuery = z.infer<
  typeof checklistTemplateListQuerySchema
>;
export type ChecklistListQuery = z.infer<typeof checklistListQuerySchema>;
export type CreateChecklistTemplateRequest = z.infer<
  typeof createChecklistTemplateRequestSchema
>;
export type UpdateChecklistTemplateRequest = z.infer<
  typeof updateChecklistTemplateRequestSchema
>;
export type CreateChecklistTemplateItemRequest = z.infer<
  typeof createChecklistTemplateItemRequestSchema
>;
export type UpdateChecklistTemplateItemRequest = z.infer<
  typeof updateChecklistTemplateItemRequestSchema
>;
export type CreateChecklistRequest = z.infer<
  typeof createChecklistRequestSchema
>;
export type UpdateChecklistTaskRequest = z.infer<
  typeof updateChecklistTaskRequestSchema
>;
