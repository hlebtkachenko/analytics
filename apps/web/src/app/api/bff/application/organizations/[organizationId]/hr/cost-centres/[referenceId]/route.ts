import { patchCostCentre } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; referenceId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  const { organizationId, referenceId } = await context.params;
  return patchCostCentre(
    (await getAuth()).api,
    request,
    organizationId,
    referenceId,
  );
}
