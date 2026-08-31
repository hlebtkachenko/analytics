import {
  countSoleOwnedOrganizations,
  publicSignupEnabled,
  publicSignupInvitationExists,
  recordUserErasureRequest,
} from '@bap/db/access';
import { admin, jwt, organization, twoFactor } from 'better-auth/plugins';
import { APIError, betterAuth } from 'better-auth';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

import type { MailConfiguration } from '../mail/index.ts';
import {
  loadMailConfiguration,
  mailTemplates,
  sendMail,
} from '../mail/index.ts';
import { disabledAuthPaths, resourceJwtConfiguration } from './contract.ts';
import {
  adminAuthSchema,
  coreAuthModels,
  jwtAuthSchema,
  organizationAuthSchema,
  twoFactorAuthSchema,
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

const signUpEmailBodySchema = z.object({ email: z.email().max(254) });

export const publicSignUpErrorCode = 'PUBLIC_SIGN_UP_DISABLED';
export const authLoggerConfiguration = { level: 'warn' } as const;
export const accountSessionFreshAgeSeconds = 5 * 60;
export const accountDeletionSoleOwnerErrorCode =
  'ACCOUNT_HAS_SOLE_OWNED_ORGANIZATIONS';
export const accountDeletionUnavailableErrorCode =
  'ACCOUNT_DELETION_UNAVAILABLE';

export async function publicSignUpAllowed(
  pool: DatabasePool,
  body: unknown,
): Promise<boolean> {
  const parsed = signUpEmailBodySchema.safeParse(body);
  if (!parsed.success) {
    return false;
  }

  try {
    if (await publicSignupInvitationExists(pool, parsed.data.email)) {
      return true;
    }

    return await publicSignupEnabled(pool);
  } catch {
    return false;
  }
}

export function createPublicSignUpBeforeHook(pool: DatabasePool) {
  return async (context: { body?: unknown; path?: string }): Promise<void> => {
    if (context.path !== '/sign-up/email') {
      return;
    }

    if (!(await publicSignUpAllowed(pool, context.body))) {
      throw APIError.from('FORBIDDEN', {
        code: publicSignUpErrorCode,
        message: 'Public sign-up is disabled.',
      });
    }
  };
}

export function createAccountDeletionBeforeHook(pool: DatabasePool) {
  return async (user: { id: string }): Promise<void> => {
    try {
      if ((await countSoleOwnedOrganizations(pool, user.id)) > 0) {
        throw APIError.from('FORBIDDEN', {
          code: accountDeletionSoleOwnerErrorCode,
          message: 'Delete or delegate sole-owned organizations first.',
        });
      }

      await recordUserErasureRequest(pool, user.id);
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }

      throw APIError.from('INTERNAL_SERVER_ERROR', {
        code: accountDeletionUnavailableErrorCode,
        message: 'Account deletion is unavailable.',
      });
    }
  };
}

export function customSyntheticUser({
  additionalFields,
  coreFields,
  id,
}: {
  additionalFields: Record<string, unknown>;
  coreFields: {
    createdAt: Date;
    email: string;
    emailVerified: boolean;
    image: string | null;
    name: string;
    updatedAt: Date;
  };
  id: string;
}): Record<string, unknown> {
  return {
    ...coreFields,
    ...additionalFields,
    id,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    twoFactorEnabled: false,
  };
}

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

// Password reset delivery uses the shared mail module.
export function createPasswordResetSender(mail: MailConfiguration) {
  return async (data: {
    url: string;
    user: { email: string };
  }): Promise<void> => {
    const message = mailTemplates.passwordReset({
      to: data.user.email,
      url: data.url,
    });
    void sendMail(mail, {
      subject: message.subject,
      text: message.text,
      to: data.user.email,
    }).catch(() => undefined);
  };
}

