import { patchPayrollComponent } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; componentId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  const p = await context.params;
  return patchPayrollComponent(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.componentId,
  );
}
