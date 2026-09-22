import { getAuth, getAuthPool } from '../../../../../lib/auth/server';
import { postIntakeItem } from '../../../../../lib/inbox/intake';

// The public push route: no session, a bearer credential resolved on the auth pool, one forwarded call.
export async function POST(request: Request): Promise<Response> {
  const auth = await getAuth();
  return postIntakeItem(request, {
    loadPool: getAuthPool,
    signJWT: auth.api.signJWT,
  });
}
