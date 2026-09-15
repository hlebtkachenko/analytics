import {
  deleteDocument,
  getDocument,
  patchDocument,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ documentId: string; organizationId: string }>>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId, organizationId } = await context.params;
  const auth = await getAuth();
  return getDocument(auth.api, request, organizationId, documentId);
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId, organizationId } = await context.params;
  const auth = await getAuth();
  return patchDocument(auth.api, request, organizationId, documentId);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { documentId, organizationId } = await context.params;
  const auth = await getAuth();
  return deleteDocument(auth.api, request, organizationId, documentId);
}
