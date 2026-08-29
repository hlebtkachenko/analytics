import type { ResourcePrincipal } from '@bap/security';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  requestId?: string;
  resourcePrincipal?: ResourcePrincipal;
  route?: { path?: string };
  url: string;
}

export interface HttpResponse {
  setHeader(name: string, value: number | string): void;
  once(event: 'finish', listener: () => void): void;
  status(code: number): HttpResponse;
  json(body: unknown): void;
  statusCode: number;
}
