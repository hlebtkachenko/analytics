import { writeInboxItem } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ itemId: string; organizationId: string }>>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { itemId, organizationId } = await context.params;
  const auth = await getAuth();
  return writeInboxItem(auth.api, request, organizationId, itemId, 'discard');
}
