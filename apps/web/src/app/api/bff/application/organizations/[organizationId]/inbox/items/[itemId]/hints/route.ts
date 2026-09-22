import { patchInboxItemHints } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ itemId: string; organizationId: string }>>;
}>;

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { itemId, organizationId } = await context.params;
  const auth = await getAuth();
  return patchInboxItemHints(auth.api, request, organizationId, itemId);
}
