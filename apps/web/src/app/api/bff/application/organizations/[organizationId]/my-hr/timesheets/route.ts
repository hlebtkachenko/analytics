import {
  getMyHrTimesheets,
  postMyHrTimesheet,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await context.params;
  return getMyHrTimesheets((await getAuth()).api, request, organizationId);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await context.params;
  return postMyHrTimesheet((await getAuth()).api, request, organizationId);
}
