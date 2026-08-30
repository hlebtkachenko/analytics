import type { ResourcePrincipal } from '@bap/security';

// The subset of the multer file record the upload route reads; every field is untrusted input.
export interface ReceivedFile {
  mimetype?: string;
  originalname?: string;
  path?: string;
  size?: number;
}

export interface AuthenticatedRequest {
  file?: ReceivedFile;
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
