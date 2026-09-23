import type { z } from 'zod';
import { organizationPath } from '../datasets/client';
import {
  absenceListSchema,
  absenceSchema,
  createAbsenceSchema,
  createLeaveLedgerSchema,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  createScheduleSchema,
  createTimesheetSchema,
  emptyCommandSchema,
  leaveBalancesSchema,
  leaveCancelSchema,
  leaveLedgerSchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeListSchema,
  leaveTypeSchema,
  reasonCommandSchema,
  scheduleListSchema,
  scheduleSchema,
  timesheetListSchema,
  timesheetSchema,
  updateAbsenceSchema,
  updateLeaveTypeSchema,
  updateTimesheetSchema,
  leaveDecisionSchema,
  type Absence,
  type LeaveLedger,
  type LeaveRequest,
  type LeaveType,
  type Schedule,
  type Timesheet,
} from './contract';

export class HrTimeRequestError extends Error {
  constructor(readonly status: number) {
    super('Request failed.');
  }
}
const query = (
  values: Record<string, string | number | boolean | undefined>,
) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, String(value));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};
const employeePath = (organizationId: string, employeeId: string) =>
  `${organizationPath(organizationId)}/employees/${encodeURIComponent(employeeId)}`;
export const schedulesPath = (
  organizationId: string,
  employeeId: string,
  values: Record<string, string | number | boolean | undefined> = {},
) => `${employeePath(organizationId, employeeId)}/schedules${query(values)}`;
export const timesheetsPath = (
  organizationId: string,
  employeeId: string,
  values: Record<string, string | number | boolean | undefined> = {},
) => `${employeePath(organizationId, employeeId)}/timesheets${query(values)}`;
export const leaveTypesPath = (
  organizationId: string,
  values: Record<string, string | number | boolean | undefined> = {},
) => `${organizationPath(organizationId)}/hr/leave-types${query(values)}`;
export const leaveRequestsPath = (
  organizationId: string,
  employeeId: string,
  values: Record<string, string | number | boolean | undefined> = {},
) =>
  `${employeePath(organizationId, employeeId)}/leave-requests${query(values)}`;
export const absencesPath = (
  organizationId: string,
  employeeId: string,
  values: Record<string, string | number | boolean | undefined> = {},
) => `${employeePath(organizationId, employeeId)}/absences${query(values)}`;
const json = async <T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body: unknown | undefined,
  schema: z.ZodType<T>,
): Promise<T> => {
  const response = await fetch(path, {
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
    cache: 'no-store',
    method,
  });
  if (!response.ok) throw new HrTimeRequestError(response.status);
  return schema.parse(await response.json());
};
export const listSchedules = (
  o: string,
  e: string,
  q: Record<string, string | number | boolean | undefined> = {},
) => json(schedulesPath(o, e, q), 'GET', undefined, scheduleListSchema);
export const createSchedule = (
  o: string,
  e: string,
  body: z.input<typeof createScheduleSchema>,
) =>
  json(
    schedulesPath(o, e),
    'POST',
    createScheduleSchema.parse(body),
    scheduleSchema,
  );
export const publishSchedule = (o: string, e: string, id: string) =>
  json(
    `${schedulesPath(o, e)}/${encodeURIComponent(id)}/publish`,
    'POST',
    emptyCommandSchema.parse({}),
    scheduleSchema,
  );
export const listTimesheets = (
  o: string,
  e: string,
  q: Record<string, string | number | boolean | undefined> = {},
) => json(timesheetsPath(o, e, q), 'GET', undefined, timesheetListSchema);
export const createTimesheet = (
  o: string,
  e: string,
  body: z.input<typeof createTimesheetSchema>,
) =>
  json(
    timesheetsPath(o, e),
    'POST',
    createTimesheetSchema.parse(body),
    timesheetSchema,
  );
export const updateTimesheet = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof updateTimesheetSchema>,
) =>
  json(
    `${timesheetsPath(o, e)}/${encodeURIComponent(id)}`,
    'PATCH',
    updateTimesheetSchema.parse(body),
    timesheetSchema,
  );
