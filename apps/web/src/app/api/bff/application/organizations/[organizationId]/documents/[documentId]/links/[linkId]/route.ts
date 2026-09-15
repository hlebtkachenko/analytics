import { deleteDocumentLink } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<
    Readonly<{ documentId: string; linkId: string; organizationId: string }>
  >;
}>;

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId, linkId, organizationId } = await context.params;
  const auth = await getAuth();
  return deleteDocumentLink(
    auth.api,
    request,
    organizationId,
    documentId,
    linkId,
  );
}
