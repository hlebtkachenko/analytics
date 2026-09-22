import {
  deleteInboxRule,
  patchInboxRule,
} from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string; ruleId: string }>>;
}>;

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId, ruleId } = await context.params;
  const auth = await getAuth();
  return patchInboxRule(auth.api, request, organizationId, ruleId);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId, ruleId } = await context.params;
  const auth = await getAuth();
  return deleteInboxRule(auth.api, request, organizationId, ruleId);
}
