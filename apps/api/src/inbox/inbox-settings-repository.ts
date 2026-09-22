import { readEntityScope, runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import { DETECTED_TYPES } from './contract.js';
import type {
  InboxRoutingTarget,
  InboxSettings,
  PutInboxRoutingTargetRequest,
} from './contract.js';
import {
  isForeignKeyViolation,
  isPolicyViolation,
  loadRoutingTargetOverrides,
} from './inbox-repository-support.js';
import { knownDetectedType, routingTargetFor } from './routing-targets.js';
import type { DetectedType } from './routing-targets.js';

export interface RoutingTargetSelector extends TenantContext {
  detectedType: DetectedType;
}

export interface PutRoutingTargetInput extends RoutingTargetSelector {
  body: PutInboxRoutingTargetRequest;
}

export interface ReadInboxSettingsInput extends TenantContext {
  platformQuotaBytes: number;
}

export interface UpdateInboxSettingsInput extends ReadInboxSettingsInput {
  blobQuotaBytes: number | null;
}

export async function listRoutingTargets(
  pool: DatabasePool,
  input: TenantContext,
): Promise<InboxRoutingTarget[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const overrides = await loadRoutingTargetOverrides(transaction);
    return DETECTED_TYPES.map((type) => routingTargetFor(type, overrides));
  });
}

// An upsert of the whole target; the row remembers who saved it because the rules auto-route runs as that account.
export async function putRoutingTarget(
  pool: DatabasePool,
  input: PutRoutingTargetInput,
): Promise<InboxRoutingTarget | null> {
  const { body } = input;
  const detectedType = knownDetectedType(input.detectedType);

  return runInTenantContext(pool, input, async (transaction) => {
    // The auto route runs as the saver, so a default entity outside the saver's scope is refused like an unknown one.
    if (body.defaultLegalEntityId !== null) {
      const scope = await readEntityScope(transaction, input);

      if (
        scope.mode === 'restricted' &&
        !scope.legalEntityIds.includes(body.defaultLegalEntityId)
      ) {
        return null;
      }
    }

    let saved: { rows: { id: string }[] };

    try {
      saved = await transaction.query<{ id: string }>(
        `insert into app.inbox_routing_target
           (organization_id, detected_type, destination, document_kind, default_legal_entity_id, partner_policy,
            auto, auto_threshold, default_assignee_id, required_fields, created_by, updated_by)
         values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10::text[], $11, $11)
         on conflict (organization_id, detected_type) do update
           set destination = excluded.destination,
               document_kind = excluded.document_kind,
               default_legal_entity_id = excluded.default_legal_entity_id,
               partner_policy = excluded.partner_policy,
               auto = excluded.auto,
               auto_threshold = excluded.auto_threshold,
               default_assignee_id = excluded.default_assignee_id,
               required_fields = excluded.required_fields,
               updated_at = now(),
               updated_by = excluded.updated_by
         returning id`,
        [
          input.organizationId,
          detectedType,
          body.destination,
          body.documentKind,
          body.defaultLegalEntityId,
          body.partnerPolicy,
          body.auto,
          body.autoThreshold,
          body.defaultAssigneeId,
          body.requiredFields,
          input.userId,
        ],
      );
    } catch (error) {
      if (isForeignKeyViolation(error) || isPolicyViolation(error)) {
        return null;
      }

      throw error;
    }

    const id = saved.rows[0]?.id;

    if (id === undefined) {
      throw new Error('The routing target upsert returned no row.');
    }

    await transaction.query(
      "select app.record_audit('inbox_routing_target.updated', 'inbox_routing_target', $1, $2::jsonb)",
      [
        id,
        JSON.stringify({
          auto: body.auto,
          destination: body.destination,
          detectedType,
          documentKind: body.documentKind,
        }),
      ],
    );

    return routingTargetFor(
      detectedType,
      await loadRoutingTargetOverrides(transaction),
    );
  });
}

// False when the organization holds no row for the type; the platform default was already in force.
export async function deleteRoutingTarget(
  pool: DatabasePool,
  input: RoutingTargetSelector,
): Promise<boolean> {
  const detectedType = knownDetectedType(input.detectedType);

  return runInTenantContext(pool, input, async (transaction) => {
    const deleted = await transaction.query<{ id: string }>(
      'delete from app.inbox_routing_target where detected_type = $1 returning id',
      [detectedType],
    );
    const id = deleted.rows[0]?.id;

    if (id === undefined) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('inbox_routing_target.deleted', 'inbox_routing_target', $1, $2::jsonb)",
      [id, JSON.stringify({ detectedType })],
    );

    return true;
  });
}

async function loadInboxSettings(
  transaction: PoolClient,
  platformQuotaBytes: number,
): Promise<InboxSettings> {
  const setting = await transaction.query<{ blob_quota_bytes: string | null }>(
    'select blob_quota_bytes::text as blob_quota_bytes from app.organization_inbox_setting',
  );
  const used = await transaction.query<{ total: string }>(
    'select coalesce(sum(byte_size), 0)::text as total from app.blob',
  );
  const own = setting.rows[0]?.blob_quota_bytes ?? null;

  return {
    blobQuotaBytes: own === null ? null : Number(own),
    platformQuotaBytes,
    usedBytes: Number(used.rows[0]?.total ?? 0),
  };
}

export async function readInboxSettings(
  pool: DatabasePool,
  input: ReadInboxSettingsInput,
): Promise<InboxSettings> {
  return runInTenantContext(pool, input, (transaction) =>
    loadInboxSettings(transaction, input.platformQuotaBytes),
  );
}

// The row is created on first write and reset by nulling the column, never deleted; only an owner passes the policy.
export async function updateInboxSettings(
  pool: DatabasePool,
  input: UpdateInboxSettingsInput,
): Promise<InboxSettings | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    try {
      await transaction.query(
        `insert into app.organization_inbox_setting (organization_id, blob_quota_bytes, created_by)
         values ($1, $2, $3)
         on conflict (organization_id) do update
           set blob_quota_bytes = excluded.blob_quota_bytes, updated_at = now()`,
        [input.organizationId, input.blobQuotaBytes, input.userId],
      );
    } catch (error) {
      if (isPolicyViolation(error)) {
        return null;
      }

      throw error;
    }

    await transaction.query(
      "select app.record_audit('organization_inbox_setting.updated', 'organization_inbox_setting', $1, $2::jsonb)",
      [
        input.organizationId,
        JSON.stringify({ blobQuotaBytes: input.blobQuotaBytes }),
      ],
    );

    return loadInboxSettings(transaction, input.platformQuotaBytes);
  });
}
