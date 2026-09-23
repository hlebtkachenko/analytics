import {
  getLeaveTypes,
  postLeaveType,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return getLeaveTypes(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
export async function POST(request: Request, context: Context) {
  return postLeaveType(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
