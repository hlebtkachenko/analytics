import {
  getEmployeeRelationships,
  postEmployeeRelationship,
} from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
type Context = {
  params: Promise<{ organizationId: string; employeeId: string }>;
};
export async function GET(request: Request, context: Context) {
  const { organizationId, employeeId } = await context.params;
  return getEmployeeRelationships(
    (await getAuth()).api,
    request,
    organizationId,
    employeeId,
  );
}
export async function POST(request: Request, context: Context) {
  const { organizationId, employeeId } = await context.params;
  return postEmployeeRelationship(
    (await getAuth()).api,
    request,
    organizationId,
    employeeId,
  );
}
