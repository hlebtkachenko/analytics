import { postSchedulePublish } from '../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    scheduleId: string;
  }>;
};
export async function POST(request: Request, context: Context) {
  const p = await context.params;
  return postSchedulePublish(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
    p.scheduleId,
  );
}
