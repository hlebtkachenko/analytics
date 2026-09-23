import { postEmployeeStatusTransition } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type Context = {
  params: Promise<{ organizationId: string; employeeId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { organizationId, employeeId } = await context.params;
  return postEmployeeStatusTransition(
    (await getAuth()).api,
    request,
    organizationId,
    employeeId,
  );
}
