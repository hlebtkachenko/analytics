import {
  getPayrollComponents,
  postPayrollComponent,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return getPayrollComponents(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
export async function POST(request: Request, context: Context) {
  return postPayrollComponent(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
