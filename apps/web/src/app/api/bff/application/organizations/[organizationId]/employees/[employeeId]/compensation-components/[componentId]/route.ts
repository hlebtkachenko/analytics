import { patchEmployeeCompensationComponent } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    componentId: string;
  }>;
};
export async function PATCH(request: Request, context: Context) {
  const p = await context.params;
  return patchEmployeeCompensationComponent(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
    p.componentId,
  );
}
