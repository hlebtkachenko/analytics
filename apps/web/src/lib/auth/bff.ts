import { z } from 'zod';

const organizationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const accessResponseSchema = z.object({
  organizationId: organizationIdSchema,
  role: z.enum(['owner', 'admin', 'member']),
  service: z.enum(['application-api', 'reporting-api']),
});

export type BffService = 'application' | 'reporting';

export type AuthSession = Readonly<{
  user: Readonly<{
    emailVerified: boolean;
    id: string;
  }>;
}>;

export type BffAuth = Readonly<{
  getSession: (
    input: Readonly<{ headers: Headers }>,
  ) => Promise<AuthSession | null>;
  signJWT: (
    input: Readonly<{
      body: Readonly<{ payload: Readonly<{ iat: number; sub: string }> }>;
    }>,
  ) => Promise<Readonly<{ token: string }>>;
}>;

const internalServiceOrigins: Record<BffService, string> = {
  application: 'http://api:3001',
  reporting: 'http://reporting-api:3002',
};

const expectedServiceNames: Record<
  BffService,
  'application-api' | 'reporting-api'
> = {
  application: 'application-api',
  reporting: 'reporting-api',
};
const requestIdSchema = z.string().uuid();
const privateResponseHeaders = { 'cache-control': 'private, no-store' };

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    headers: { ...privateResponseHeaders, ...headers },
    status,
  });
}

export function parseOrganizationId(value: string): string {
  return organizationIdSchema.parse(value);
}

export async function getOrganizationAccess(
  auth: BffAuth,
  request: Request,
  service: BffService,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const parsedSelector = organizationIdSchema.safeParse(organizationId);
  if (!parsedSelector.success) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }
  const selector = parsedSelector.data;
  const session = await auth.getSession({ headers: request.headers });

  if (!session?.user.emailVerified) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const { token } = await auth.signJWT({
    body: {
      payload: {
        iat: Math.floor(Date.now() / 1000),
        sub: session.user.id,
      },
    },
  });
  const incomingRequestId = request.headers.get('x-bap-request-id');
  const parsedRequestId = requestIdSchema.safeParse(incomingRequestId);
  const requestId = parsedRequestId.success
    ? parsedRequestId.data
    : crypto.randomUUID();
  let response: Response;
  try {
    response = await fetchImplementation(
      `${internalServiceOrigins[service]}/v1/organizations/${encodeURIComponent(selector)}/access`,
      {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          'x-bap-request-id': requestId,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );
  } catch {
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }

  if (!response.ok) {
    return jsonResponse({ error: 'access_denied' }, response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }
  const payload = accessResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    return jsonResponse({ error: 'service_unavailable' }, 502);
  }
  if (
    payload.data.organizationId !== selector ||
    payload.data.service !== expectedServiceNames[service]
  ) {
    return jsonResponse({ error: 'access_denied' }, 403);
  }

  return jsonResponse(payload.data, 200, { 'x-request-id': requestId });
}
