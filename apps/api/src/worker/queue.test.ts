import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { QUEUE_MAINTENANCE_OPTIONS, createQueue } from './queue.js';

function fakeBoss(existingPolicy: string | undefined) {
  const calls: string[] = [];
  const client = {
    createQueue: vi.fn(async () => {
      calls.push('createQueue');
    }),
    deleteQueue: vi.fn(async () => {
      calls.push('deleteQueue');
    }),
    getQueue: vi.fn(async () => {
      calls.push('getQueue');
      return existingPolicy === undefined
        ? null
        : { name: 'split_email_item', policy: existingPolicy };
    }),
  };

  return { calls, client: client as unknown as PgBoss, spies: client };
}

describe('QUEUE_MAINTENANCE_OPTIONS', () => {
  it('keeps every runtime schema change disabled for the bap_api role', () => {
    expect(QUEUE_MAINTENANCE_OPTIONS).toEqual({
      createSchema: false,
      migrate: false,
      persistQueueStats: false,
      schedule: true,
      schema: 'pgboss',
      supervise: true,
    });
  });
});

describe('createQueue', () => {
  it('creates a missing queue without deleting anything', async () => {
    const { calls, client, spies } = fakeBoss(undefined);
    const warn = vi.fn();

    await createQueue(
      client,
      'split_email_item',
      { policy: 'exclusive' },
      warn,
    );

    expect(calls).toEqual(['getQueue', 'createQueue']);
    expect(spies.createQueue).toHaveBeenCalledWith('split_email_item', {
      partition: false,
      policy: 'exclusive',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves an existing queue with the requested policy alone', async () => {
    const { calls, client, spies } = fakeBoss('exclusive');
    const warn = vi.fn();

    await createQueue(
      client,
      'split_email_item',
      { policy: 'exclusive' },
      warn,
    );

    expect(calls).toEqual(['getQueue', 'createQueue']);
    expect(spies.deleteQueue).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('deletes and recreates an existing queue with another policy, warning with names only', async () => {
    const { calls, client, spies } = fakeBoss('standard');
    const warn = vi.fn();

    await createQueue(
      client,
      'split_email_item',
      { policy: 'exclusive' },
      warn,
    );

    expect(calls).toEqual(['getQueue', 'deleteQueue', 'createQueue']);
    expect(spies.deleteQueue).toHaveBeenCalledWith('split_email_item');
    expect(spies.createQueue).toHaveBeenCalledWith('split_email_item', {
      partition: false,
      policy: 'exclusive',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Recreating queue split_email_item: policy standard cannot become exclusive in place',
    );
  });

  it('treats a queue created without a policy as standard', async () => {
    const { calls, client } = fakeBoss('standard');
    const warn = vi.fn();

    await createQueue(client, 'ingest_dataset', {}, warn);

    expect(calls).toEqual(['getQueue', 'createQueue']);
    expect(warn).not.toHaveBeenCalled();
  });
});
