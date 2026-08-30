import { getDatasetRows } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ datasetId: string; organizationId: string }>>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { datasetId, organizationId } = await context.params;
  const auth = await getAuth();
  return getDatasetRows(auth.api, request, organizationId, datasetId);
}
