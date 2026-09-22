import {
  getInboxChannel,
  patchInboxChannel,
} from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ channelId: string; organizationId: string }>>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { channelId, organizationId } = await context.params;
  const auth = await getAuth();
  return getInboxChannel(auth.api, request, organizationId, channelId);
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { channelId, organizationId } = await context.params;
  const auth = await getAuth();
  return patchInboxChannel(auth.api, request, organizationId, channelId);
}
