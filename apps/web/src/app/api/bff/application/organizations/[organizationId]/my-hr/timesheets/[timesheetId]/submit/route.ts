import { postMyHrTimesheetSubmit } from '../../../../../../../../../../lib/auth/bff';
import { getAuth } from '../../../../../../../../../../lib/auth/server';
export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; timesheetId: string }> },
) {
  const p = await context.params;
  return postMyHrTimesheetSubmit(
    (await getAuth()).api,
    request,
    p.organizationId,
    p.timesheetId,
  );
}
