import { toNextJsHandler } from 'better-auth/next-js';
import type { NextRequest } from 'next/server';

import { disabledAuthPaths, getAuth } from '../../../../lib/auth/server';

function isDisabledPath(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname.replace('/api/auth', '');
  return disabledAuthPaths.has(pathname);
}

async function handle(request: NextRequest): Promise<Response> {
  if (isDisabledPath(request)) {
    return new Response(null, { status: 404 });
  }
  const handler = toNextJsHandler(await getAuth());
  return request.method === 'GET'
    ? handler.GET(request)
    : handler.POST(request);
}

export const GET = handle;
export const POST = handle;
