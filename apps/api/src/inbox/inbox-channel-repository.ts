import { NotFoundException } from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import { channelTenant } from '../channel-access.js';
import type {
  CreateInboxChannelRequest,
  InboxChannel,
  InboxChannelCredential,
  IssueInboxChannelCredentialResponse,
  UpdateInboxChannelRequest,
} from './contract.js';
import { isForeignKeyViolation } from './inbox-repository-support.js';

export interface ChannelSelector extends TenantContext {
  channelId: string;
}

export interface CreateChannelInput extends TenantContext {
  body: CreateInboxChannelRequest;
}

export interface UpdateChannelInput extends ChannelSelector {
  body: UpdateInboxChannelRequest;
}

export interface RevokeCredentialInput extends ChannelSelector {
  credentialId: string;
}

export interface IssueCredentialInput extends ChannelSelector {
  // The platform intake domain an email address is issued under; unused for an API channel.
  intakeDomain: string;
}

interface ChannelRow {
  created_at: Date;
  email_address: string | null;
  enabled: boolean;
  hint_kind: string | null;
  id: string;
  item_count: number;
  kind: string;
  legal_entity_id: string | null;
  name: string;
  updated_at: Date;
}

interface CredentialRow {
  created_at: Date;
  credential_id: string;
  display_prefix: string;
  last_used_at: Date | null;
}

// The channel answers only for itself: the tenant transaction runs as the channel and RLS shows it its own row.
export async function readChannelPrincipal(
  pool: DatabasePool,
  input: { channelId: string; organizationId: string },
): Promise<boolean> {
  return runInTenantContext(
    pool,
    channelTenant(input.organizationId, input.channelId),
    async (transaction) => {
      const found = await transaction.query(
        'select 1 from app.inbox_channel where id = $1 and enabled and deleted_at is null',
        [input.channelId],
      );
      return found.rows.length > 0;
    },
  );
}

const CHANNEL_COLUMNS = `c.id, c.kind, c.name, c.enabled, c.email_address, c.legal_entity_id, c.hint_kind, c.created_at,
          c.updated_at,
          (select count(*)::int from app.inbox_item as i where i.channel_id = c.id) as item_count`;

async function loadCredentials(
  transaction: PoolClient,
  channelId: string,
): Promise<InboxChannelCredential[]> {
  const result = await transaction.query<CredentialRow>(
    'select credential_id, display_prefix, created_at, last_used_at from auth.list_channel_credentials($1)',
    [channelId],
  );

  return result.rows.map((row) => ({
    createdAt: row.created_at.toISOString(),
    credentialId: row.credential_id,
    displayPrefix: row.display_prefix,
    lastUsedAt:
      row.last_used_at === null ? null : row.last_used_at.toISOString(),
  }));
}

async function toChannel(
  transaction: PoolClient,
  row: ChannelRow,
): Promise<InboxChannel> {
  return {
    createdAt: row.created_at.toISOString(),
    credentials: await loadCredentials(transaction, row.id),
    emailAddress: row.email_address,
    enabled: row.enabled,
    hintKind: row.hint_kind,
    id: row.id,
    itemCount: row.item_count,
    kind: row.kind as InboxChannel['kind'],
    legalEntityId: row.legal_entity_id,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadChannel(
  transaction: PoolClient,
  channelId: string,
): Promise<InboxChannel | null> {
  const result = await transaction.query<ChannelRow>(
    `select ${CHANNEL_COLUMNS}
       from app.inbox_channel as c
      where c.id = $1 and c.deleted_at is null`,
    [channelId],
  );
  const row = result.rows[0];

  return row === undefined ? null : toChannel(transaction, row);
}

export async function listChannels(
  pool: DatabasePool,
  input: TenantContext,
): Promise<InboxChannel[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<ChannelRow>(
      `select ${CHANNEL_COLUMNS}
         from app.inbox_channel as c
        where c.deleted_at is null
        order by c.created_at, c.id`,
    );
    const channels: InboxChannel[] = [];

    for (const row of result.rows) {
      channels.push(await toChannel(transaction, row));
    }

    return channels;
  });
}

export async function readChannel(
  pool: DatabasePool,
  input: ChannelSelector,
): Promise<InboxChannel | null> {
  return runInTenantContext(pool, input, (transaction) =>
    loadChannel(transaction, input.channelId),
  );
}

