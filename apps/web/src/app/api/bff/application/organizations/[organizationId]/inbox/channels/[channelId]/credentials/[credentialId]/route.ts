import { deleteInboxChannelCredential } from '../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<
    Readonly<{
      channelId: string;
      credentialId: string;
      organizationId: string;
    }>
  >;
}>;

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { channelId, credentialId, organizationId } = await context.params;
  const auth = await getAuth();
  return deleteInboxChannelCredential(
    auth.api,
    request,
    organizationId,
    channelId,
    credentialId,
  );
}
