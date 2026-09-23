import { deleteHrAccessAssignment } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; assignmentId: string }>;
};
export async function DELETE(request: Request, context: Context) {
  const params = await context.params;
  return deleteHrAccessAssignment(
    (await getAuth()).api,
    request,
    params.organizationId,
    params.assignmentId,
  );
}
