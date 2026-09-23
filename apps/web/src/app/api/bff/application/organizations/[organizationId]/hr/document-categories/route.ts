import {
  getDocumentCategories,
  postDocumentCategory,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  const { organizationId } = await context.params;
  return getDocumentCategories((await getAuth()).api, request, organizationId);
}
export async function POST(request: Request, context: Context) {
  const { organizationId } = await context.params;
  return postDocumentCategory((await getAuth()).api, request, organizationId);
}
