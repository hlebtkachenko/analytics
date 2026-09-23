import { z } from 'zod';

// Mirrors apps/api hr contract, which apps/web must not import.
export const identifierSchema = z.string().trim().toLowerCase().uuid();
export const hrAccessRoleSchema = z.enum([
  'hr_admin',
  'payroll_specialist',
  'payroll_approver',
  'sensitive_hr',
  'hr_auditor',
]);
export const hrAccessAssignmentSchema = z
  .object({
    accessRole: hrAccessRoleSchema,
    createdAt: z.iso.datetime(),
    id: identifierSchema,
    legalEntityId: identifierSchema,
    userId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export const hrAccessAssignmentListSchema = z
  .object({ assignments: z.array(hrAccessAssignmentSchema) })
  .strict();
export const createHrAccessAssignmentSchema = hrAccessAssignmentSchema
  .pick({ accessRole: true, legalEntityId: true, userId: true })
  .strict();
export type HrAccessAssignment = z.infer<typeof hrAccessAssignmentSchema>;
export const dateSchema = z.iso.date();
export const decimalSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/);
const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const nonNegativeDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/);
export const payrollComponentKindSchema = z.enum([
  'earning',
  'deduction',
  'employer_contribution',
]);
export const payrollComponentRecurrenceSchema = z.enum([
  'recurring',
  'one_off',
]);
export const payrollComponentSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    code: z.string(),
    name: z.string(),
    kind: payrollComponentKindSchema,
    recurrence: payrollComponentRecurrenceSchema,
    accountingKey: z.string(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const payrollComponentListSchema = z
  .object({
    components: z.array(payrollComponentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const payrollComponentListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const createPayrollComponentSchema = payrollComponentSchema
  .pick({
    legalEntityId: true,
    code: true,
    name: true,
    kind: true,
    recurrence: true,
    accountingKey: true,
  })
  .strict();
export const updatePayrollComponentSchema = payrollComponentSchema
  .pick({ name: true, active: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0);
export const compensationComponentSchema = z
  .object({
    id: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    componentDefinitionId: identifierSchema,
    validFrom: dateSchema,
    validTo: dateSchema.nullable(),
    amount: nonNegativeDecimalSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
  );
export const compensationComponentListSchema = z
  .object({
    compensationComponents: z.array(compensationComponentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const compensationComponentListQuerySchema = pageSchema
  .extend({ relationshipId: identifierSchema.optional() })
  .strict();
const compensationComponentRequestSchema = z
  .object({
    relationshipId: identifierSchema,
    componentDefinitionId: identifierSchema,
    validFrom: dateSchema,
    validTo: dateSchema.nullable().default(null),
    amount: nonNegativeDecimalSchema,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('CZK'),
  })
  .strict();
export const createCompensationComponentSchema =
  compensationComponentRequestSchema
    .strict()
    .refine(
      (value) => value.validTo === null || value.validTo >= value.validFrom,
    );
export const updateCompensationComponentSchema = z
  .object({
    validFrom: dateSchema,
    validTo: dateSchema.nullable().default(null),
    amount: nonNegativeDecimalSchema,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('CZK'),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
  );
export const payrollAccountMappingSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    accountingKey: z.string(),
    accountCode: z.string(),
    side: z.enum(['debit', 'credit']),
    validFrom: dateSchema,
    validTo: dateSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
  );
export const payrollAccountMappingListSchema = z
  .object({
    mappings: z.array(payrollAccountMappingSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const payrollAccountMappingListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    accountingKey: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
const payrollAccountMappingRequestSchema = z
  .object({
    legalEntityId: identifierSchema,
    accountingKey: z.string().trim().min(1).max(64),
    accountCode: z.string().trim().min(1).max(16),
    side: z.enum(['debit', 'credit']),
    validFrom: dateSchema,
    validTo: dateSchema.nullable().default(null),
  })
  .strict();
export const createPayrollAccountMappingSchema =
  payrollAccountMappingRequestSchema.strict();
export const updatePayrollAccountMappingSchema = z
  .object({
    accountCode: z.string().trim().min(1).max(16),
    side: z.enum(['debit', 'credit']),
    validFrom: dateSchema,
    validTo: dateSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
  );
export const employeeStatusSchema = z.enum([
  'preboarding',
  'active',
  'inactive',
  'archived',
  'cancelled',
]);
export const relationshipKindSchema = z.enum([
  'employment',
  'dpp',
  'dpc',
  'executive',
]);

export const employeeSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    workEmail: z.string().nullable(),
    workPhone: z.string().nullable(),
    status: employeeStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const relationshipSchema = z
  .object({
    id: identifierSchema,
    employeeId: identifierSchema,
    kind: relationshipKindSchema,
    position: z.string(),
    department: z.string().nullable(),
    costCentre: z.string().nullable(),
    weeklyHours: decimalSchema,
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const employeeDocumentApprovalSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'not_required',
]);
export const employeeDocumentSchema = z
  .object({
    documentId: identifierSchema,
    title: z.string(),
    documentDate: dateSchema,
    categoryId: identifierSchema.nullable(),
    relationshipId: identifierSchema.nullable(),
    approvalStatus: employeeDocumentApprovalSchema,
    approvedBy: z.string().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    supersedesDocumentId: identifierSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const employeeDetailSchema = employeeSchema
  .extend({
    relationships: z.array(relationshipSchema),
    documents: z.array(employeeDocumentSchema).default([]),
  })
  .strict();
export const employeeListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    status: employeeStatusSchema.optional(),
  })
  .strict();
export const employeeListSchema = z
  .object({
    employees: z.array(employeeSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const createEmployeeSchema = z
  .object({
    legalEntityId: identifierSchema,
    employeeNumber: z.string().trim().min(1).max(64),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    workEmail: z.string().trim().email().nullable().default(null),
    workPhone: z.string().trim().min(1).max(64).nullable().default(null),
  })
  .strict();
export const updateEmployeeSchema = createEmployeeSchema
  .omit({ legalEntityId: true, employeeNumber: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0);
export const createRelationshipSchema = z
  .object({
    kind: relationshipKindSchema,
    position: z.string().trim().min(1).max(200),
    department: z.string().trim().min(1).max(200).nullable().default(null),
    costCentre: z.string().trim().min(1).max(64).nullable().default(null),
    weeklyHours: decimalSchema,
    startDate: dateSchema,
    endDate: dateSchema.nullable().default(null),
  })
  .strict();
export const createEmployeeDocumentSchema = z
  .object({
    documentId: identifierSchema,
    categoryId: identifierSchema,
    relationshipId: identifierSchema.nullable().default(null),
    supersedesDocumentId: identifierSchema.nullable().default(null),
  })
  .strict();
export const employeeDocumentListQuerySchema = pageSchema
  .extend({
    categoryId: identifierSchema.optional(),
    approvalStatus: employeeDocumentApprovalSchema.optional(),
    currentOnly: z.enum(['true', 'false']).default('true'),
  })
  .strict();
export const employeeDocumentListSchema = z
  .object({
    items: z.array(employeeDocumentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const updateEmployeeDocumentSchema = z
  .object({
    categoryId: identifierSchema.optional(),
    relationshipId: identifierSchema.nullable().optional(),
    supersedesDocumentId: identifierSchema.nullable().optional(),
    approvalDecision: z.enum(['approved', 'rejected']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);
const weeklyHoursSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0 && Number(value) <= 168);
const employmentTermBaseSchema = z
  .object({
    id: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    version: z.number().int().min(1),
    supersedesEmploymentTermId: identifierSchema.nullable(),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.nullable(),
    positionId: identifierSchema.nullable(),
    departmentId: identifierSchema.nullable(),
    costCentreId: identifierSchema.nullable(),
    workplaceId: identifierSchema.nullable(),
    managerEmployeeId: identifierSchema.nullable(),
    weeklyHours: weeklyHoursSchema,
    workingTimePattern: z.string().trim().min(1).max(64),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const employmentTermSchema = employmentTermBaseSchema.refine(
  (value) =>
    value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
);
export const employmentTermListQuerySchema = pageSchema
  .extend({
    relationshipId: identifierSchema.optional(),
    effectiveOn: dateSchema.optional(),
  })
  .strict();
export const employmentTermListSchema = z
  .object({
    items: z.array(employmentTermSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const createEmploymentTermSchema = employmentTermBaseSchema
  .omit({ id: true, employeeId: true, version: true, createdAt: true })
  .extend({
    supersedesEmploymentTermId: identifierSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (value) =>
      value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom,
  );
export const employeeDocumentLinkSchema = z
  .object({ linked: z.literal(true) })
  .strict();
export const employeeStatusHistoryItemSchema = z
  .object({
    id: identifierSchema,
    employeeId: identifierSchema,
    fromStatus: employeeStatusSchema.nullable(),
    toStatus: employeeStatusSchema,
    effectiveAt: z.iso.datetime(),
    reason: z.string().min(1).max(500).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((item, context) => {
    const isReactivation =
      item.fromStatus === 'inactive' && item.toStatus === 'active';
    if (isReactivation && item.reason === null)
      context.addIssue({
        code: 'custom',
        message: 'Reactivation requires a reason.',
        path: ['reason'],
      });
    if (!isReactivation && item.reason !== null)
      context.addIssue({
        code: 'custom',
        message: 'Only reactivation may include a reason.',
        path: ['reason'],
      });
  });
export const employeeStatusHistoryQuerySchema = pageSchema;
export const employeeStatusHistorySchema = z
  .object({
    items: z.array(employeeStatusHistoryItemSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const employeeStatusTransitionSchema = z
  .object({
    toStatus: employeeStatusSchema,
    effectiveAt: z.iso.datetime(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const payrollResultSchema = z
  .object({
    employeeId: identifierSchema,
    employeeName: z.string().optional(),
    grossPay: nonNegativeDecimalSchema,
    employeeSocial: nonNegativeDecimalSchema,
    employeeHealth: nonNegativeDecimalSchema,
    incomeTax: nonNegativeDecimalSchema,
    otherDeductions: nonNegativeDecimalSchema,
    netPay: nonNegativeDecimalSchema,
    employerSocial: nonNegativeDecimalSchema,
    employerHealth: nonNegativeDecimalSchema,
    totalEmployerCost: nonNegativeDecimalSchema,
  })
  .strict();
export const payrollRunSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    version: z.number().int().min(1),
    supersedesPayrollRunId: identifierSchema.nullable(),
    documentId: identifierSchema,
    createdAt: z.iso.datetime(),
    results: z.array(payrollResultSchema).default([]),
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
export const payrollRunListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();
export const createPayrollRunSchema = z
  .object({
    legalEntityId: identifierSchema,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    supersedesPayrollRunId: identifierSchema.optional(),
    version: z.number().int().min(1).default(1),
    results: z
      .array(payrollResultSchema.omit({ employeeName: true }))
      .min(1)
      .max(1000),
  })
  .strict();

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
    id: identifierSchema,
    templateId: identifierSchema,
    position: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650),
    documentCategoryId: identifierSchema.nullable(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const checklistTemplateSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    kind: checklistKindSchema,
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    items: z.array(checklistTemplateItemSchema),
  })
  .strict();
export const checklistTemplateListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    kind: checklistKindSchema.optional(),
    active: z.enum(['true', 'false']).optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const checklistTemplateListSchema = z
  .object({
    items: z.array(checklistTemplateSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const createChecklistTemplateSchema = z
  .object({
    legalEntityId: identifierSchema,
    kind: checklistKindSchema,
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export const updateChecklistTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const createChecklistTemplateItemSchema = z
  .object({
    position: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650),
    documentCategoryId: identifierSchema.nullable().default(null),
  })
  .strict();
export const updateChecklistTemplateItemSchema = z
  .object({
    position: z.number().int().min(1).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    defaultDueOffsetDays: z.number().int().min(-3650).max(3650).optional(),
    documentCategoryId: identifierSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const checklistTaskSchema = z
  .object({
    id: identifierSchema,
    checklistId: identifierSchema,
    templateItemId: identifierSchema.nullable(),
    title: z.string(),
    ownerUserId: z.string(),
    dueOn: dateSchema,
    documentCategoryId: identifierSchema.nullable(),
    status: checklistTaskStatusSchema,
    skipReason: z.string().nullable(),
    documentId: identifierSchema.nullable(),
    completedBy: z.string().nullable(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const checklistSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema.nullable(),
    templateId: identifierSchema,
    kind: checklistKindSchema,
    status: checklistStatusSchema,
    startedOn: dateSchema,
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    tasks: z.array(checklistTaskSchema),
  })
  .strict();
export const employeeChecklistListQuerySchema = pageSchema
  .extend({
    kind: checklistKindSchema.optional(),
    status: checklistStatusSchema.optional(),
    ownerUserId: z.string().trim().min(1).max(200).optional(),
    dueBefore: dateSchema.optional(),
  })
  .strict();
export const employeeChecklistListSchema = z
  .object({
    items: z.array(checklistSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const createEmployeeChecklistSchema = z
  .object({
    templateId: identifierSchema,
    relationshipId: identifierSchema.nullable().default(null),
    startedOn: dateSchema,
    ownerUserId: z.string().trim().min(1).max(200),
  })
  .strict();
export const updateChecklistTaskSchema = z
  .object({
    status: z.enum(['in_progress', 'completed', 'skipped']),
    skipReason: z.string().trim().min(1).max(500).optional(),
    documentId: identifierSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'skipped' && value.skipReason === undefined)
      context.addIssue({
        code: 'custom',
        path: ['skipReason'],
        message: 'Skip reason is required.',
      });
    if (value.status !== 'skipped' && value.skipReason !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['skipReason'],
        message: 'Skip reason is only valid when skipping.',
      });
  });

// Mirrors apps/api hr contract, which apps/web must not import.
export const hrReferenceIdSchema = identifierSchema;
export const hrReferenceListQuerySchema = pageSchema
  .extend({
    legalEntityId: identifierSchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
const hrReferenceBaseSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const departmentSchema = hrReferenceBaseSchema
  .extend({ parentId: identifierSchema.nullable() })
  .strict();
export const positionSchema = hrReferenceBaseSchema;
export const costCentreSchema = hrReferenceBaseSchema;
export const workplaceSchema = hrReferenceBaseSchema
  .extend({ addressLabel: z.string().trim().min(1).max(300).nullable() })
  .strict();
export const documentCategorySchema = hrReferenceBaseSchema
  .extend({
    confidentiality: z.literal('operational'),
    retentionKey: z.string().trim().min(1).max(64),
    requiresApproval: z.boolean(),
  })
  .strict();
const referenceCreate = <T extends z.ZodObject>(schema: T) =>
  schema.omit({ id: true, createdAt: true, updatedAt: true, active: true });
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
  parentId: identifierSchema.nullable().default(null),
});
export const updateDepartmentRequestSchema = referenceUpdate(departmentSchema);
export const createPositionRequestSchema = referenceCreate(positionSchema);
export const updatePositionRequestSchema = referenceUpdate(positionSchema);
export const createCostCentreRequestSchema = referenceCreate(costCentreSchema);
export const updateCostCentreRequestSchema = referenceUpdate(costCentreSchema);
export const createWorkplaceRequestSchema = referenceCreate(
  workplaceSchema,
).extend({
  addressLabel: z.string().trim().min(1).max(300).nullable().default(null),
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
export const departmentListSchema = z
  .object({
    departments: z.array(departmentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const positionListSchema = z
  .object({
    positions: z.array(positionSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const costCentreListSchema = z
  .object({
    costCentres: z.array(costCentreSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const workplaceListSchema = z
  .object({
    workplaces: z.array(workplaceSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
export const documentCategoryListSchema = z
  .object({
    documentCategories: z.array(documentCategorySchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
  })
  .strict();