const timesheetCommand = (
  o: string,
  e: string,
  id: string,
  command: 'submit' | 'approve' | 'reject' | 'correct',
  body: unknown,
) =>
  json(
    `${timesheetsPath(o, e)}/${encodeURIComponent(id)}/${command}`,
    'POST',
    body,
    timesheetSchema,
  );
export const submitTimesheet = (o: string, e: string, id: string) =>
  timesheetCommand(o, e, id, 'submit', emptyCommandSchema.parse({}));
export const approveTimesheet = (o: string, e: string, id: string) =>
  timesheetCommand(o, e, id, 'approve', emptyCommandSchema.parse({}));
export const rejectTimesheet = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof reasonCommandSchema>,
) => timesheetCommand(o, e, id, 'reject', reasonCommandSchema.parse(body));
export const correctTimesheet = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof reasonCommandSchema>,
) => timesheetCommand(o, e, id, 'correct', reasonCommandSchema.parse(body));
export const listLeaveTypes = (
  o: string,
  q: Record<string, string | number | boolean | undefined> = {},
) => json(leaveTypesPath(o, q), 'GET', undefined, leaveTypeListSchema);
export const createLeaveType = (
  o: string,
  body: z.input<typeof createLeaveTypeSchema>,
) =>
  json(
    leaveTypesPath(o),
    'POST',
    createLeaveTypeSchema.parse(body),
    leaveTypeSchema,
  );
export const updateLeaveType = (
  o: string,
  id: string,
  body: z.input<typeof updateLeaveTypeSchema>,
) =>
  json(
    `${leaveTypesPath(o)}/${encodeURIComponent(id)}`,
    'PATCH',
    updateLeaveTypeSchema.parse(body),
    leaveTypeSchema,
  );
export const listLeaveRequests = (
  o: string,
  e: string,
  q: Record<string, string | number | boolean | undefined> = {},
) => json(leaveRequestsPath(o, e, q), 'GET', undefined, leaveRequestListSchema);
export const createLeaveRequest = (
  o: string,
  e: string,
  body: z.input<typeof createLeaveRequestSchema>,
) =>
  json(
    leaveRequestsPath(o, e),
    'POST',
    createLeaveRequestSchema.parse(body),
    leaveRequestSchema,
  );
export const decideLeaveRequest = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof leaveDecisionSchema>,
) =>
  json(
    `${leaveRequestsPath(o, e)}/${encodeURIComponent(id)}/decide`,
    'POST',
    leaveDecisionSchema.parse(body),
    leaveRequestSchema,
  );
export const cancelLeaveRequest = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof leaveCancelSchema>,
) =>
  json(
    `${leaveRequestsPath(o, e)}/${encodeURIComponent(id)}/cancel`,
    'POST',
    leaveCancelSchema.parse(body),
    leaveRequestSchema,
  );
export const getLeaveBalances = (o: string, e: string) =>
  json(
    `${employeePath(o, e)}/leave-balances`,
    'GET',
    undefined,
    leaveBalancesSchema,
  );
export const createLeaveLedger = (
  o: string,
  e: string,
  body: z.input<typeof createLeaveLedgerSchema>,
) =>
  json(
    `${employeePath(o, e)}/leave-ledger`,
    'POST',
    createLeaveLedgerSchema.parse(body),
    leaveLedgerSchema,
  );
export const listAbsences = (
  o: string,
  e: string,
  q: Record<string, string | number | boolean | undefined> = {},
) => json(absencesPath(o, e, q), 'GET', undefined, absenceListSchema);
export const createAbsence = (
  o: string,
  e: string,
  body: z.input<typeof createAbsenceSchema>,
) =>
  json(
    absencesPath(o, e),
    'POST',
    createAbsenceSchema.parse(body),
    absenceSchema,
  );
export const updateAbsence = (
  o: string,
  e: string,
  id: string,
  body: z.input<typeof updateAbsenceSchema>,
) =>
  json(
    `${absencesPath(o, e)}/${encodeURIComponent(id)}`,
    'PATCH',
    updateAbsenceSchema.parse(body),
    absenceSchema,
  );
export type {
  Schedule,
  Timesheet,
  LeaveType,
  LeaveRequest,
  LeaveLedger,
  Absence,
};
