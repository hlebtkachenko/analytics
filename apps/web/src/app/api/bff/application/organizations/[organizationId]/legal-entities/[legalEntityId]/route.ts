import {
  deleteLegalEntity,
  patchLegalEntity,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ legalEntityId: string; organizationId: string }>>;
}>;

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { legalEntityId, organizationId } = await context.params;
  const auth = await getAuth();
  return patchLegalEntity(auth.api, request, organizationId, legalEntityId);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { legalEntityId, organizationId } = await context.params;
  const auth = await getAuth();
  return deleteLegalEntity(auth.api, request, organizationId, legalEntityId);
}
