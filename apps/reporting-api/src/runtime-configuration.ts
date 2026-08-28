import { z } from 'zod';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3002;
const DEFAULT_PUBLIC_ORIGIN = 'http://localhost:3000';
const DEFAULT_JWKS_URL = 'http://web:3000/api/auth/jwks';
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
  host: z.string().trim().min(1),
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
    host: environment.HOST ?? DEFAULT_HOST,
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
