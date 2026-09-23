import {
  getSchedules,
  postSchedule,
} from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; employeeId: string }>;
};
export async function GET(request: Request, context: Context) {
  const p = await context.params;
  return getSchedules(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
  );
}
export async function POST(request: Request, context: Context) {
  const p = await context.params;
  return postSchedule(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
  );
}
