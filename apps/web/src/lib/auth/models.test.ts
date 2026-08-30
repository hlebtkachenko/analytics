import { describe, expect, it } from 'vitest';

import {
  adminAuthSchema,
  coreAuthModels,
  jwtAuthSchema,
  organizationAuthSchema,
  twoFactorAuthSchema,
} from './models.js';

describe('Better Auth database mappings', () => {
  it('maps all core models to the auth schema baseline', () => {
    expect(coreAuthModels).toEqual({
      account: {
        fields: {
          accessToken: 'access_token',
          accessTokenExpiresAt: 'access_token_expires_at',
          accountId: 'account_id',
          createdAt: 'created_at',
          idToken: 'id_token',
          issuer: 'issuer',
          password: 'password',
          providerId: 'provider_id',
          refreshToken: 'refresh_token',
          refreshTokenExpiresAt: 'refresh_token_expires_at',
          scope: 'scope',
          updatedAt: 'updated_at',
          userId: 'user_id',
        },
        modelName: 'account',
      },
      rateLimit: {
        fields: { count: 'count', key: 'key', lastRequest: 'last_request' },
        modelName: 'rate_limit',
      },
      session: {
        fields: {
          createdAt: 'created_at',
          expiresAt: 'expires_at',
          ipAddress: 'ip_address',
          token: 'token',
          updatedAt: 'updated_at',
          userAgent: 'user_agent',
          userId: 'user_id',
        },
        modelName: 'session',
      },
      user: {
        fields: {
          createdAt: 'created_at',
          email: 'email',
          emailVerified: 'email_verified',
          image: 'image',
          name: 'name',
          updatedAt: 'updated_at',
        },
        modelName: 'user',
      },
      verification: {
        fields: {
          createdAt: 'created_at',
          expiresAt: 'expires_at',
          identifier: 'identifier',
          updatedAt: 'updated_at',
          value: 'value',
        },
        modelName: 'verification',
      },
    });
  });

  it('maps admin, organization, JWT, and rate-limit extensions', () => {
    expect(adminAuthSchema).toEqual({
      session: { fields: { impersonatedBy: 'impersonated_by' } },
      user: {
        fields: {
          banExpires: 'ban_expires',
          banReason: 'ban_reason',
          banned: 'banned',
          role: 'role',
        },
      },
    });
    expect(organizationAuthSchema).toMatchObject({
      invitation: {
        modelName: 'invitation',
        fields: {
          expiresAt: 'expires_at',
          inviterId: 'inviter_id',
          organizationId: 'organization_id',
        },
      },
      member: {
        modelName: 'member',
        fields: { organizationId: 'organization_id', userId: 'user_id' },
      },
      organization: { modelName: 'organization' },
      session: { fields: { activeOrganizationId: 'active_organization_id' } },
    });
    expect(jwtAuthSchema).toEqual({
      jwks: {
        fields: {
          alg: 'alg',
          createdAt: 'created_at',
          crv: 'crv',
          expiresAt: 'expires_at',
          privateKey: 'private_key',
          publicKey: 'public_key',
        },
        modelName: 'jwks',
      },
    });
  });

  it('maps every two-factor field to the 20260830.0002 migration', () => {
    expect(twoFactorAuthSchema).toEqual({
      twoFactor: {
        fields: {
          backupCodes: 'backup_codes',
          failedVerificationCount: 'failed_verification_count',
          lockedUntil: 'locked_until',
          secret: 'secret',
          userId: 'user_id',
          verified: 'verified',
        },
        modelName: 'two_factor',
      },
      user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
    });
  });
});
