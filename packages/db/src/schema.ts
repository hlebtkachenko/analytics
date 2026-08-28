import {
  bigint,
  boolean,
  integer,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const authSchema = pgSchema('auth');

export const users = authSchema.table(
  'user',
  {
    banned: boolean('banned').notNull().default(false),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    banReason: text('ban_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    id: text('id').primaryKey(),
    image: text('image'),
    name: text('name').notNull(),
    role: text('role').notNull().default('user'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('user_email_key').on(table.email)],
);

export const sessions = authSchema.table(
  'session',
  {
    activeOrganizationId: text('active_organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    impersonatedBy: text('impersonated_by'),
    ipAddress: text('ip_address'),
    token: text('token').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    uniqueIndex('session_token_key').on(table.token),
  ],
);

export const accounts = authSchema.table(
  'account',
  {
    accessToken: text('access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    accountId: text('account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text('id').primaryKey(),
    idToken: text('id_token'),
    issuer: text('issuer').notNull(),
    password: text('password'),
    providerId: text('provider_id').notNull(),
    refreshToken: text('refresh_token'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_account_id_key').on(
      table.issuer,
      table.accountId,
    ),
  ],
);

export const verifications = authSchema.table(
  'verification',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    value: text('value').notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organizations = authSchema.table(
  'organization',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text('id').primaryKey(),
    logo: text('logo'),
    metadata: text('metadata'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
  },
  (table) => [uniqueIndex('organization_slug_key').on(table.slug)],
);

export const members = authSchema.table(
  'member',
  {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_organization_user_key').on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const invitations = authSchema.table(
  'invitation',
  {
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: text('id').primaryKey(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('invitation_organization_id_idx').on(table.organizationId)],
);

export const jwks = authSchema.table('jwks', {
  alg: text('alg'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  crv: text('crv'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  id: text('id').primaryKey(),
  privateKey: text('private_key').notNull(),
  publicKey: text('public_key').notNull(),
});

export const rateLimits = authSchema.table(
  'rate_limit',
  {
    count: integer('count').notNull(),
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('rate_limit_key_key').on(table.key)],
);

export const schema = {
  accounts,
  invitations,
  jwks,
  members,
  organizations,
  rateLimits,
  sessions,
  users,
  verifications,
};
