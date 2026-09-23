import { patchMyHrTimesheet } from '../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../lib/auth/server';
export async function PATCH(
  request: Request,
  context: { params: Promise<{ organizationId: string; timesheetId: string }> },
) {
  const p = await context.params;
  return patchMyHrTimesheet(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.timesheetId,
  );
}
