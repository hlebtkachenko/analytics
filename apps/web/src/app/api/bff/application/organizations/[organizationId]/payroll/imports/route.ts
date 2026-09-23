import { postPayrollImport } from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';

type Context = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: Context) {
  return postPayrollImport(
    (await getAuth()).api,
    request,
    (await context.params).organizationId,
  );
}
