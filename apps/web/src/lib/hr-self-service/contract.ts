import { z } from 'zod';

import { employeeSchema, relationshipSchema } from '../hr/contract';
import {
  createLeaveRequestSchema,
  createTimesheetSchema,
  leaveCancelSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeListSchema,
  timesheetListQuerySchema,
  timesheetListSchema,
  timesheetSchema,
  updateTimesheetSchema,
} from '../hr-time/contract';

// Mirrors apps/api hr-self-service contract, which apps/web must not import.
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const id = z.string().trim().toLowerCase().uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const myHrAccessSchema = z.union([
  z.object({ available: z.literal(false) }).strict(),
  z
    .object({ available: z.literal(true), employeeId: id, legalEntityId: id })
    .strict(),
]);
export const myHrProfileSchema = z
  .object({
    employee: employeeSchema,
    relationships: z.array(relationshipSchema),
  })
  .strict();
export const myHrDocumentSchema = z
  .object({
    documentId: id,
    title: z.string(),
    documentDate: z.iso.date(),
    categoryId: id.nullable(),
    relationshipId: id.nullable(),
    approvalStatus: z.enum(['not_required', 'approved']),
    approvedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const myHrDocumentsQuerySchema = page;
export const myHrDocumentsSchema = z
  .object({
    items: z.array(myHrDocumentSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const myHrPayslipsQuerySchema = page
  .extend({ fromMonth: month.optional(), toMonth: month.optional() })
  .strict()
  .refine((v) => !v.fromMonth || !v.toMonth || v.fromMonth <= v.toMonth);
export const myHrPayslipSchema = z
  .object({
    payrollRunId: id,
    month,
    version: z.number().int().min(1),
    status: z.enum(['finalized', 'paid', 'superseded']),
    documentId: id,
    finalizedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
  })
  .strict();
export const myHrPayslipsSchema = z
  .object({
    items: z.array(myHrPayslipSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
export const myHrLeaveTypesQuerySchema = page
  .extend({ q: z.string().trim().min(1).max(200).optional() })
  .strict();
export {
  createLeaveRequestSchema,
  createTimesheetSchema,
  leaveCancelSchema,
  leaveRequestListQuerySchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeListSchema,
  timesheetListQuerySchema,
  timesheetListSchema,
  timesheetSchema,
  updateTimesheetSchema,
};
