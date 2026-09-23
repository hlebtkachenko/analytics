import { z } from 'zod';

// Mirrors apps/api hr-time contract. Browser code never imports application code.
export const identifierSchema = z.string().trim().toLowerCase().uuid();
export const dateSchema = z.iso.date();
export const instantSchema = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const minute = z.number().int().min(0);
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/);
const positiveDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0);

export const shiftInputSchema = z
  .object({
    startsAt: instantSchema,
    endsAt: instantSchema,
    breakMinutes: minute.default(0),
    kind: z.enum(['regular', 'on_call']).default('regular'),
  })
  .strict()
  .superRefine((value, context) => {
    const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
    if (!Number.isFinite(duration) || duration <= 0 || duration % 60_000 !== 0)
      context.addIssue({
        code: 'custom',
        message: 'shift duration must be positive whole minutes',
      });
    else if (value.breakMinutes >= duration / 60_000)
      context.addIssue({
        code: 'custom',
        message: 'breakMinutes must be less than duration',
      });
  });
export const shiftSchema = shiftInputSchema
  .extend({
    id: identifierSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const scheduleSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    version: z.number().int().min(1),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    status: z.enum(['draft', 'published', 'superseded']),
    shifts: z.array(shiftSchema),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const createScheduleSchema = z
  .object({
    relationshipId: identifierSchema,
    periodStart: dateSchema,
    periodEnd: dateSchema,
    shifts: z.array(shiftInputSchema).min(1),
  })
  .strict()
  .refine((value) => value.periodStart <= value.periodEnd);
export const scheduleListQuerySchema = page
  .extend({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z.enum(['draft', 'published', 'superseded']).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export const scheduleListSchema = z
  .object({
    items: z.array(scheduleSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();

export const timeEntryInputSchema = z
  .object({
    workDate: dateSchema,
    startedAt: instantSchema,
    endedAt: instantSchema,
    breakMinutes: minute.default(0),
    overtimeMinutes: minute.default(0),
    nightMinutes: minute.default(0),
    holidayMinutes: minute.default(0),
    standbyMinutes: minute.default(0),
    activityCode: text(64).nullable().optional().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const duration = Date.parse(value.endedAt) - Date.parse(value.startedAt);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration % 60_000 !== 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'entry duration must be positive whole minutes',
      });
      return;
    }
    const worked = duration / 60_000 - value.breakMinutes;
    if (worked <= 0)
      context.addIssue({
        code: 'custom',
        message: 'breakMinutes must be less than duration',
      });
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
export const timeEntrySchema = timeEntryInputSchema
  .extend({
    id: identifierSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const timesheetSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    periodStart: dateSchema,
    periodEnd: dateSchema,
    version: z.number().int().min(1),
    status: z.enum(['draft', 'submitted', 'approved', 'corrected']),
    submittedAt: instantSchema.nullable(),
    approvedBy: z.string().nullable(),
    approvedAt: instantSchema.nullable(),
    rejectionReason: text(500).nullable(),
    supersedesTimesheetId: identifierSchema.nullable(),
    entries: z.array(timeEntrySchema),
    totalWorkedMinutes: minute,
    totalBreakMinutes: minute,
    totalOvertimeMinutes: minute,
    totalNightMinutes: minute,
    totalHolidayMinutes: minute,
    totalStandbyMinutes: minute,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const createTimesheetSchema = z
  .object({
    relationshipId: identifierSchema,
    periodStart: dateSchema,
    periodEnd: dateSchema,
    entries: z.array(timeEntryInputSchema).min(1),
  })
  .strict()
  .refine((value) => value.periodStart <= value.periodEnd);
export const updateTimesheetSchema = z
  .object({ entries: z.array(timeEntryInputSchema).min(1).optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const timesheetListQuerySchema = page
  .extend({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z.enum(['draft', 'submitted', 'approved', 'corrected']).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export const timesheetListSchema = z
  .object({
    items: z.array(timesheetSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const emptyCommandSchema = z.object({}).strict();
export const reasonCommandSchema = z.object({ reason: text(500) }).strict();

export const leaveTypeSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    code: text(64),
    name: text(200),
    unit: z.enum(['hours', 'days']),
    paid: z.boolean(),
    active: z.boolean(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const createLeaveTypeSchema = leaveTypeSchema
  .pick({ legalEntityId: true, code: true, name: true, unit: true, paid: true })
  .strict();
export const updateLeaveTypeSchema = createLeaveTypeSchema
  .omit({ legalEntityId: true })
  .extend({ active: z.boolean().optional() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const leaveTypeListQuerySchema = page
  .extend({
    legalEntityId: identifierSchema.optional(),
    q: text(200).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const leaveTypeListSchema = z
  .object({
    items: z.array(leaveTypeSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const leaveRequestSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    leaveTypeId: identifierSchema,
    startsOn: dateSchema,
    endsOn: dateSchema,
    requestedAmount: positiveDecimal,
    status: z.enum(['requested', 'approved', 'rejected', 'cancelled', 'taken']),
    decidedBy: z.string().nullable(),
    decidedAt: instantSchema.nullable(),
    reason: text(500).nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const createLeaveRequestSchema = z
  .object({
    relationshipId: identifierSchema,
    leaveTypeId: identifierSchema,
    startsOn: dateSchema,
    endsOn: dateSchema,
    requestedAmount: positiveDecimal,
  })
  .strict()
  .refine((value) => value.startsOn <= value.endsOn);
export const leaveRequestListQuerySchema = page
  .extend({
    leaveTypeId: identifierSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    status: z
      .enum(['requested', 'approved', 'rejected', 'cancelled', 'taken'])
      .optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export const leaveRequestListSchema = z
  .object({
    items: z.array(leaveRequestSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const leaveDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: text(500).optional(),
  })
  .strict();
export const leaveCancelSchema = z
  .object({ reason: text(500).optional() })
  .strict();
export const leaveBalanceSchema = z
  .object({
    leaveTypeId: identifierSchema,
    unit: z.enum(['hours', 'days']),
    balance: decimal,
  })
  .strict();
export const leaveBalancesSchema = z
  .object({ items: z.array(leaveBalanceSchema) })
  .strict();
export const leaveLedgerSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    leaveTypeId: identifierSchema,
    effectiveOn: dateSchema,
    amount: decimal,
    source: z.enum([
      'opening',
      'entitlement',
      'request',
      'correction',
      'expiry',
    ]),
    sourceId: identifierSchema.nullable(),
    createdAt: instantSchema,
  })
  .strict();
export const createLeaveLedgerSchema = z
  .object({
    leaveTypeId: identifierSchema,
    relationshipId: identifierSchema,
    effectiveOn: dateSchema,
    amount: decimal.refine((value) => Number(value) !== 0),
    source: z.enum(['opening', 'correction']),
    reason: text(500),
  })
  .strict();
export const absenceSchema = z
  .object({
    id: identifierSchema,
    legalEntityId: identifierSchema,
    employeeId: identifierSchema,
    relationshipId: identifierSchema,
    kind: z.enum(['sickness', 'care', 'parental', 'unpaid', 'other']),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable(),
    payrollCode: text(64),
    documentId: identifierSchema.nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();
export const createAbsenceSchema = z
  .object({
    relationshipId: identifierSchema,
    kind: z.enum(['sickness', 'care', 'parental', 'unpaid', 'other']),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable().optional().default(null),
    payrollCode: text(64),
    documentId: identifierSchema.nullable().optional().default(null),
  })
  .strict()
  .refine((value) => !value.endsOn || value.startsOn <= value.endsOn);
export const updateAbsenceSchema = z
  .object({
    relationshipId: identifierSchema.optional(),
    kind: z
      .enum(['sickness', 'care', 'parental', 'unpaid', 'other'])
      .optional(),
    startsOn: dateSchema.optional(),
    endsOn: dateSchema.nullable().optional(),
    payrollCode: text(64).optional(),
    documentId: identifierSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const absenceListQuerySchema = page
  .extend({
    kind: z
      .enum(['sickness', 'care', 'parental', 'unpaid', 'other'])
      .optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export const absenceListSchema = z
  .object({
    items: z.array(absenceSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();

export type Schedule = z.infer<typeof scheduleSchema>;
export type Timesheet = z.infer<typeof timesheetSchema>;
export type LeaveType = z.infer<typeof leaveTypeSchema>;
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;
export type LeaveLedger = z.infer<typeof leaveLedgerSchema>;
export type Absence = z.infer<typeof absenceSchema>;
