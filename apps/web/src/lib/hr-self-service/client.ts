import type { z } from 'zod';
import { organizationPath } from '../datasets/client';
import {
  createLeaveRequestSchema,
  createTimesheetSchema,
  leaveCancelSchema,
  leaveRequestListSchema,
  leaveRequestSchema,
  leaveTypeListSchema,
  myHrAccessSchema,
  myHrDocumentsSchema,
  myHrPayslipsSchema,
  myHrProfileSchema,
  timesheetListSchema,
  timesheetSchema,
  updateTimesheetSchema,
} from './contract';

export class MyHrRequestError extends Error {
  constructor(readonly status: number) {
    super('Request failed.');
  }
}
const path = (organizationId: string, suffix = '') =>
  `${organizationPath(organizationId)}/my-hr${suffix}`;
const query = (values: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== undefined) p.set(k, String(v));
  const encoded = p.toString();
  return encoded ? `?${encoded}` : '';
};
const json = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH',
  body: unknown,
  schema: z.ZodType<T>,
) => {
  const response = await fetch(url, {
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
    cache: 'no-store',
    method,
  });
  if (!response.ok) throw new MyHrRequestError(response.status);
  return schema.parse(await response.json());
};
export const myHrAccessPath = (o: string) => path(o, '/access');
export const myHrProfilePath = (o: string) => path(o, '/profile');
export const myHrDocumentsPath = (
  o: string,
  q: Record<string, string | number | undefined> = {},
) => path(o, `/documents${query(q)}`);
export const myHrPayslipsPath = (
  o: string,
  q: Record<string, string | number | undefined> = {},
) => path(o, `/payslips${query(q)}`);
export const myHrTimesheetsPath = (
  o: string,
  q: Record<string, string | number | undefined> = {},
) => path(o, `/timesheets${query(q)}`);
export const myHrLeaveTypesPath = (
  o: string,
  q: Record<string, string | number | undefined> = {},
) => path(o, `/leave-types${query(q)}`);
export const myHrLeaveRequestsPath = (
  o: string,
  q: Record<string, string | number | undefined> = {},
) => path(o, `/leave-requests${query(q)}`);
export const getMyHrAccess = (o: string) =>
  json(myHrAccessPath(o), 'GET', undefined, myHrAccessSchema);
export const getMyHrProfile = (o: string) =>
  json(myHrProfilePath(o), 'GET', undefined, myHrProfileSchema);
export const listMyHrDocuments = (o: string, q = {}) =>
  json(myHrDocumentsPath(o, q), 'GET', undefined, myHrDocumentsSchema);
export const listMyHrPayslips = (o: string, q = {}) =>
  json(myHrPayslipsPath(o, q), 'GET', undefined, myHrPayslipsSchema);
export const listMyHrTimesheets = (o: string, q = {}) =>
  json(myHrTimesheetsPath(o, q), 'GET', undefined, timesheetListSchema);
export const createMyHrTimesheet = (
  o: string,
  body: z.input<typeof createTimesheetSchema>,
) =>
  json(
    myHrTimesheetsPath(o),
    'POST',
    createTimesheetSchema.parse(body),
    timesheetSchema,
  );
export const updateMyHrTimesheet = (
  o: string,
  id: string,
  body: z.input<typeof updateTimesheetSchema>,
) =>
  json(
    `${myHrTimesheetsPath(o)}/${encodeURIComponent(id)}`,
    'PATCH',
    updateTimesheetSchema.parse(body),
    timesheetSchema,
  );
export const submitMyHrTimesheet = (o: string, id: string) =>
  json(
    `${myHrTimesheetsPath(o)}/${encodeURIComponent(id)}/submit`,
    'POST',
    {},
    timesheetSchema,
  );
export const listMyHrLeaveTypes = (o: string, q = {}) =>
  json(myHrLeaveTypesPath(o, q), 'GET', undefined, leaveTypeListSchema);
export const listMyHrLeaveRequests = (o: string, q = {}) =>
  json(myHrLeaveRequestsPath(o, q), 'GET', undefined, leaveRequestListSchema);
export const createMyHrLeaveRequest = (
  o: string,
  body: z.input<typeof createLeaveRequestSchema>,
) =>
  json(
    myHrLeaveRequestsPath(o),
    'POST',
    createLeaveRequestSchema.parse(body),
    leaveRequestSchema,
  );
export const cancelMyHrLeaveRequest = (
  o: string,
  id: string,
  body: z.input<typeof leaveCancelSchema> = {},
) =>
  json(
    `${myHrLeaveRequestsPath(o)}/${encodeURIComponent(id)}/cancel`,
    'POST',
    leaveCancelSchema.parse(body),
    leaveRequestSchema,
  );
