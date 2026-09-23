import { patchChecklistTask } from '../../../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{
    organizationId: string;
    employeeId: string;
    checklistId: string;
    taskId: string;
  }>;
};
export async function PATCH(request: Request, context: Context) {
  const { organizationId, employeeId, checklistId, taskId } =
    await context.params;
  return patchChecklistTask(
    (await getAuth()).api,
    request,
    organizationId,
    employeeId,
    checklistId,
    taskId,
  );
}
