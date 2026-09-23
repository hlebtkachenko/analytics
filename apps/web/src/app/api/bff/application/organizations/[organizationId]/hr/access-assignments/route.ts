import {
  getHrAccessAssignments,
  postHrAccessAssignment,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return getHrAccessAssignments(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
export async function POST(request: Request, context: Context) {
  return postHrAccessAssignment(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
