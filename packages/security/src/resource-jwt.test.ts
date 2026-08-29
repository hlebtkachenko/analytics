import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createResourceJwtVerifier,
  RESOURCE_TOKEN_AUDIENCE,
  ResourceTokenError,
} from './resource-jwt.js';

const ISSUER = 'https://bap.invalid';
const NOW = 1_800_000_000;

interface SigningKey {
  jwks: JSONWebKeySet;
  key: CryptoKey;
  kid: string;
}

async function createSigningKey(kid: string): Promise<SigningKey> {
  const pair = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(pair.publicKey);

  return {
    jwks: {
      keys: [{ ...publicJwk, alg: 'EdDSA', kid, use: 'sig' }],
    },
    key: pair.privateKey,
    kid,
  };
}

async function sign(
  signingKey: SigningKey,
  payload: Record<string, unknown> = {},
  lifetime = 300,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: signingKey.kid })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE_TOKEN_AUDIENCE)
    .setSubject('user_1')
    .setIssuedAt(NOW)
    .setExpirationTime(NOW + lifetime)
    .sign(signingKey.key);
}

describe('resource JWT verifier', () => {
  let firstKey: SigningKey;
  let secondKey: SigningKey;

  beforeAll(async () => {
    [firstKey, secondKey] = await Promise.all([
      createSigningKey('first'),
      createSigningKey('second'),
    ]);
  });

  it('validates the exact issuer, audience, algorithm, lifetime, and subject', async () => {
    const verifier = createResourceJwtVerifier({
      fetch: async () => Response.json(firstKey.jwks),
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/api/auth/jwks`,
      now: () => NOW,
    });

    await expect(
      verifier.verifyAuthorizationHeader(`Bearer ${await sign(firstKey)}`),
    ).resolves.toEqual({ issuedAt: NOW, subject: 'user_1' });
  });

  it('forces one refresh when an unknown key identifier appears during cooldown', async () => {
    let active = firstKey.jwks;
    let fetches = 0;
    const verifier = createResourceJwtVerifier({
      fetch: async (_url, request) => {
        fetches += 1;
        expect(request.headers.get('x-bap-client-ip')).toBe('127.0.0.1');
        return Response.json(active);
      },
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/api/auth/jwks`,
      now: () => NOW,
    });

    await verifier.verifyToken(await sign(firstKey));
    active = secondKey.jwks;

    await expect(verifier.verifyToken(await sign(secondKey))).resolves.toEqual({
      issuedAt: NOW,
      subject: 'user_1',
    });
    expect(fetches).toBe(2);
  });

  it('rejects malformed headers, excessive lifetime, and custom claims', async () => {
    const verifier = createResourceJwtVerifier({
      fetch: async () => Response.json(firstKey.jwks),
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/api/auth/jwks`,
      now: () => NOW,
    });

    await expect(
      verifier.verifyAuthorizationHeader(undefined),
    ).rejects.toBeInstanceOf(ResourceTokenError);
    await expect(
      verifier.verifyToken(await sign(firstKey, {}, 301)),
    ).rejects.toBeInstanceOf(ResourceTokenError);
    await expect(
      verifier.verifyToken(await sign(firstKey, { role: 'admin' })),
    ).rejects.toBeInstanceOf(ResourceTokenError);
  });

  it('rejects non-HTTP identity endpoints', () => {
    expect(() =>
      createResourceJwtVerifier({
        issuer: ISSUER,
        jwksUrl: 'file:///tmp/jwks.json',
      }),
    ).toThrow();
    expect(() =>
      createResourceJwtVerifier({
        issuer: 'ftp://bap.invalid',
        jwksUrl: `${ISSUER}/api/auth/jwks`,
      }),
    ).toThrow();
  });
});
