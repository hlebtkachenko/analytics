import { runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';
import type { Readable } from 'node:stream';

import type { BlobStore } from '../blobs/blob-store.js';
import {
  PARSE_INBOX_ITEM_QUEUE,
  parseInboxItemJobSchema,
  parsedIsdocDraftSchema,
  providerOutputSchema,
} from '../inbox/contract.js';
import type { ProviderOutput, RouteInboxItemJob } from '../inbox/contract.js';
import {
  insertExtraction,
  loadItem,
  loadItemFiles,
  loadRoutingTargetOverrides,
} from '../inbox/inbox-repository-support.js';
import {
  decideParsedAutoRoute,
  loadMatchedLiveRules,
  loadSenderFacts,
} from '../inbox/inbox-rule-repository.js';
import {
  ISDOC_DETECTED_TYPE,
  ISDOC_PROVIDER,
  ISDOC_PROVIDER_VERSION,
  failureOutput,
  normalizeRegistrationNumber,
  parseIsdoc,
  resolveIsdoc,
  type IsdocParseResult,
  type ResolutionEntity,
  type ResolutionPartner,
} from '../inbox/providers/isdoc.js';
import {
  MAX_ISDOCX_BYTES,
  isZip,
  readIsdocx,
} from '../inbox/providers/isdocx.js';
import { routingTargetFor } from '../inbox/routing-targets.js';
import { runTenantJob } from './job-context.js';
import { AUTOMATION_SUBJECT } from './route-inbox-item.js';
import type { WorkerMetrics } from './worker-metrics.js';

const CONTEXT = 'parse_inbox_item';
// Only an item a person has not decided yet is parsed; a routed, discarded or failed one keeps its state.
const PARSEABLE_STATUSES = ['received', 'needs_review'];

export interface ParseJobLogger {
  log(message: string, context?: string): void;
}

export interface ParseInboxItemOptions {
  blobs: BlobStore;
  data: unknown;
  enqueueRouteInboxItem: (job: RouteInboxItemJob) => Promise<void>;
  logger: ParseJobLogger;
  metrics: WorkerMetrics;
  pool: DatabasePool;
}

export type ParseInboxItemOutcome =
  | { issues: string[]; kind: 'parsed'; routed: boolean }
  | { kind: 'skipped'; reason: 'blob_not_clean' | 'item_unavailable' };

interface ParseSource {
  byteSize: number;
  clean: boolean;
  primaryFilename: string | null;
  storageKey: string;
}

// The bytes of the first file, never more than the archive cap; the size check runs before any read.
async function readCapped(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;

    if (length > MAX_ISDOCX_BYTES) {
      stream.destroy();
      break;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

// Plain XML or an ISDOCX archive: either way, bytes in, a parse result out, no database and no I/O.
export function parseIsdocBytes(bytes: Buffer): IsdocParseResult {
  if (!isZip(bytes)) {
    return parseIsdoc(bytes);
  }

  const archive = readIsdocx(bytes);
  return archive.ok ? parseIsdoc(archive.xml) : archive;
}

// An output that breaks the stored contract is kept as an unreadable failure, never as a row the detail cannot read.
export function storableOutput(output: ProviderOutput): ProviderOutput {
  return providerOutputSchema.safeParse(output).success
    ? output
    : failureOutput({
        code: 'unreadable',
        message: 'The parsed file does not fit the stored output.',
      });
}

async function loadSource(
  transaction: PoolClient,
  itemId: string,
): Promise<ParseSource | null> {
  const item = await loadItem(transaction, itemId, null);

  if (item === null || !PARSEABLE_STATUSES.includes(item.status)) {
    return null;
  }

  const files = await loadItemFiles(transaction, item.id);
  const first = files[0];

  return first === undefined
    ? null
    : {
        byteSize: first.byteSize,
        clean: files.every((file) => file.scanStatus === 'clean'),
        primaryFilename: first.originalFilename,
        storageKey: first.storageKey,
      };
}

interface Directory {
  ownEntities: ResolutionEntity[];
  partners: ResolutionPartner[];
}

// Transaction 1, read-only as system_automation: own entities and the partners the parties name, with their line
// category. Both stay in memory; a channel could read neither in the transaction that writes.
async function readDirectory(
  transaction: PoolClient,
  registrationNumbers: readonly string[],
  vatNumbers: readonly string[],
): Promise<Directory> {
  const entities = await transaction.query<{
    id: string;
    registration_number: string | null;
  }>('select id, registration_number from app.legal_entity');
  const partners = await transaction.query<{
    default_line_category: string | null;
    id: string;
    registration_number: string | null;
    vat_number: string | null;
  }>(
    `select id, registration_number, vat_number, default_line_category
       from app.partner
      where (regexp_replace(coalesce(registration_number, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,8}$'
             and lpad(regexp_replace(registration_number, '[^0-9]', '', 'g'), 8, '0') = any($1::text[]))
         or upper(regexp_replace(coalesce(vat_number, ''), '\\s', '', 'g')) = any($2::text[])`,
    [[...registrationNumbers], [...vatNumbers]],
  );

  return {
    ownEntities: entities.rows.map((row) => ({
      id: row.id,
      registrationNumber: row.registration_number,
    })),
    partners: partners.rows.map((row) => ({
      defaultLineCategory: row.default_line_category,
      id: row.id,
      registrationNumber: row.registration_number,
      vatNumber: row.vat_number,
    })),
  };
}

function nonNull(values: readonly (string | null)[]): string[] {
  return values.filter((value): value is string => value !== null);
}

// Transaction 2 under the scan payload's principal: the isdoc row, the extracted event, and the route decision.
async function recordParse(
  transaction: PoolClient,
  tenant: TenantContext,
  itemId: string,
  parse: IsdocParseResult,
  directory: Directory,
): Promise<{
  output: ProviderOutput;
  routeJob: RouteInboxItemJob | null;
} | null> {
  const item = await loadItem(transaction, itemId, null, true);

  if (item === null || !PARSEABLE_STATUSES.includes(item.status)) {
    return null;
  }

  const files = await loadItemFiles(transaction, item.id);
  const target = routingTargetFor(
    ISDOC_DETECTED_TYPE,
    await loadRoutingTargetOverrides(transaction),
  );
  const rules = await loadMatchedLiveRules(transaction, item.id);
  // A refused file keeps no draft, one issue, and no route decision.
  const resolution = parse.ok
    ? resolveIsdoc(parse.parsed, {
        channelEntityId: item.legalEntityId,
        hintEntityId: item.hintLegalEntityId,
        ownEntities: directory.ownEntities,
        partners: directory.partners,
        ruleEntityId:
          rules.find((rule) => rule.setLegalEntityId !== null)
            ?.setLegalEntityId ?? null,
        targetEntityId: target.defaultLegalEntityId,
      })
    : { lineCategory: null, output: failureOutput(parse.failure) };
  let { output } = resolution;
  let routeJob: RouteInboxItemJob | null = null;

  if (parse.ok) {
    const decision = decideParsedAutoRoute({
      ...tenant,
      facts: {
        ...(await loadSenderFacts(transaction, item.id)),
        issuesSinceParsed: output.issues.length > 0,
        latestIssueCount: output.issues.length,
        parsed: {
          draft: parsedIsdocDraftSchema.parse(output.draft),
          legalEntityId: output.legalEntityId ?? null,
        },
      },
      item,
      lineCategory: resolution.lineCategory,
      output,
      primaryFilename: files[0]?.originalFilename ?? null,
      rules,
      target,
    });
    routeJob = decision.routeJob;

    if (decision.reason !== null) {
      output = {
        ...output,
        reasons: [
          ...output.reasons,
          { evidence: decision.reason, step: 'parse', weight: 1 },
        ],
      };
    }
  }

  const stored = storableOutput(output);

  // The parsed entity stays on this row; inbox_item.legal_entity_id is never written by the parse.
  await insertExtraction(
    transaction,
    tenant,
    item.id,
    {
      output: stored,
      provider: ISDOC_PROVIDER,
      providerVersion: ISDOC_PROVIDER_VERSION,
    },
    'extracted',
  );

  return { output: stored, routeJob: stored === output ? routeJob : null };
}

export async function parseInboxItem(
  options: ParseInboxItemOptions,
): Promise<ParseInboxItemOutcome> {
  const payload = parseInboxItemJobSchema.parse(options.data);

  try {
    // Read under the payload's principal first: a demoted uploader fails here, before anything is written.
    const source = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: (transaction) => loadSource(transaction, payload.itemId),
    });

    if (source === null) {
      return finish(options, payload.itemId, {
        kind: 'skipped',
        reason: 'item_unavailable',
      });
    }

    if (!source.clean) {
      return finish(options, payload.itemId, {
        kind: 'skipped',
        reason: 'blob_not_clean',
      });
    }

    // Parsed outside any transaction: attacker bytes never meet a held database connection.
    const parse: IsdocParseResult =
      source.byteSize > MAX_ISDOCX_BYTES
        ? {
            failure: {
              code: 'too_large',
              message: 'The file exceeds the size cap.',
            },
            ok: false,
          }
        : parseIsdocBytes(
            await readCapped(options.blobs.open(source.storageKey)),
          );
    const parties = parse.ok
      ? [parse.parsed.supplier, parse.parsed.customer]
      : [];
    const automation: TenantContext = {
      organizationId: payload.organizationId,
      role: 'member',
      userId: AUTOMATION_SUBJECT,
    };
    const directory: Directory = parse.ok
      ? await runInTenantContext(options.pool, automation, (transaction) =>
          readDirectory(
            transaction,
            nonNull(
              parties.map((party) =>
                normalizeRegistrationNumber(party.registrationNumber),
              ),
            ),
            nonNull(parties.map((party) => party.vatNumber)),
          ),
        )
      : { ownEntities: [], partners: [] };
    const recorded = await runTenantJob({
      data: payload,
      pool: options.pool,
      work: (transaction, _job, tenant) =>
        recordParse(transaction, tenant, payload.itemId, parse, directory),
    });

    if (recorded === null) {
      return finish(options, payload.itemId, {
        kind: 'skipped',
        reason: 'item_unavailable',
      });
    }

    // Sent after the commit, exactly like the scan and the split.
    if (recorded.routeJob !== null) {
      await options.enqueueRouteInboxItem(recorded.routeJob);
    }

    return finish(options, payload.itemId, {
      issues: recorded.output.issues.map((issue) => issue.code),
      kind: 'parsed',
      routed: recorded.routeJob !== null,
    });
  } catch (error) {
    options.metrics.recordJob(PARSE_INBOX_ITEM_QUEUE, 'failed');
    // The principal gate's own messages carry no value; anything else is replaced before the worker logs it.
    const message = error instanceof Error ? error.message : '';
    throw message.startsWith('Job ')
      ? error
      : new Error('parse_inbox_item failed: store_failed');
  }
}

// Ids and issue codes only on the log line: never a party name, an IČO, an amount or XML text.
function finish(
  options: ParseInboxItemOptions,
  itemId: string,
  outcome: ParseInboxItemOutcome,
): ParseInboxItemOutcome {
  options.metrics.recordJob(PARSE_INBOX_ITEM_QUEUE, 'completed');
  const detail =
    outcome.kind === 'skipped'
      ? outcome.reason
      : `${outcome.routed ? 'route queued' : 'review'}; issues ${outcome.issues.join(',') || 'none'}`;
  options.logger.log(
    `Parse inbox item ${itemId}: ${outcome.kind} (${detail})`,
    CONTEXT,
  );

  return outcome;
}
