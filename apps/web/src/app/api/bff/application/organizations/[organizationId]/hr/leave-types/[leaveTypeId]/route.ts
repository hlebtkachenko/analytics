import { patchLeaveType } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; leaveTypeId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  const p = await context.params;
  return patchLeaveType(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.leaveTypeId,
  );
}
