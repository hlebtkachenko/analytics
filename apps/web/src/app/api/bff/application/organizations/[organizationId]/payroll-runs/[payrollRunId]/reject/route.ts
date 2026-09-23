import { postPayrollRunRejection } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; payrollRunId: string }>;
};
export async function POST(request: Request, context: Context) {
  const { organizationId, payrollRunId } = await context.params;
  return postPayrollRunRejection(
    (await getAuth()).api,
    request,
    organizationId,
    payrollRunId,
  );
}
