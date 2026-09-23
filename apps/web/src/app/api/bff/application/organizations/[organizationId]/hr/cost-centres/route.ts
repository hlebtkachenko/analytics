import {
  getCostCentres,
  postCostCentre,
} from '../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../lib/auth/server';
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  const { organizationId } = await context.params;
  return getCostCentres((await getAuth()).api, request, organizationId);
}
export async function POST(request: Request, context: Context) {
  const { organizationId } = await context.params;
  return postCostCentre((await getAuth()).api, request, organizationId);
}
