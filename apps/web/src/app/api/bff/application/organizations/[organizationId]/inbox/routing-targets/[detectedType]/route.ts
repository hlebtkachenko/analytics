import {
  deleteInboxRoutingTarget,
  putInboxRoutingTarget,
} from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ detectedType: string; organizationId: string }>>;
}>;

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { detectedType, organizationId } = await context.params;
  const auth = await getAuth();
  return putInboxRoutingTarget(auth.api, request, organizationId, detectedType);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { detectedType, organizationId } = await context.params;
  const auth = await getAuth();
  return deleteInboxRoutingTarget(
    auth.api,
    request,
    organizationId,
    detectedType,
  );
}
