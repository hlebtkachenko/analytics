import { z } from 'zod';
import { legalEntityIdentifierSchema } from '@bap/security';
import { employeeIdSchema } from '../hr/contract.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const minute = z.number().int().min(0);
const instant = z.string().datetime({ offset: true });
export const scheduleIdSchema = z.string().uuid();
export const timesheetIdSchema = z.string().uuid();
export const dateSchema = z.string().date();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const shiftSchema = z
  .object({
    id: z.string().uuid(),
    startsAt: instant,
    endsAt: instant,
    breakMinutes: minute,
    kind: z.enum(['regular', 'on_call']),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
const shiftInput = z
  .object({
    startsAt: instant,
    endsAt: instant,
    breakMinutes: minute.default(0),
    kind: z.enum(['regular', 'on_call']).default('regular'),
  })
  .strict()
  .superRefine((value, context) => {
    const elapsed = Date.parse(value.endsAt) - Date.parse(value.startsAt);
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed % 60_000 !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'shift duration must be positive whole minutes',
      });
      return;
    }
    if (value.breakMinutes >= elapsed / 60_000)
      context.addIssue({
        code: 'custom',
        message: 'breakMinutes must be less than duration',
      });
  });
export const scheduleSchema = z
  .object({
    id: scheduleIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: employeeIdSchema,
    relationshipId: z.string().uuid(),
    version: z.number().int().min(1),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    status: z.enum(['draft', 'published', 'superseded']),
    shifts: z.array(shiftSchema),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const createScheduleSchema = z
  .object({
    relationshipId: z.string().uuid(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    shifts: z.array(shiftInput).min(1),
  })
  .strict()
  .refine((x) => x.periodStart <= x.periodEnd, {
    message: 'periodStart must not exceed periodEnd',
  });
export const scheduleListQuerySchema = page
  .extend({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z.enum(['draft', 'published', 'superseded']).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not exceed to',
  });

export const timeEntrySchema = z
  .object({
    id: z.string().uuid(),
    workDate: dateSchema,
    startedAt: instant,
    endedAt: instant,
    breakMinutes: minute,
    overtimeMinutes: minute,
    nightMinutes: minute,
    holidayMinutes: minute,
    standbyMinutes: minute,
    activityCode: text(64).nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
const entryInput = z
  .object({
    workDate: dateSchema,
    startedAt: instant,
    endedAt: instant,
    breakMinutes: minute.default(0),
    overtimeMinutes: minute.default(0),
    nightMinutes: minute.default(0),
    holidayMinutes: minute.default(0),
    standbyMinutes: minute.default(0),
    activityCode: text(64).nullable().optional().default(null),
  })
  .strict();
const validatedEntryInput = entryInput.superRefine((value, context) => {
  const elapsed = Date.parse(value.endedAt) - Date.parse(value.startedAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed % 60_000 !== 0) {
    context.addIssue({
      code: 'custom',
      message: 'entry duration must be positive whole minutes',
    });
    return;
  }
  const duration = elapsed / 60_000;
  if (value.breakMinutes >= duration)
    context.addIssue({
      code: 'custom',
      message: 'breakMinutes must be less than duration',
    });
  const worked = duration - value.breakMinutes;
  for (const [key, amount] of Object.entries({
    overtimeMinutes: value.overtimeMinutes,
    nightMinutes: value.nightMinutes,
    holidayMinutes: value.holidayMinutes,
    standbyMinutes: value.standbyMinutes,
  }))
    if (amount > worked)
      context.addIssue({
        code: 'custom',
        message: `${key} cannot exceed worked minutes`,
      });
});
export const timesheetSchema = z
  .object({
    id: timesheetIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: employeeIdSchema,
    relationshipId: z.string().uuid(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    version: z.number().int().min(1),
    status: z.enum(['draft', 'submitted', 'approved', 'corrected']),
    submittedAt: instant.nullable(),
    approvedBy: z.string().nullable(),
    approvedAt: instant.nullable(),
    rejectionReason: text(500).nullable(),
    supersedesTimesheetId: timesheetIdSchema.nullable(),
    entries: z.array(timeEntrySchema),
    totalWorkedMinutes: minute,
    totalBreakMinutes: minute,
    totalOvertimeMinutes: minute,
    totalNightMinutes: minute,
    totalHolidayMinutes: minute,
    totalStandbyMinutes: minute,
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const createTimesheetSchema = z
  .object({
    relationshipId: z.string().uuid(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    entries: z.array(validatedEntryInput).min(1),
  })
  .strict()
  .refine((x) => x.periodStart <= x.periodEnd, {
    message: 'periodStart must not exceed periodEnd',
  });
export const updateTimesheetSchema = z
  .object({ entries: z.array(validatedEntryInput).min(1).optional() })
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: 'empty patch' });
export const timesheetListQuerySchema = page
  .extend({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z.enum(['draft', 'submitted', 'approved', 'corrected']).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not exceed to',
  });
export const emptyCommandSchema = z.object({}).strict();
export const reasonCommandSchema = z.object({ reason: text(500) }).strict();
export type Schedule = z.infer<typeof scheduleSchema>;
export type Timesheet = z.infer<typeof timesheetSchema>;
export type CreateSchedule = z.infer<typeof createScheduleSchema>;
export type CreateTimesheet = z.infer<typeof createTimesheetSchema>;
export type UpdateTimesheet = z.infer<typeof updateTimesheetSchema>;
export type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>;
export type TimesheetListQuery = z.infer<typeof timesheetListQuerySchema>;
export const scheduleListSchema = z
  .object({
    items: z.array(scheduleSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const timesheetListSchema = z
  .object({
    items: z.array(timesheetSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
) =>
  ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  }) as never;
const iso = { type: 'string', format: 'date-time' };
const uuid = { type: 'string', format: 'uuid' };
const min = { type: 'integer', minimum: 0 };
const shiftOpen = objectSchema(
  {
    id: uuid,
    startsAt: iso,
    endsAt: iso,
    breakMinutes: min,
    kind: { type: 'string', enum: ['regular', 'on_call'] },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'startsAt',
    'endsAt',
    'breakMinutes',
    'kind',
    'createdAt',
    'updatedAt',
  ],
);
const entryOpen = objectSchema(
  {
    id: uuid,
    workDate: { type: 'string', format: 'date' },
    startedAt: iso,
    endedAt: iso,
    breakMinutes: min,
    overtimeMinutes: min,
    nightMinutes: min,
    holidayMinutes: min,
    standbyMinutes: min,
    activityCode: { type: ['string', 'null'] },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'workDate',
    'startedAt',
    'endedAt',
    'breakMinutes',
    'overtimeMinutes',
    'nightMinutes',
    'holidayMinutes',
    'standbyMinutes',
    'activityCode',
    'createdAt',
    'updatedAt',
  ],
);
export const scheduleOpenApiSchema = objectSchema(
  {
    id: uuid,
    legalEntityId: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    version: { type: 'integer' },
    periodStart: { type: 'string', format: 'date' },
    periodEnd: { type: 'string', format: 'date' },
    status: { type: 'string', enum: ['draft', 'published', 'superseded'] },
    shifts: { type: 'array', items: shiftOpen },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'version',
    'periodStart',
    'periodEnd',
    'status',
    'shifts',
    'createdAt',
    'updatedAt',
  ],
);
export const timesheetOpenApiSchema = objectSchema(
  {
    id: uuid,
    legalEntityId: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    periodStart: { type: 'string', format: 'date' },
    periodEnd: { type: 'string', format: 'date' },
    version: { type: 'integer' },
    status: {
      type: 'string',
      enum: ['draft', 'submitted', 'approved', 'corrected'],
    },
    submittedAt: { type: ['string', 'null'], format: 'date-time' },
    approvedBy: { type: ['string', 'null'] },
    approvedAt: { type: ['string', 'null'], format: 'date-time' },
    rejectionReason: { type: ['string', 'null'] },
    supersedesTimesheetId: { type: ['string', 'null'], format: 'uuid' },
    entries: { type: 'array', items: entryOpen },
    totalWorkedMinutes: min,
    totalBreakMinutes: min,
    totalOvertimeMinutes: min,
    totalNightMinutes: min,
    totalHolidayMinutes: min,
    totalStandbyMinutes: min,
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'periodStart',
    'periodEnd',
    'version',
    'status',
    'submittedAt',
    'approvedBy',
    'approvedAt',
    'rejectionReason',
    'supersedesTimesheetId',
    'entries',
    'totalWorkedMinutes',
    'totalBreakMinutes',
    'totalOvertimeMinutes',
    'totalNightMinutes',
    'totalHolidayMinutes',
    'totalStandbyMinutes',
    'createdAt',
    'updatedAt',
  ],
);
export const listOpenApi = (item: unknown) =>
  objectSchema(
    {
      items: { type: 'array', items: item },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      total: { type: 'integer', minimum: 0 },
    },
    ['items', 'page', 'pageSize', 'total'],
  );
export const createScheduleOpenApiSchema = objectSchema(
  {
    relationshipId: uuid,
    periodStart: { type: 'string', format: 'date' },
    periodEnd: { type: 'string', format: 'date' },
    shifts: {
      type: 'array',
      minItems: 1,
      items: objectSchema(
        {
          startsAt: iso,
          endsAt: iso,
          breakMinutes: { ...min, default: 0 },
          kind: {
            type: 'string',
            enum: ['regular', 'on_call'],
            default: 'regular',
          },
        },
        ['startsAt', 'endsAt'],
      ),
    },
  },
  ['relationshipId', 'periodStart', 'periodEnd', 'shifts'],
);
export const createTimesheetOpenApiSchema = objectSchema(
  {
    relationshipId: uuid,
    periodStart: { type: 'string', format: 'date' },
    periodEnd: { type: 'string', format: 'date' },
    entries: {
      type: 'array',
      minItems: 1,
      items: objectSchema(
        {
          workDate: { type: 'string', format: 'date' },
          startedAt: iso,
          endedAt: iso,
          breakMinutes: { ...min, default: 0 },
          overtimeMinutes: { ...min, default: 0 },
          nightMinutes: { ...min, default: 0 },
          holidayMinutes: { ...min, default: 0 },
          standbyMinutes: { ...min, default: 0 },
          activityCode: { type: ['string', 'null'], default: null },
        },
        ['workDate', 'startedAt', 'endedAt'],
      ),
    },
  },
  ['relationshipId', 'periodStart', 'periodEnd', 'entries'],
);
export const updateTimesheetOpenApiSchema = objectSchema(
  {
    entries: {
      type: 'array',
      minItems: 1,
      items: objectSchema(
        {
          workDate: { type: 'string', format: 'date' },
          startedAt: iso,
          endedAt: iso,
          breakMinutes: { ...min, default: 0 },
          overtimeMinutes: { ...min, default: 0 },
          nightMinutes: { ...min, default: 0 },
          holidayMinutes: { ...min, default: 0 },
          standbyMinutes: { ...min, default: 0 },
          activityCode: { type: ['string', 'null'], default: null },
        },
        ['workDate', 'startedAt', 'endedAt'],
      ),
    },
  },
  [],
);
export const emptyCommandOpenApiSchema = objectSchema({}, []);
export const reasonCommandOpenApiSchema = objectSchema(
  { reason: { type: 'string', minLength: 1, maxLength: 500 } },
  ['reason'],
);

// Leave and absence facts deliberately use decimal strings. Converting through
// JavaScript numbers would lose the exact database value at this boundary.
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/);
const positiveDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/)
  .refine((x) => Number(x) > 0);
export const leaveTypeIdSchema = z.string().uuid();
export const leaveRequestIdSchema = z.string().uuid();
export const absenceIdSchema = z.string().uuid();
export const leaveTypeSchema = z
  .object({
    id: leaveTypeIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    code: text(64),
    name: text(200),
    unit: z.enum(['hours', 'days']),
    paid: z.boolean(),
    active: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const createLeaveTypeSchema = z
  .object({
    legalEntityId: legalEntityIdentifierSchema,
    code: text(64),
    name: text(200),
    unit: z.enum(['hours', 'days']),
    paid: z.boolean(),
  })
  .strict();
export const updateLeaveTypeSchema = z
  .object({
    code: text(64).optional(),
    name: text(200).optional(),
    unit: z.enum(['hours', 'days']).optional(),
    paid: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: 'empty patch' });
const queryBoolean = z.enum(['true', 'false']).transform((x) => x === 'true');
export const leaveTypeListQuerySchema = page
  .extend({
    legalEntityId: legalEntityIdentifierSchema.optional(),
    q: text(200).optional(),
    active: queryBoolean.optional(),
  })
  .strict();
export const leaveRequestSchema = z
  .object({
    id: leaveRequestIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: employeeIdSchema,
    relationshipId: z.string().uuid(),
    leaveTypeId: leaveTypeIdSchema,
    startsOn: dateSchema,
    endsOn: dateSchema,
    requestedAmount: positiveDecimal,
    status: z.enum(['requested', 'approved', 'rejected', 'cancelled', 'taken']),
    decidedBy: z.string().nullable(),
    decidedAt: instant.nullable(),
    reason: text(500).nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const createLeaveRequestSchema = z
  .object({
    relationshipId: z.string().uuid(),
    leaveTypeId: leaveTypeIdSchema,
    startsOn: dateSchema,
    endsOn: dateSchema,
    requestedAmount: positiveDecimal,
  })
  .strict()
  .refine((x) => x.startsOn <= x.endsOn, {
    message: 'startsOn must not exceed endsOn',
  });
export const leaveRequestListQuerySchema = page
  .extend({
    leaveTypeId: leaveTypeIdSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z
      .enum(['requested', 'approved', 'rejected', 'cancelled', 'taken'])
      .optional(),
  })
  .strict()
  .refine((x) => !x.from || !x.to || x.from <= x.to, {
    message: 'from must not exceed to',
  });
export const leaveDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: text(500).optional(),
  })
  .strict();
export const leaveCancelSchema = z
  .object({ reason: text(500).optional() })
  .strict();
export const leaveLedgerSchema = z
  .object({
    id: z.string().uuid(),
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: employeeIdSchema,
    relationshipId: z.string().uuid(),
    leaveTypeId: leaveTypeIdSchema,
    effectiveOn: dateSchema,
    amount: decimal,
    source: z.enum([
      'opening',
      'entitlement',
      'request',
      'correction',
      'expiry',
    ]),
    sourceId: z.string().uuid().nullable(),
    createdAt: instant,
  })
  .strict();
export const leaveBalanceSchema = z
  .object({
    leaveTypeId: leaveTypeIdSchema,
    unit: z.enum(['hours', 'days']),
    balance: decimal,
  })
  .strict();
export const leaveBalancesSchema = z
  .object({ items: z.array(leaveBalanceSchema) })
  .strict();
export const createLeaveLedgerSchema = z
  .object({
    leaveTypeId: leaveTypeIdSchema,
    relationshipId: z.string().uuid(),
    effectiveOn: dateSchema,
    amount: decimal.refine((x) => Number(x) !== 0),
    source: z.enum(['opening', 'correction']),
    reason: text(500),
  })
  .strict();
export const absenceSchema = z
  .object({
    id: absenceIdSchema,
    legalEntityId: legalEntityIdentifierSchema,
    employeeId: employeeIdSchema,
    relationshipId: z.string().uuid(),
    kind: z.enum(['sickness', 'care', 'parental', 'unpaid', 'other']),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable(),
    payrollCode: text(64),
    documentId: z.string().uuid().nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
export const createAbsenceSchema = z
  .object({
    relationshipId: z.string().uuid(),
    kind: z.enum(['sickness', 'care', 'parental', 'unpaid', 'other']),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable().optional().default(null),
    payrollCode: text(64),
    documentId: z.string().uuid().nullable().optional().default(null),
  })
  .strict()
  .refine((x) => !x.endsOn || x.startsOn <= x.endsOn, {
    message: 'startsOn must not exceed endsOn',
  });
export const updateAbsenceSchema = z
  .object({
    relationshipId: z.string().uuid().optional(),
    kind: z
      .enum(['sickness', 'care', 'parental', 'unpaid', 'other'])
      .optional(),
    startsOn: dateSchema.optional(),
    endsOn: dateSchema.nullable().optional(),
    payrollCode: text(64).optional(),
    documentId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, { message: 'empty patch' });
export const absenceListQuerySchema = page
  .extend({
    kind: z
      .enum(['sickness', 'care', 'parental', 'unpaid', 'other'])
      .optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .refine((x) => !x.from || !x.to || x.from <= x.to, {
    message: 'from must not exceed to',
  });
export const leaveTypeListSchema = z
  .object({
    items: z.array(leaveTypeSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const leaveRequestListSchema = z
  .object({
    items: z.array(leaveRequestSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const absenceListSchema = z
  .object({
    items: z.array(absenceSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export type LeaveType = z.infer<typeof leaveTypeSchema>;
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;
export type LeaveLedger = z.infer<typeof leaveLedgerSchema>;
export type Absence = z.infer<typeof absenceSchema>;
export type CreateLeaveType = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveType = z.infer<typeof updateLeaveTypeSchema>;
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;
export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;
export type LeaveTypeListQuery = z.infer<typeof leaveTypeListQuerySchema>;
export type CreateLeaveLedger = z.infer<typeof createLeaveLedgerSchema>;
export type CreateAbsence = z.infer<typeof createAbsenceSchema>;
export type UpdateAbsence = z.infer<typeof updateAbsenceSchema>;
export type AbsenceListQuery = z.infer<typeof absenceListQuerySchema>;
const leaveOpen = (properties: Record<string, unknown>, required: string[]) =>
  objectSchema(properties, required);
export const leaveTypeOpenApiSchema = leaveOpen(
  {
    id: uuid,
    legalEntityId: uuid,
    code: { type: 'string' },
    name: { type: 'string' },
    unit: { type: 'string', enum: ['hours', 'days'] },
    paid: { type: 'boolean' },
    active: { type: 'boolean' },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'code',
    'name',
    'unit',
    'paid',
    'active',
    'createdAt',
    'updatedAt',
  ],
);
export const leaveRequestOpenApiSchema = leaveOpen(
  {
    id: uuid,
    legalEntityId: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    leaveTypeId: uuid,
    startsOn: { type: 'string', format: 'date' },
    endsOn: { type: 'string', format: 'date' },
    requestedAmount: { type: 'string' },
    status: {
      type: 'string',
      enum: ['requested', 'approved', 'rejected', 'cancelled', 'taken'],
    },
    decidedBy: { type: ['string', 'null'] },
    decidedAt: { type: ['string', 'null'], format: 'date-time' },
    reason: { type: ['string', 'null'] },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'leaveTypeId',
    'startsOn',
    'endsOn',
    'requestedAmount',
    'status',
    'decidedBy',
    'decidedAt',
    'reason',
    'createdAt',
    'updatedAt',
  ],
);
export const absenceOpenApiSchema = leaveOpen(
  {
    id: uuid,
    legalEntityId: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    kind: {
      type: 'string',
      enum: ['sickness', 'care', 'parental', 'unpaid', 'other'],
    },
    startsOn: { type: 'string', format: 'date' },
    endsOn: { type: ['string', 'null'], format: 'date' },
    payrollCode: { type: 'string' },
    documentId: { type: ['string', 'null'], format: 'uuid' },
    createdAt: iso,
    updatedAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'kind',
    'startsOn',
    'endsOn',
    'payrollCode',
    'documentId',
    'createdAt',
    'updatedAt',
  ],
);
export const leaveLedgerOpenApiSchema = leaveOpen(
  {
    id: uuid,
    legalEntityId: uuid,
    employeeId: uuid,
    relationshipId: uuid,
    leaveTypeId: uuid,
    effectiveOn: { type: 'string', format: 'date' },
    amount: { type: 'string' },
    source: {
      type: 'string',
      enum: ['opening', 'entitlement', 'request', 'correction', 'expiry'],
    },
    sourceId: { type: ['string', 'null'], format: 'uuid' },
    createdAt: iso,
  },
  [
    'id',
    'legalEntityId',
    'employeeId',
    'relationshipId',
    'leaveTypeId',
    'effectiveOn',
    'amount',
    'source',
    'sourceId',
    'createdAt',
  ],
);
export const leaveBalancesOpenApiSchema = leaveOpen(
  {
    items: {
      type: 'array',
      items: leaveOpen(
        {
          leaveTypeId: uuid,
          unit: { type: 'string', enum: ['hours', 'days'] },
          balance: { type: 'string' },
        },
        ['leaveTypeId', 'unit', 'balance'],
      ),
    },
  },
  ['items'],
);
export const leaveTypeCreateOpenApiSchema = leaveOpen(
  {
    legalEntityId: uuid,
    code: { type: 'string' },
    name: { type: 'string' },
    unit: { type: 'string', enum: ['hours', 'days'] },
    paid: { type: 'boolean' },
  },
  ['legalEntityId', 'code', 'name', 'unit', 'paid'],
);
export const leaveRequestCreateOpenApiSchema = leaveOpen(
  {
    relationshipId: uuid,
    leaveTypeId: uuid,
    startsOn: { type: 'string', format: 'date' },
    endsOn: { type: 'string', format: 'date' },
    requestedAmount: { type: 'string' },
  },
  ['relationshipId', 'leaveTypeId', 'startsOn', 'endsOn', 'requestedAmount'],
);
export const absenceCreateOpenApiSchema = leaveOpen(
  {
    relationshipId: uuid,
    kind: {
      type: 'string',
      enum: ['sickness', 'care', 'parental', 'unpaid', 'other'],
    },
    startsOn: { type: 'string', format: 'date' },
    endsOn: { type: ['string', 'null'], format: 'date' },
    payrollCode: { type: 'string' },
    documentId: { type: ['string', 'null'], format: 'uuid' },
  },
  ['relationshipId', 'kind', 'startsOn', 'payrollCode'],
);
export const leaveDecisionOpenApiSchema = leaveOpen(
  {
    decision: { type: 'string', enum: ['approved', 'rejected'] },
    reason: { type: 'string' },
  },
  ['decision'],
);
export const leaveCancelOpenApiSchema = leaveOpen(
  { reason: { type: 'string' } },
  [],
);
export const leaveLedgerCreateOpenApiSchema = leaveOpen(
  {
    leaveTypeId: uuid,
    relationshipId: uuid,
    effectiveOn: { type: 'string', format: 'date' },
    amount: { type: 'string' },
    source: { type: 'string', enum: ['opening', 'correction'] },
    reason: { type: 'string' },
  },
  [
    'leaveTypeId',
    'relationshipId',
    'effectiveOn',
    'amount',
    'source',
    'reason',
  ],
);
export const leaveTypeUpdateOpenApiSchema = leaveOpen(
  {
    code: { type: 'string' },
    name: { type: 'string' },
    unit: { type: 'string', enum: ['hours', 'days'] },
    paid: { type: 'boolean' },
    active: { type: 'boolean' },
  },
  [],
);
export const absenceUpdateOpenApiSchema = leaveOpen(
  {
    relationshipId: uuid,
    kind: {
      type: 'string',
      enum: ['sickness', 'care', 'parental', 'unpaid', 'other'],
    },
    startsOn: { type: 'string', format: 'date' },
    endsOn: { type: ['string', 'null'], format: 'date' },
    payrollCode: { type: 'string' },
    documentId: { type: ['string', 'null'], format: 'uuid' },
  },
  [],
);
