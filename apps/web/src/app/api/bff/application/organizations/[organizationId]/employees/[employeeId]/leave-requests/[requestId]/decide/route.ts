import { postLeaveRequestDecide } from '../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    requestId: string;
  }>;
};
export async function POST(request: Request, context: Context) {
  const p = await context.params;
  return postLeaveRequestDecide(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
    p.requestId,
  );
}
