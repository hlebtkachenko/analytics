import { postTimesheetReject } from '../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    timesheetId: string;
  }>;
};
export async function POST(request: Request, context: Context) {
  const p = await context.params;
  return postTimesheetReject(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
    p.timesheetId,
  );
}
