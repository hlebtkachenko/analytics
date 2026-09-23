import { getMyHrPayslips } from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await context.params;
  return getMyHrPayslips((await getAuth()).api, request, organizationId);
}
