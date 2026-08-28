import { getAuthPool } from '../../lib/auth/server';
import { checkReadiness } from '../../lib/readiness';

export async function GET(): Promise<Response> {
  try {
    const ready = await checkReadiness(await getAuthPool());
    return Response.json(
      { status: ready ? 'ready' : 'not_ready' },
      { status: ready ? 200 : 503 },
    );
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503 });
  }
}