// Verification mail uses the same module so no second transport is configured.
export function createVerificationSender(mail: MailConfiguration) {
  return async (data: {
    url: string;
    user: { email: string };
  }): Promise<void> => {
    const message = mailTemplates.emailVerification({
      to: data.user.email,
      url: data.url,
    });
    void sendMail(mail, {
      subject: message.subject,
      text: message.text,
      to: data.user.email,
    }).catch(() => undefined);
  };
}

// Better Auth does not build invitation URLs, so the public origin owns the acceptance route.
export function createInvitationSender(
  mail: MailConfiguration,
  publicOrigin: string,
) {
  return async (data: {
    email: string;
    id: string;
    organization: { name: string };
  }): Promise<void> => {
    const url = new URL(
      `/invitation/${encodeURIComponent(data.id)}`,
      publicOrigin,
    );
    const message = mailTemplates.organizationInvitation({
      organization: data.organization.name,
      to: data.email,
      url: url.toString(),
    });
    void sendMail(mail, {
      subject: message.subject,
      text: message.text,
      to: data.email,
    }).catch(() => undefined);
  };
}

// Custom rules apply to their named paths while Better Auth keeps its other built-ins.
export const authRateLimitRules = {
  '/organization/invite-member': { max: 5, window: 60 },
  '/request-password-reset': { max: 3, window: 60 },
  '/reset-password': { max: 5, window: 60 },
  '/reset-password/*': { max: 5, window: 60 },
  '/send-verification-email': { max: 3, window: 60 },
  '/sign-in/email': { max: 3, window: 60 },
  '/sign-up/email': { max: 3, window: 60 },
  '/two-factor/disable': { max: 3, window: 60 },
  '/two-factor/enable': { max: 3, window: 60 },
  '/two-factor/generate-backup-codes': { max: 3, window: 60 },
  '/two-factor/get-totp-uri': { max: 3, window: 60 },
  '/two-factor/send-otp': { max: 3, window: 60 },
  '/two-factor/verify-backup-code': { max: 3, window: 60 },
  '/two-factor/verify-otp': { max: 3, window: 60 },
  '/two-factor/verify-totp': { max: 3, window: 60 },
  '/verify-email': { max: 5, window: 60 },
} as const;

async function createAuth() {
  const environment = loadAuthEnvironment(process.env);
  const configuration = await loadDatabaseConfiguration(process.env, {
    role: 'bap_auth',
  });
  const mail = await loadMailConfiguration(process.env);
  const secret = await readAuthSecret(environment.BETTER_AUTH_SECRET_FILE);
  const pool = (authPool ??= createDatabasePool(configuration, {
    searchPath: 'auth',
  }));

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
    database: pool,
    disabledPaths: [...disabledAuthPaths],
    emailAndPassword: {
      autoSignIn: false,
      customSyntheticUser,
      disableSignUp: false,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 14,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: createPasswordResetSender(mail),
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: 1800,
      sendOnSignUp: true,
      sendVerificationEmail: createVerificationSender(mail),
    },
    hooks: {
      before: createPublicSignUpBeforeHook(pool),
    },
    logger: authLoggerConfiguration,
    plugins: [
      admin({ schema: adminAuthSchema }),
      organization({
        allowUserToCreateOrganization: false,
        schema: organizationAuthSchema,
        sendInvitationEmail: createInvitationSender(
          mail,
          environment.BAP_PUBLIC_ORIGIN,
        ),
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
      // Strictly opt-in: only a user who enabled it is challenged after a password sign-in.
      twoFactor({
        issuer: 'BAP',
        schema: twoFactorAuthSchema,
      }),
    ],
    rateLimit: {
      ...coreAuthModels.rateLimit,
      customRules: { ...authRateLimitRules },
      enabled: true,
      max: 100,
      storage: 'database',
      window: 60,
    },
    secret,
    trustedOrigins: [environment.BAP_PUBLIC_ORIGIN],
    user: {
      ...coreAuthModels.user,
      deleteUser: {
        beforeDelete: createAccountDeletionBeforeHook(pool),
        enabled: true,
      },
    },
    session: {
      ...coreAuthModels.session,
      freshAge: accountSessionFreshAgeSeconds,
    },
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
