import { postInboxChannelCredential } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ channelId: string; organizationId: string }>>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { channelId, organizationId } = await context.params;
  const auth = await getAuth();
  return postInboxChannelCredential(
    auth.api,
    request,
    organizationId,
    channelId,
  );
}
