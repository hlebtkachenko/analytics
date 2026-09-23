import { getPayrollImport } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type Context = {
  params: Promise<{ importId: string; organizationId: string }>;
};

export async function GET(request: Request, context: Context) {
  const params = await context.params;
  return getPayrollImport(
    (await getAuth()).api,
    request,
    params.organizationId,
    params.importId,
  );
}
