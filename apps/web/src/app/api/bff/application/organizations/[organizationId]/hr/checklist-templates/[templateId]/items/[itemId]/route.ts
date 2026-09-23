import { patchChecklistTemplateItem } from '../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    templateId: string;
    itemId: string;
  }>;
};
export async function PATCH(request: Request, context: Context) {
  const { organizationId, templateId, itemId } = await context.params;
  return patchChecklistTemplateItem(
    (await getAuth()).api,
    request,
    organizationId,
    templateId,
    itemId,
  );
}
