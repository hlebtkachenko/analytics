import {
  getInboxRules,
  postInboxRule,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string }>>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId } = await context.params;
  const auth = await getAuth();
  return getInboxRules(auth.api, request, organizationId);
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId } = await context.params;
  const auth = await getAuth();
  return postInboxRule(auth.api, request, organizationId);
}
