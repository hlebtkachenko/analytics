import { postMyHrLeaveRequestCancel } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';
export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; requestId: string }> },
) {
  const p = await context.params;
  return postMyHrLeaveRequestCancel(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.requestId,
  );
}
