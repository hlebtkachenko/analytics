import { z } from 'zod';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3001;
const DEFAULT_PUBLIC_ORIGIN = 'http://localhost:3000';
const DEFAULT_JWKS_URL = 'http://web:3000/api/auth/jwks';
const DEFAULT_BLOB_STORAGE_DIRECTORY = '/var/lib/bap/blobs';
const DEFAULT_BLOB_QUOTA_BYTES = 1_073_741_824;
const DEFAULT_CLAMAV_HOST = 'clamd';
const DEFAULT_CLAMAV_PORT = 3310;
// A reserved name (RFC 2606), so a deployment that never set BAP_INTAKE_DOMAIN can boot but issues no routable address.
const DEFAULT_INTAKE_DOMAIN = 'intake.invalid';
// The email route's own cap on a raw MIME body: Mailgun's 25 MB ceiling plus headroom, never the multipart upload cap.
export const MAX_EMAIL_BYTES = 30_000_000;
// A DNS hostname: labels of letters, digits and hyphens, dot separated, no scheme and no port.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  });

const runtimeConfigurationSchema = z.object({
  blob: z.object({
    quotaBytesPerOrganization: z.coerce.number().int().positive(),
    storageDirectory: z.string().trim().min(1).startsWith('/'),
  }),
  clamav: z.object({
    host: z.string().trim().min(1),
    port: z.coerce.number().int().min(1).max(65535),
  }),
  host: z.string().trim().min(1),
  inbound: z.object({
    maxEmailBytes: z.literal(MAX_EMAIL_BYTES),
  }),
  intake: z.object({
    domain: z.string().trim().toLowerCase().regex(HOSTNAME_PATTERN),
  }),
  issuer: httpUrlSchema,
  jwksUrl: httpUrlSchema,
  port: z.coerce.number().int().min(1).max(65535),
  rateLimit: z.object({
    limit: z.coerce.number().int().min(1).max(1_000),
    maxEntries: z.coerce.number().int().min(1).max(100_000),
    windowMs: z.coerce.number().int().min(1_000).max(3_600_000),
  }),
});

export type RuntimeConfiguration = z.infer<typeof runtimeConfigurationSchema>;

export function loadRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): RuntimeConfiguration {
  const result = runtimeConfigurationSchema.safeParse({
    blob: {
      quotaBytesPerOrganization:
        environment.BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION ??
        DEFAULT_BLOB_QUOTA_BYTES,
      storageDirectory:
        environment.BAP_BLOB_STORAGE_DIR ?? DEFAULT_BLOB_STORAGE_DIRECTORY,
    },
    clamav: {
      host: environment.BAP_CLAMAV_HOST ?? DEFAULT_CLAMAV_HOST,
      port: environment.BAP_CLAMAV_PORT ?? DEFAULT_CLAMAV_PORT,
    },
    host: environment.HOST ?? DEFAULT_HOST,
    inbound: { maxEmailBytes: MAX_EMAIL_BYTES },
    intake: {
      domain: environment.BAP_INTAKE_DOMAIN ?? DEFAULT_INTAKE_DOMAIN,
    },
    issuer: environment.BAP_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN,
    jwksUrl: environment.BAP_JWKS_URL ?? DEFAULT_JWKS_URL,
    port: environment.PORT ?? DEFAULT_PORT,
    rateLimit: {
      limit: environment.AUTH_RATE_LIMIT ?? 60,
      maxEntries: environment.AUTH_RATE_LIMIT_CAPACITY ?? 10_000,
      windowMs: environment.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000,
    },
  });

  if (!result.success) {
    throw new Error('Invalid runtime configuration');
  }

  return result.data;
}
