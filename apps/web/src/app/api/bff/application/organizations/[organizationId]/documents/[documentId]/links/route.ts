import { postDocumentLink } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ documentId: string; organizationId: string }>>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId, organizationId } = await context.params;
  const auth = await getAuth();
  return postDocumentLink(auth.api, request, organizationId, documentId);
}
