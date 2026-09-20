import { putMemberStatus } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string; userId: string }>>;
}>;

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId, userId } = await context.params;
  const auth = await getAuth();
  return putMemberStatus(auth.api, request, organizationId, userId);
}