export async function createChannel(
  pool: DatabasePool,
  input: CreateChannelInput,
): Promise<InboxChannel | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    let created: { rows: { id: string }[] };

    try {
      created = await transaction.query<{ id: string }>(
        `insert into app.inbox_channel (organization_id, kind, name, legal_entity_id, hint_kind, created_by)
         values ($1, $2, $3, $4::uuid, $5, $6)
         returning id`,
        [
          input.organizationId,
          body.kind,
          body.name,
          body.legalEntityId ?? null,
          body.hintKind ?? null,
          input.userId,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return null;
      }

      throw error;
    }

    const channelId = created.rows[0]?.id;

    if (channelId === undefined) {
      throw new Error('The inbox channel insert returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_channel.created', 'inbox_channel', $1, $2::jsonb)",
      [channelId, JSON.stringify({ kind: body.kind })],
    );

    return loadChannel(transaction, channelId);
  });
}

export async function updateChannel(
  pool: DatabasePool,
  input: UpdateChannelInput,
): Promise<InboxChannel | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    let updated: { rowCount: number | null };

    try {
      updated = await transaction.query(
        `update app.inbox_channel
            set name = case when $2 then $3 else name end,
                enabled = case when $4 then $5 else enabled end,
                legal_entity_id = case when $6 then $7::uuid else legal_entity_id end,
                hint_kind = case when $8 then $9 else hint_kind end,
                deleted_at = case when $10 then now() else deleted_at end,
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [
          input.channelId,
          body.name !== undefined,
          body.name ?? null,
          body.enabled !== undefined,
          body.enabled ?? null,
          body.legalEntityId !== undefined,
          body.legalEntityId ?? null,
          body.hintKind !== undefined,
          body.hintKind ?? null,
          body.deleted === true,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return null;
      }

      throw error;
    }

    if (updated.rowCount === 0) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('inbox_channel.updated', 'inbox_channel', $1, $2::jsonb)",
      [
        input.channelId,
        JSON.stringify({
          deleted: body.deleted === true,
          enabled: body.enabled ?? null,
        }),
      ],
    );

    // A soft deleted channel is gone for the caller from this response on.
    if (body.deleted === true) {
      const gone = await transaction.query<ChannelRow>(
        `select ${CHANNEL_COLUMNS} from app.inbox_channel as c where c.id = $1`,
        [input.channelId],
      );
      const row = gone.rows[0];
      return row === undefined ? null : toChannel(transaction, row);
    }

    return loadChannel(transaction, input.channelId);
  });
}

// The definer decides everything: owner role, organization, the per-kind active limit. Its errors map in the service.
// The credential kind follows the channel kind; an email channel is issued its address under the intake domain.
export async function issueCredential(
  pool: DatabasePool,
  input: IssueCredentialInput,
): Promise<IssueInboxChannelCredentialResponse> {
  return runInTenantContext(pool, input, async (transaction) => {
    const channel = await transaction.query<{ kind: string }>(
      'select kind from app.inbox_channel where id = $1 and deleted_at is null',
      [input.channelId],
    );
    const kind = channel.rows[0]?.kind;

    if (kind === undefined) {
      throw new NotFoundException();
    }

    const issued = await transaction.query<{
      credential_id: string;
      display_prefix: string;
      secret: string;
    }>(
      'select credential_id, secret, display_prefix from auth.issue_channel_credential($1, $2, $3)',
      kind === 'email'
        ? [input.channelId, 'email_address', input.intakeDomain]
        : [input.channelId, 'api_token', null],
    );
    const row = issued.rows[0];

    if (row === undefined) {
      throw new Error('The credential issue returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_channel_credential.issued', 'inbox_channel', $1, $2::jsonb)",
      [input.channelId, JSON.stringify({ credentialId: row.credential_id })],
    );

    return {
      credentialId: row.credential_id,
      displayPrefix: row.display_prefix,
      secret: row.secret,
    };
  });
}

// False when the credential is unknown, revoked, or not one of this channel's; the caller answers 404.
export async function revokeCredential(
  pool: DatabasePool,
  input: RevokeCredentialInput,
): Promise<boolean> {
  return runInTenantContext(pool, input, async (transaction) => {
    const active = await loadCredentials(transaction, input.channelId);

    if (
      !active.some(
        (credential) => credential.credentialId === input.credentialId,
      )
    ) {
      return false;
    }

    const revoked = await transaction.query<{ revoked: boolean }>(
      'select auth.revoke_channel_credential($1) as revoked',
      [input.credentialId],
    );

    if (revoked.rows[0]?.revoked !== true) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('inbox_channel_credential.revoked', 'inbox_channel', $1, $2::jsonb)",
      [input.channelId, JSON.stringify({ credentialId: input.credentialId })],
    );

    return true;
  });
}
