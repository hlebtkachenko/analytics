import { BadRequestException } from '@nestjs/common';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { createDocumentRequestSchema } from '../documents/contract.js';
import {
  checkRoutePreconditions,
  receiveIntake,
  type ReceiveIntakeInput,
} from './inbox-repository.js';

const ITEM_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const BLOB_ID = '9f702163-4eac-4b8f-9076-b34ec2af9184';
const SHA256 = 'a'.repeat(64);

const itemRow = {
  assignee_id: null,
  channel_id: null,
  channel_kind: 'upload',
  confidence: '1.000',
  created_at: new Date('2026-09-16T06:00:00.000Z'),
  dataset_id: null,
  decided_by_kind: null,
  decided_by_user_id: null,
  detected_type: 'pdf',
  document_id: null,
  duplicate_of_item_id: null,
  hint_kind: null,
  hint_legal_entity_id: null,
  hint_link_document_id: null,
  hint_partner_id: null,
  hint_text: null,
  id: ITEM_ID,
  legal_entity_id: null,
  origin: null,
  partner_id: null,
  payload_kind: 'file',
  received_at: new Date('2026-09-16T06:00:00.000Z'),
  routed_at: null,
  snoozed_until: null,
  status: 'needs_review',
  updated_at: new Date('2026-09-16T06:00:00.000Z'),
};

// A scripted connection: every statement is recorded, and the scoped item read answers as the scope decides.
function fakePool(itemVisible: boolean): {
  pool: DatabasePool;
  statements: string[];
} {
  const statements: string[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push(text);

      if (text.includes('from app.blob where sha256')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('sum(byte_size)')) {
        return { rowCount: 1, rows: [{ total: '0' }] };
      }
      if (text.includes('insert into app.blob')) {
        return { rowCount: 1, rows: [{ id: BLOB_ID }] };
      }
      if (text.includes('insert into app.inbox_item\n')) {
        return { rowCount: 1, rows: [{ id: ITEM_ID }] };
      }
      // The rule pass reads organization-wide (a null scope); only the scoped read-back follows the flag.
      if (text.includes('from app.inbox_item as i')) {
        return itemVisible || values[0] === null
          ? { rowCount: 1, rows: [itemRow] }
          : { rowCount: 0, rows: [] };
      }
      if (text.includes('from app.inbox_item_file as f')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => undefined,
  };

  return {
    pool: {
      connect: async () => client as unknown as PoolClient,
    } as unknown as DatabasePool,
    statements,
  };
}

function uploadInput(persisted: string[]): ReceiveIntakeInput {
  return {
    byteSize: 17,
    channelId: null,
    channelKind: 'upload',
    externalId: null,
    legalEntityIds: null,
    mediaType: 'application/pdf',
    organizationId: 'organization_1',
    origin: null,
    originalFilename: 'placeholder.pdf',
    parentItemId: null,
    payloadKind: 'file',
    persist: async () => {
      persisted.push('persist');
    },
    quotaBytes: 1_000,
    role: 'owner',
    sender: null,
    sha256: SHA256,
    sniff: {
      output: {
        confidence: 1,
        detectedType: 'pdf',
        draft: {},
        fieldConfidences: {},
        issues: [],
        reasons: [],
      },
      provider: 'sniff',
      providerVersion: '2026-09-16.1',
    },
    storageKey: `org/organization_1/${SHA256}`,
    userId: 'user_1',
  };
}

describe('receiveIntake', () => {
  it('takes the organization advisory lock first and moves the bytes last', async () => {
    const { pool, statements } = fakePool(true);
    const persisted: string[] = [];
    const input = uploadInput(persisted);
    const original = input.persist;
    input.persist = async () => {
      await original();
      statements.push('persist');
    };

    await receiveIntake(pool, input);

    // begin and the tenant settings come from runInTenantContext; the lock is the first intake statement.
    expect(statements[2]).toBe('select pg_advisory_xact_lock(hashtext($1))');
    expect(statements.indexOf('persist')).toBe(statements.length - 2);
    expect(statements.at(-1)).toBe('commit');
  });

  it('never moves the bytes when the received item cannot be read back', async () => {
    const { pool, statements } = fakePool(false);
    const persisted: string[] = [];

    await expect(
      receiveIntake(pool, { ...uploadInput(persisted), legalEntityIds: [] }),
    ).rejects.toThrow('not readable in its own scope');

    expect(persisted).toEqual([]);
    expect(statements.at(-1)).toBe('rollback');
  });
});

describe('checkRoutePreconditions', () => {
  it('refuses an acknowledgement when the draft carries no partner', async () => {
    const transaction = {
      query: async () => {
        throw new Error(
          'no query runs when there is no reference and no partner',
        );
      },
    } as unknown as PoolClient;
    const document = createDocumentRequestSchema.parse({
      currencyCode: 'CZK',
      documentDate: '2026-09-12',
      kind: 'other',
      legalEntityId: ITEM_ID,
      title: 'Placeholder without partner',
      totalAmount: '1210.0000',
    });

    await expect(
      checkRoutePreconditions(transaction, {
        acknowledgeDuplicateOf: BLOB_ID,
        document,
        extraction: {
          output: {
            confidence: 1,
            detectedType: 'pdf',
            draft: {},
            fieldConfidences: {},
            issues: [],
            reasons: [],
          },
          provider: 'sniff',
          providerVersion: '2026-09-16.1',
        },
        legalEntityIds: null,
        organizationId: 'organization_1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
