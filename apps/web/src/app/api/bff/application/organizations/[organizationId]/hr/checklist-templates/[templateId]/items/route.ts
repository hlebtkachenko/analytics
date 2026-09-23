import { postChecklistTemplateItem } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; templateId: string }>;
};
export async function POST(request: Request, context: Context) {
  const { organizationId, templateId } = await context.params;
  return postChecklistTemplateItem(
    (await getAuth()).api,
    request,
    organizationId,
    templateId,
  );
}
