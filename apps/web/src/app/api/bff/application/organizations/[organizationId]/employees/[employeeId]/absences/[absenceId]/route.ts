import { patchAbsence } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    absenceId: string;
  }>;
};
export async function PATCH(request: Request, context: Context) {
  const p = await context.params;
  return patchAbsence(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.employeeId,
    p.absenceId,
  );
}
