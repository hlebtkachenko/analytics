import { postInboxRuleAdopt } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string; ruleId: string }>>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId, ruleId } = await context.params;
  const auth = await getAuth();
  return postInboxRuleAdopt(auth.api, request, organizationId, ruleId);
}
