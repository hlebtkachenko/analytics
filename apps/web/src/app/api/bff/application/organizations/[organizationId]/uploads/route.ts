import { postDatasetUpload } from '../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../lib/auth/server';

type RouteContext = Readonly<{
  params: Promise<Readonly<{ organizationId: string }>>;
}>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { organizationId } = await context.params;
  const auth = await getAuth();
  return postDatasetUpload(auth.api, request, organizationId);
}
