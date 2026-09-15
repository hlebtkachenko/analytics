import { patchPartner } from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string; partnerId: string }>>;
}>;

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId, partnerId } = await context.params;
  const auth = await getAuth();
  return patchPartner(auth.api, request, organizationId, partnerId);
}
