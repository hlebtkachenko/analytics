import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwtVerify,
  type CryptoKey,
  type FetchImplementation,
  type JWTVerifyResult,
  type RemoteJWKSet,
  type ResolvedKey,
} from 'jose';
import { z } from 'zod';

export const RESOURCE_TOKEN_AUDIENCE = 'bap-internal-services';
export const RESOURCE_TOKEN_MAX_AGE_SECONDS = 300;
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

const resourceClaimsSchema = z
  .object({
    aud: z.literal(RESOURCE_TOKEN_AUDIENCE),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    iss: httpUrlSchema,
    nbf: z.number().int().positive().optional(),
    sub: z.string().trim().min(1).max(128),
  })
  .strict();

const verifierConfigurationSchema = z
  .object({
    issuer: httpUrlSchema,
    jwksUrl: httpUrlSchema,
  })
  .strict();

const internalJwksClientIp = '127.0.0.1';

export type ResourcePrincipal = Readonly<{
  issuedAt: number;
  subject: string;
}>;

export interface ResourceJwtVerifier {
  verifyAuthorizationHeader(
    header: string | undefined,
  ): Promise<ResourcePrincipal>;
  verifyToken(token: string): Promise<ResourcePrincipal>;
}

export interface ResourceJwtVerifierOptions {
  fetch?: FetchImplementation;
  issuer: string;
  jwksUrl: string;
  now?: () => number;
}

export class ResourceTokenError extends Error {
  constructor() {
    super('Invalid resource token');
    this.name = 'ResourceTokenError';
  }
}

function validateResult(
  result: JWTVerifyResult & ResolvedKey<CryptoKey>,
  expectedIssuer: string,
  now: number,
): ResourcePrincipal {
  if (
    result.protectedHeader.alg !== 'EdDSA' ||
    result.key?.algorithm.name !== 'Ed25519'
  ) {
    throw new ResourceTokenError();
  }

  const claims = resourceClaimsSchema.safeParse(result.payload);

  if (
    !claims.success ||
    claims.data.iss !== expectedIssuer ||
    claims.data.exp <= claims.data.iat ||
    claims.data.exp - claims.data.iat > RESOURCE_TOKEN_MAX_AGE_SECONDS ||
    claims.data.iat > now + 5 ||
    (claims.data.nbf !== undefined && claims.data.nbf > claims.data.exp)
  ) {
    throw new ResourceTokenError();
  }

  return {
    issuedAt: claims.data.iat,
    subject: claims.data.sub,
  };
}

export function createResourceJwtVerifier(
  options: ResourceJwtVerifierOptions,
): ResourceJwtVerifier {
  const configuration = verifierConfigurationSchema.parse({
    issuer: options.issuer,
    jwksUrl: options.jwksUrl,
  });
  const baseFetch: FetchImplementation =
    options.fetch ??
    ((url, requestOptions) => globalThis.fetch(url, requestOptions));
  const authenticatedFetch: FetchImplementation = async (
    url,
    requestOptions,
  ) => {
    const headers = new Headers(requestOptions.headers);
    headers.set('x-bap-client-ip', internalJwksClientIp);
    return baseFetch(url, { ...requestOptions, headers });
  };
  const remoteOptions = {
    cacheMaxAge: 3_600_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
    [customFetch]: authenticatedFetch,
  };
  const jwks = createRemoteJWKSet(
    new URL(configuration.jwksUrl),
    remoteOptions,
  );
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  async function verify(
    token: string,
  ): Promise<JWTVerifyResult & ResolvedKey<CryptoKey>> {
    const verifyOptions = {
      algorithms: ['EdDSA'],
      audience: RESOURCE_TOKEN_AUDIENCE,
      clockTolerance: 5,
      issuer: configuration.issuer,
      requiredClaims: ['sub', 'iat', 'exp'],
    };

    try {
      return await jwtVerify(token, jwks, verifyOptions);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) {
        throw error;
      }

      await (jwks as RemoteJWKSet).reload();
      return jwtVerify(token, jwks, verifyOptions);
    }
  }

  return {
    async verifyAuthorizationHeader(
      header: string | undefined,
    ): Promise<ResourcePrincipal> {
      const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');

      if (match?.[1] === undefined) {
        throw new ResourceTokenError();
      }

      return this.verifyToken(match[1]);
    },

    async verifyToken(token: string): Promise<ResourcePrincipal> {
      if (token.length < 32 || token.length > 8192) {
        throw new ResourceTokenError();
      }

      try {
        const result = await verify(token);
        return validateResult(result, configuration.issuer, now());
      } catch (error) {
        if (error instanceof ResourceTokenError) {
          throw error;
        }

        throw new ResourceTokenError();
      }
    },
  };
}
