import { patchEmployeeDocument } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';

type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    documentId: string;
  }>;
};

export async function PATCH(request: Request, context: Context) {
  const { organizationId, employeeId, documentId } = await context.params;
  return patchEmployeeDocument(
    (await getAuth()).api,
    request,
    organizationId,
    employeeId,
    documentId,
  );
}
