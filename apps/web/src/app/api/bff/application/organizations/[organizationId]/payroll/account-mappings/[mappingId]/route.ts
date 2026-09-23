import { patchPayrollAccountMapping } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; mappingId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  const p = await context.params;
  return patchPayrollAccountMapping(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.mappingId,
  );
}
