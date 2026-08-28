import { betterAuth } from 'better-auth';
import { admin, jwt, organization } from 'better-auth/plugins';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

import { disabledAuthPaths, resourceJwtConfiguration } from './contract.ts';
import {
  adminAuthSchema,
  coreAuthModels,
  jwtAuthSchema,
  organizationAuthSchema,
} from './models.ts';

const authEnvironmentSchema = z.object({
  BAP_PUBLIC_ORIGIN: z.url().refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  }),
  BETTER_AUTH_SECRET_FILE: z.string().min(1),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

let authInstance: ReturnType<typeof createAuth> | undefined;
let authPool: ReturnType<typeof createDatabasePool> | undefined;

export function loadAuthEnvironment(environment: NodeJS.ProcessEnv) {
  const parsed = authEnvironmentSchema.parse(environment);
  const publicOrigin = new URL(parsed.BAP_PUBLIC_ORIGIN);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(
    publicOrigin.hostname,
  );
  if (
    parsed.NODE_ENV === 'production' &&
    publicOrigin.protocol !== 'https:' &&
    !loopback
  ) {
    throw new Error('Production public origin must use HTTPS.');
  }
  return parsed;
}

export async function readAuthSecret(path: string): Promise<string> {
  const details = await stat(path);
  const permissions = details.mode & 0o777;
  if (!details.isFile() || ![0o400, 0o444, 0o600].includes(permissions)) {
    throw new Error('Better Auth secret must be a protected regular file.');
  }
  const secret = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  if (secret.length < 32) {
    throw new Error('Better Auth secret must contain at least 32 characters.');
  }
  return secret;
}

async function createAuth() {
  const environment = loadAuthEnvironment(process.env);
  const configuration = await loadDatabaseConfiguration(process.env, {
    role: 'bap_auth',
  });
  const secret = await readAuthSecret(environment.BETTER_AUTH_SECRET_FILE);
  authPool ??= createDatabasePool(configuration, { searchPath: 'auth' });

  return betterAuth({
    advanced: {
      crossSubDomainCookies: {
        enabled: false,
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
      },
      ipAddress: {
        ipAddressHeaders: ['x-bap-client-ip'],
      },
      trustedProxyHeaders: false,
    },
    baseURL: environment.BAP_PUBLIC_ORIGIN,
    database: authPool,
    disabledPaths: [...disabledAuthPaths],
    emailAndPassword: {
      disableSignUp: true,
      enabled: true,
    },
    plugins: [
      admin({ schema: adminAuthSchema }),
      organization({
        allowUserToCreateOrganization: false,
        schema: organizationAuthSchema,
      }),
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          gracePeriod: 60 * 60 * 24 * 7,
          keyPairConfig: {
            alg: 'EdDSA',
            crv: 'Ed25519',
          },
          rotationInterval: 60 * 60 * 24 * 30,
        },
        jwt: {
          audience: resourceJwtConfiguration.audience,
          definePayload: () => ({}),
          expirationTime: resourceJwtConfiguration.lifetime,
          issuer: environment.BAP_PUBLIC_ORIGIN,
        },
        schema: jwtAuthSchema,
      }),
    ],
    rateLimit: {
      ...coreAuthModels.rateLimit,
      customRules: {
        '/sign-in/email': { max: 5, window: 60 },
      },
      enabled: true,
      max: 100,
      storage: 'database',
      window: 60,
    },
    secret,
    trustedOrigins: [environment.BAP_PUBLIC_ORIGIN],
    user: coreAuthModels.user,
    session: coreAuthModels.session,
    account: coreAuthModels.account,
    verification: coreAuthModels.verification,
  });
}

export { disabledAuthPaths, resourceJwtConfiguration };

export async function getAuth() {
  authInstance ??= createAuth();
  return await authInstance;
}

export async function getAuthPool() {
  await getAuth();
  if (!authPool) {
    throw new Error('Auth pool is unavailable.');
  }
  return authPool;
}
