import {
  BadRequestException,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { PoolClient } from 'pg';

import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import { readDocumentAnalytics } from './analytics-repository.js';
import {
  addDecimal,
  DECIMAL_ZERO,
  formatDecimal,
  parseDecimal,
} from './decimal.js';
import { deriveEconomicEvent, RULE_SET_VERSION } from './derivation.js';
import type { DerivationLine } from './derivation.js';
import { entityFilter, isUniqueViolation, likePattern } from './sql.js';
import type {
  CreateDocumentRequest,
  DirectiveAccount,
  DocumentAnalyticsResponse,
  DocumentDetail,
  DocumentKind,
  DocumentLink,
  DocumentLinkKind,
  DocumentListQuery,
  DocumentListResponse,
  DocumentSummary,
  UpdateDocumentRequest,
} from './contract.js';

export type { EntityScopeSelector };

export interface ListDocumentsInput extends EntityScopeSelector {
  query: DocumentListQuery;
}

export interface ReadDocumentInput extends EntityScopeSelector {
  documentId: string;
}

export interface CreateDocumentInput extends EntityScopeSelector {
  body: CreateDocumentRequest;
}

export interface UpdateDocumentInput extends ReadDocumentInput {
  body: UpdateDocumentRequest;
}

export interface CreateDocumentLinkInput extends ReadDocumentInput {
  kind: DocumentLinkKind;
  toDocumentId: string;
}

export interface DeleteDocumentLinkInput extends ReadDocumentInput {
  linkId: string;
}

interface SummaryRow {
  created_at: Date;
  currency_code: string;
  document_date: string;
  has_event: boolean;
  id: string;
  is_balanced: boolean | null;
  is_current: boolean;
  kind: string;
  legal_entity_id: string;
  open_issue_count: number;
  partner_id: string | null;
  partner_name: string | null;
  reference: string | null;
  source: string;
  status: string;
  title: string;
  total_amount: string | null;
  updated_at: Date;
  valid_from: string | null;
  valid_to: string | null;
  version: number;
}

const SUMMARY_SELECT = `select d.id,
          d.legal_entity_id,
          d.kind,
          d.source,
          d.reference,
          d.title,
          d.partner_id,
          p.name as partner_name,
          d.document_date::text as document_date,
          d.valid_from::text as valid_from,
          d.valid_to::text as valid_to,
          d.currency_code,
          d.total_amount,
          d.status,
          d.version,
          d.is_current,
          e.id is not null as has_event,
          e.is_balanced,
          (select count(*)::int
             from app.data_issue as i
            where i.document_id = d.id and i.resolved_at is null) as open_issue_count,
          d.created_at,
          d.updated_at
     from app.document as d
     left join app.partner as p
       on p.id = d.partner_id and p.organization_id = d.organization_id
     left join app.economic_event as e on e.document_id = d.id`;

// Every list filter is a bound parameter; only the sort column and its direction come from a closed whitelist.
const LIST_FILTER = `($1::uuid[] is null or d.legal_entity_id = any($1::uuid[]))
       and ($2::uuid is null or d.legal_entity_id = $2::uuid)
       and ($3::text[] is null or d.kind = any($3::text[]))
       and ($4::text[] is null or d.status = any($4::text[]))
       and ($5::uuid is null or d.partner_id = $5::uuid)
       and ($6::date is null or d.document_date >= $6::date)
       and ($7::date is null or d.document_date <= $7::date)
       and ($8::text is null
            or d.reference ilike $8
            or d.title ilike $8
            or p.name ilike $8)`;

const SORT_COLUMNS: Readonly<Record<DocumentListQuery['sort'], string>> = {
  createdAt: 'd.created_at',
  documentDate: 'd.document_date',
  reference: 'd.reference',
  title: 'd.title',
  totalAmount: 'd.total_amount',
};

function toSummary(row: SummaryRow): DocumentSummary {
  return {
    createdAt: row.created_at.toISOString(),
    currencyCode: row.currency_code,
    documentDate: row.document_date,
    hasEvent: row.has_event,
    id: row.id,
    isBalanced: row.is_balanced,
    isCurrent: row.is_current,
    kind: row.kind as DocumentSummary['kind'],
    legalEntityId: row.legal_entity_id,
    openIssueCount: row.open_issue_count,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    reference: row.reference,
    source: row.source as DocumentSummary['source'],
    status: row.status as DocumentSummary['status'],
    title: row.title,
    totalAmount: row.total_amount,
    updatedAt: row.updated_at.toISOString(),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    version: row.version,
  };
}

function filterValues(input: ListDocumentsInput): unknown[] {
  const { query } = input;

  return [
    entityFilter(input.legalEntityIds),
    query.legalEntityId ?? null,
    query.kind === undefined ? null : [...query.kind],
    query.status === undefined ? null : [...query.status],
    query.partnerId ?? null,
    query.dateFrom ?? null,
    query.dateTo ?? null,
    query.q === undefined ? null : likePattern(query.q),
  ];
}

export async function listDocuments(
  pool: DatabasePool,
  input: ListDocumentsInput,
): Promise<DocumentListResponse> {
  const { query } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    const values = filterValues(input);
    const totals = await transaction.query<{
      currency_code: string;
      document_count: number;
      total_amount: string;
    }>(
      `select d.currency_code,
              count(*)::int as document_count,
              coalesce(sum(d.total_amount), 0) as total_amount
         from app.document as d
         left join app.partner as p
           on p.id = d.partner_id and p.organization_id = d.organization_id
        where ${LIST_FILTER}
        group by d.currency_code
        order by d.currency_code`,
      values,
    );
    const documents = await transaction.query<SummaryRow>(
      `${SUMMARY_SELECT}
        where ${LIST_FILTER}
        order by ${SORT_COLUMNS[query.sort]} ${query.order === 'asc' ? 'asc' : 'desc'}, d.id desc
        limit $9 offset $10`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize],
    );

    return {
      documents: documents.rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total: totals.rows.reduce((sum, row) => sum + row.document_count, 0),
      totalsByCurrency: totals.rows.map((row) => ({
        currencyCode: row.currency_code,
        totalAmount: row.total_amount,
      })),
    };
  });
}

async function loadSummary(
  transaction: PoolClient,
  documentId: string,
  legalEntityIds: readonly string[] | null,
): Promise<DocumentSummary | null> {
  const result = await transaction.query<SummaryRow>(
    `${SUMMARY_SELECT}
      where d.id = $1
        and ($2::uuid[] is null or d.legal_entity_id = any($2::uuid[]))`,
    [documentId, entityFilter(legalEntityIds)],
  );
  const row = result.rows[0];

  return row === undefined ? null : toSummary(row);
}

async function loadDetail(
  transaction: PoolClient,
  summary: DocumentSummary,
  legalEntityIds: readonly string[] | null,
): Promise<DocumentDetail> {
  const documentId = summary.id;
  const entityIds = entityFilter(legalEntityIds);
  const attributes = await transaction.query<{ key: string; value: string }>(
    'select key, value from app.document_attribute where document_id = $1 order by key',
    [documentId],
  );
  const invoice = await transaction.query<{
    advance_total: string;
    amount_due: string;
    base_total: string;
    due_date: string | null;
    fx_rate: string | null;
    gross_total: string;
    received_date: string | null;
    rounding_amount: string;
    tax_point_date: string | null;
    variable_symbol: string | null;
    vat_total: string;
  }>(
    `select tax_point_date::text as tax_point_date,
            due_date::text as due_date,
            received_date::text as received_date,
            variable_symbol,
            fx_rate::text as fx_rate,
            base_total,
            vat_total,
            gross_total,
            rounding_amount::text as rounding_amount,
            advance_total,
            amount_due::text as amount_due
       from app.invoice
      where document_id = $1`,
    [documentId],
  );
  const invoiceLines = await transaction.query<{
    activity_code: string | null;
    base_amount: string;
    category: string | null;
    description: string;
    id: string;
    line_kind: string;
    line_no: number;
    period_end: string | null;
    period_start: string | null;
    quantity: string | null;
    source_account_code: string | null;
    tax_point_date: string | null;
    unit: string | null;
    unit_price: string | null;
    vat_amount: string;
    vat_mode: string;
    vat_rate: string;
  }>(
    `select id, line_no, line_kind, description, category, quantity, unit, unit_price,
            base_amount, vat_mode, vat_rate, vat_amount, source_account_code,
            tax_point_date::text as tax_point_date,
            period_start::text as period_start,
            period_end::text as period_end,
            activity_code
       from app.invoice_line
      where document_id = $1
      order by line_no`,
    [documentId],
  );
  const event = await transaction.query<{
    credit_total: string;
    debit_total: string;
    derived_at: Date;
    event_date: string;
    id: string;
    is_balanced: boolean;
    rule_set_version: string;
  }>(
    `select id, event_date::text as event_date, rule_set_version, is_balanced,
            debit_total, credit_total, derived_at
       from app.economic_event
      where document_id = $1`,
    [documentId],
  );
  const eventLines = await transaction.query<{
    account_code: string;
    account_name: string;
    activity_code: string | null;
    amount: string;
    description: string | null;
    effective_date: string;
    invoice_line_id: string | null;
    line_no: number;
    partner_id: string | null;
    side: string;
  }>(
    `select l.line_no, l.account_code, a.name_en as account_name, l.side, l.amount,
            l.partner_id, l.invoice_line_id, l.description,
            l.effective_date::text as effective_date,
            l.activity_code
       from app.economic_event_line as l
       join app.directive_account as a on a.code = l.account_code
       join app.economic_event as e on e.id = l.event_id
      where e.document_id = $1
      order by l.line_no`,
    [documentId],
  );
  const issues = await transaction.query<{
    code: string;
    created_at: Date;
    detail: string | null;
    id: string;
    resolved_at: Date | null;
    severity: string;
  }>(
    `select id, code, severity, detail, created_at, resolved_at
       from app.data_issue
      where document_id = $1
      order by created_at, id`,
    [documentId],
  );
  const links = await transaction.query<{
    created_at: Date;
    from_document_id: string;
    id: string;
    kind: string;
    to_document_id: string;
  }>(
    // The far end decides visibility: a link into an entity outside the scope is not shown at all.
    `select l.id, l.from_document_id, l.to_document_id, l.kind, l.created_at
       from app.document_link as l
       join app.document as other
         on other.id = case when l.from_document_id = $1
                            then l.to_document_id
                            else l.from_document_id end
      where (l.from_document_id = $1 or l.to_document_id = $1)
        and ($2::uuid[] is null or other.legal_entity_id = any($2::uuid[]))
      order by l.created_at, l.id`,
    [documentId, entityIds],
  );
  const invoiceRow = invoice.rows[0];
  const eventRow = event.rows[0];

  return {
    attributes: Object.fromEntries(
      attributes.rows.map((row) => [row.key, row.value]),
    ),
    document: summary,
    event:
      eventRow === undefined
        ? null
        : {
            creditTotal: eventRow.credit_total,
            debitTotal: eventRow.debit_total,
            derivedAt: eventRow.derived_at.toISOString(),
            eventDate: eventRow.event_date,
            id: eventRow.id,
            isBalanced: eventRow.is_balanced,
            lines: eventLines.rows.map((row) => ({
              accountCode: row.account_code,
              accountName: row.account_name,
              activityCode: row.activity_code,
              amount: row.amount,
              description: row.description,
              effectiveDate: row.effective_date,
              invoiceLineId: row.invoice_line_id,
              lineNo: row.line_no,
              partnerId: row.partner_id,
              side: row.side as 'credit' | 'debit',
            })),
            ruleSetVersion: eventRow.rule_set_version,
          },
    invoice:
      invoiceRow === undefined
        ? null
        : {
            advanceTotal: invoiceRow.advance_total,
            amountDue: invoiceRow.amount_due,
            baseTotal: invoiceRow.base_total,
            dueDate: invoiceRow.due_date,
            fxRate: invoiceRow.fx_rate,
            grossTotal: invoiceRow.gross_total,
            lines: invoiceLines.rows.map((row) => ({
              activityCode: row.activity_code,
              baseAmount: row.base_amount,
              category: row.category as DerivationLine['category'],
              description: row.description,
              id: row.id,
              lineKind: row.line_kind as DerivationLine['lineKind'],
              lineNo: row.line_no,
              periodEnd: row.period_end,
              periodStart: row.period_start,
              quantity: row.quantity,
              sourceAccountCode: row.source_account_code,
              taxPointDate: row.tax_point_date,
              unit: row.unit,
              unitPrice: row.unit_price,
              vatAmount: row.vat_amount,
              vatMode: row.vat_mode as DerivationLine['vatMode'],
              vatRate: row.vat_rate,
            })),
            receivedDate: invoiceRow.received_date,
            roundingAmount: invoiceRow.rounding_amount,
            taxPointDate: invoiceRow.tax_point_date,
            variableSymbol: invoiceRow.variable_symbol,
            vatTotal: invoiceRow.vat_total,
          },
    issues: issues.rows.map((row) => ({
      code: row.code as DocumentDetail['issues'][number]['code'],
      createdAt: row.created_at.toISOString(),
      detail: row.detail,
      id: row.id,
      resolvedAt:
        row.resolved_at === null ? null : row.resolved_at.toISOString(),
      severity: row.severity as DocumentDetail['issues'][number]['severity'],
    })),
    links: links.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      fromDocumentId: row.from_document_id,
      id: row.id,
      kind: row.kind as DocumentLink['kind'],
      toDocumentId: row.to_document_id,
    })),
  };
}

// Everything derivation needs about the document and its invoice header.
interface DerivationTarget {
  documentDate: string;
  id: string;
  kind: DocumentKind;
  legalEntityId: string;
  partnerId: string | null;
  roundingAmount: string;
  taxPointDate: string | null;
}

// Derived data is rebuildable: every write of an invoice throws the stored event and issues away and derives again.
async function rederive(
  transaction: PoolClient,
  organizationId: string,
  target: DerivationTarget,
  lines: readonly DerivationLine[],
): Promise<void> {
  const derived = deriveEconomicEvent({
    documentDate: target.documentDate,
    kind: target.kind,
    lines,
    partnerId: target.partnerId,
    roundingAmount: target.roundingAmount,
    taxPointDate: target.taxPointDate,
  });

  await transaction.query(
    'delete from app.economic_event where document_id = $1',
    [target.id],
  );
  await transaction.query(
    'delete from app.data_issue where document_id = $1 and resolved_at is null',
    [target.id],
  );

  if (derived === null) {
    return;
  }

  const event = await transaction.query<{ id: string }>(
    `insert into app.economic_event
       (organization_id, legal_entity_id, document_id, event_date, rule_set_version, is_balanced, debit_total, credit_total)
     values ($1, $2, $3, $4::date, $5, $6, $7, $8)
     returning id`,
    [
      organizationId,
      target.legalEntityId,
      target.id,
      // The event date is the document date by rule; no other date feeds it today.
      target.documentDate,
      RULE_SET_VERSION,
      derived.isBalanced,
      derived.debitTotal,
      derived.creditTotal,
    ],
  );
  const eventId = event.rows[0]?.id;

  if (eventId === undefined) {
    throw new Error('The economic event insert returned no row.');
  }

  if (derived.lines.length > 0) {
    await transaction.query(
      `insert into app.economic_event_line
         (organization_id, event_id, line_no, account_code, side, amount, partner_id, invoice_line_id,
          description, effective_date, activity_code)
       select $1, $2, line_no, account_code, side, amount, partner_id, invoice_line_id,
              description, effective_date, activity_code
         from unnest($3::int[], $4::text[], $5::text[], $6::numeric[], $7::uuid[], $8::uuid[], $9::text[],
                     $10::date[], $11::text[])
           as line(line_no, account_code, side, amount, partner_id, invoice_line_id, description,
                   effective_date, activity_code)`,
      [
        organizationId,
        eventId,
        derived.lines.map((line) => line.lineNo),
        derived.lines.map((line) => line.accountCode),
        derived.lines.map((line) => line.side),
        derived.lines.map((line) => line.amount),
        derived.lines.map((line) => line.partnerId),
        derived.lines.map((line) => line.invoiceLineId),
        derived.lines.map((line) => line.description),
        derived.lines.map((line) => line.effectiveDate),
        derived.lines.map((line) => line.activityCode),
      ],
    );
  }

  for (const issue of derived.issues) {
    await transaction.query(
      `insert into app.data_issue (organization_id, document_id, code, severity, detail)
       values ($1, $2, $3, $4, $5)`,
      [organizationId, target.id, issue.code, issue.severity, issue.detail],
    );
  }
}

// Everything derivation reads from the stored invoice, which an update needs because the patch never carries it.
async function loadDerivationInput(
  transaction: PoolClient,
  documentId: string,
): Promise<{
  lines: DerivationLine[];
  roundingAmount: string;
  taxPointDate: string | null;
}> {
  const header = await transaction.query<{
    rounding_amount: string;
    tax_point_date: string | null;
  }>(
    `select rounding_amount::text as rounding_amount, tax_point_date::text as tax_point_date
       from app.invoice
      where document_id = $1`,
    [documentId],
  );
  const lines = await transaction.query<{
    activity_code: string | null;
    base_amount: string;
    category: string | null;
    description: string;
    id: string;
    line_kind: string;
    tax_point_date: string | null;
    vat_amount: string;
    vat_mode: string;
    vat_rate: string;
  }>(
    `select id, line_kind, description, category, base_amount, vat_mode, vat_rate, vat_amount,
            tax_point_date::text as tax_point_date,
            activity_code
       from app.invoice_line
      where document_id = $1
      order by line_no`,
    [documentId],
  );
  const headerRow = header.rows[0];

  // Only a document that already carries an event is rederived, and every such document is an invoice.
  if (headerRow === undefined) {
    throw new Error('The rederived document carries no invoice row.');
  }

  return {
    lines: lines.rows.map((row) => ({
      activityCode: row.activity_code,
      baseAmount: row.base_amount,
      category: row.category as DerivationLine['category'],
      description: row.description,
      id: row.id,
      lineKind: row.line_kind as DerivationLine['lineKind'],
      taxPointDate: row.tax_point_date,
      vatAmount: row.vat_amount,
      vatMode: row.vat_mode as DerivationLine['vatMode'],
      vatRate: row.vat_rate,
    })),
    roundingAmount: headerRow.rounding_amount,
    taxPointDate: headerRow.tax_point_date,
  };
}

async function writeAttributes(
  transaction: PoolClient,
  organizationId: string,
  documentId: string,
  attributes: Record<string, string>,
): Promise<void> {
  // The attribute map in the request is the whole truth, so the stored rows are replaced wholesale.
  await transaction.query(
    'delete from app.document_attribute where document_id = $1',
    [documentId],
  );

  const entries = Object.entries(attributes);

  if (entries.length === 0) {
    return;
  }

  await transaction.query(
    `insert into app.document_attribute (document_id, organization_id, key, value)
     select $1, $2, key, value
       from unnest($3::text[], $4::text[]) as attribute(key, value)`,
    [
      documentId,
      organizationId,
      entries.map(([key]) => key),
      entries.map(([, value]) => value),
    ],
  );
}

// Returns null when the legal entity or the partner is absent or out of scope, so a stranger learns nothing.
export async function createDocument(
  pool: DatabasePool,
  input: CreateDocumentInput,
): Promise<DocumentDetail | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    const entity = await transaction.query(
      `select 1
         from app.legal_entity
        where id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [body.legalEntityId, entityFilter(input.legalEntityIds)],
    );

    if (entity.rowCount === 0) {
      return null;
    }

    if (body.partnerId !== undefined) {
      const partner = await transaction.query(
        'select 1 from app.partner where id = $1',
        [body.partnerId],
      );

      if (partner.rowCount === 0) {
        return null;
      }
    }

    let baseTotal = DECIMAL_ZERO;
    let vatTotal = DECIMAL_ZERO;
    let advanceTotal = DECIMAL_ZERO;

    for (const line of body.invoice?.lines ?? []) {
      const base = parseDecimal(line.baseAmount);
      const vat = parseDecimal(line.vatAmount);

      // The three totals are the supply value of the invoice, so a deduction line feeds the advance total instead.
      if (line.lineKind === 'advance_deduction') {
        advanceTotal = addDecimal(advanceTotal, addDecimal(base, vat));
        continue;
      }

      baseTotal = addDecimal(baseTotal, base);
      vatTotal = addDecimal(vatTotal, vat);
    }

    const grossTotal = addDecimal(baseTotal, vatTotal);
    const roundingAmount = parseDecimal(body.invoice?.roundingAmount ?? '0');
    // What the paper says to pay before the advance is deducted; the database generates the amount due from it.
    const invoiceTotal = addDecimal(grossTotal, roundingAmount);
    const created = await transaction.query<{ id: string }>(
      `insert into app.document
         (organization_id, legal_entity_id, kind, reference, title, partner_id, document_date,
          valid_from, valid_to, currency_code, total_amount, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9::date, $10, $11, $12, $13)
       returning id`,
      [
        input.organizationId,
        body.legalEntityId,
        body.kind,
        body.reference ?? null,
        body.title,
        body.partnerId ?? null,
        body.documentDate,
        body.validFrom ?? null,
        body.validTo ?? null,
        body.currencyCode,
        // Invoice totals are computed from the lines, so a client value is only used when there is no invoice.
        body.invoice === undefined
          ? (body.totalAmount ?? null)
          : formatDecimal(invoiceTotal),
        body.notes ?? null,
        input.userId,
      ],
    );
    const documentId = created.rows[0]?.id;

    if (documentId === undefined) {
      throw new Error('The document insert returned no row.');
    }

    await writeAttributes(
      transaction,
      input.organizationId,
      documentId,
      body.attributes ?? {},
    );

    const lines = body.invoice?.lines ?? [];
    const derivationLines: DerivationLine[] = [];

    if (body.invoice !== undefined) {
      // amount_due is generated and stored by the database, so it is never in this column list.
      await transaction.query(
        `insert into app.invoice
           (document_id, organization_id, tax_point_date, due_date, received_date, variable_symbol, fx_rate,
            base_total, vat_total, gross_total, rounding_amount, advance_total)
         values ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)`,
        [
          documentId,
          input.organizationId,
          body.invoice.taxPointDate ?? null,
          body.invoice.dueDate ?? null,
          body.invoice.receivedDate ?? null,
          body.invoice.variableSymbol ?? null,
          body.invoice.fxRate ?? null,
          formatDecimal(baseTotal),
          formatDecimal(vatTotal),
          formatDecimal(grossTotal),
          formatDecimal(roundingAmount),
          formatDecimal(advanceTotal),
        ],
      );

      const inserted = await transaction.query<{
        id: string;
        line_no: number;
      }>(
        `insert into app.invoice_line
           (organization_id, document_id, line_no, description, category, quantity, unit, unit_price,
            base_amount, vat_mode, vat_rate, vat_amount, source_account_code,
            line_kind, tax_point_date, period_start, period_end, activity_code)
         select $1, $2, line_no, description, category, quantity, unit, unit_price,
                base_amount, vat_mode, vat_rate, vat_amount, source_account_code,
                line_kind, tax_point_date, period_start, period_end, activity_code
           from unnest($3::int[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::numeric[],
                       $9::numeric[], $10::text[], $11::numeric[], $12::numeric[], $13::text[],
                       $14::text[], $15::date[], $16::date[], $17::date[], $18::text[])
             as line(line_no, description, category, quantity, unit, unit_price,
                     base_amount, vat_mode, vat_rate, vat_amount, source_account_code,
                     line_kind, tax_point_date, period_start, period_end, activity_code)
         returning id, line_no`,
        [
          input.organizationId,
          documentId,
          lines.map((_line, index) => index + 1),
          lines.map((line) => line.description),
          lines.map((line) => line.category ?? null),
          lines.map((line) => line.quantity ?? null),
          lines.map((line) => line.unit ?? null),
          lines.map((line) => line.unitPrice ?? null),
          lines.map((line) => line.baseAmount),
          lines.map((line) => line.vatMode),
          lines.map((line) => line.vatRate),
          lines.map((line) => line.vatAmount),
          lines.map((line) => line.sourceAccountCode ?? null),
          lines.map((line) => line.lineKind),
          lines.map((line) => line.taxPointDate ?? null),
          lines.map((line) => line.periodStart ?? null),
          lines.map((line) => line.periodEnd ?? null),
          lines.map((line) => line.activityCode ?? null),
        ],
      );

      // The generated identifiers come back with their line numbers, so derivation needs no second read.
      for (const row of [...inserted.rows].sort(
        (left, right) => left.line_no - right.line_no,
      )) {
        const line = lines[row.line_no - 1];

        if (line === undefined) {
          throw new Error('The invoice line insert returned an unknown line.');
        }

        derivationLines.push({
          activityCode: line.activityCode ?? null,
          baseAmount: line.baseAmount,
          category: line.category ?? null,
          description: line.description,
          id: row.id,
          lineKind: line.lineKind,
          taxPointDate: line.taxPointDate ?? null,
          vatAmount: line.vatAmount,
          vatMode: line.vatMode,
          vatRate: line.vatRate,
        });
      }
    }

    await rederive(
      transaction,
      input.organizationId,
      {
        documentDate: body.documentDate,
        id: documentId,
        kind: body.kind,
        legalEntityId: body.legalEntityId,
        partnerId: body.partnerId ?? null,
        roundingAmount: body.invoice?.roundingAmount ?? '0',
        taxPointDate: body.invoice?.taxPointDate ?? null,
      },
      derivationLines,
    );
    // Identifiers and the kind only: the audit log never carries the title, the notes or an amount.
    await transaction.query(
      "select app.record_audit('document.created', 'document', $1, $2::jsonb)",
      [
        documentId,
        JSON.stringify({
          kind: body.kind,
          legalEntityId: body.legalEntityId,
        }),
      ],
    );

    const summary = await loadSummary(
      transaction,
      documentId,
      input.legalEntityIds,
    );

    if (summary === null) {
      throw new Error('The created document is not readable in its own scope.');
    }

    return loadDetail(transaction, summary, input.legalEntityIds);
  });
}

export async function readDocument(
  pool: DatabasePool,
  input: ReadDocumentInput,
): Promise<DocumentDetail | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    const summary = await loadSummary(
      transaction,
      input.documentId,
      input.legalEntityIds,
    );

    return summary === null
      ? null
      : loadDetail(transaction, summary, input.legalEntityIds);
  });
}

export async function updateDocument(
  pool: DatabasePool,
  input: UpdateDocumentInput,
): Promise<DocumentDetail | null> {
  const { body } = input;

  return runInTenantContext(pool, input, async (transaction) => {
    const before = await loadSummary(
      transaction,
      input.documentId,
      input.legalEntityIds,
    );

    if (before === null) {
      return null;
    }

    // The pair inside the body is checked by the schema; this is the pair the stored row would end up with.
    const validFrom =
      body.validFrom === undefined ? before.validFrom : body.validFrom;
    const validTo = body.validTo === undefined ? before.validTo : body.validTo;

    if (validFrom !== null && validTo !== null && validFrom > validTo) {
      throw new BadRequestException();
    }

    if (body.partnerId !== undefined && body.partnerId !== null) {
      const partner = await transaction.query(
        'select 1 from app.partner where id = $1',
        [body.partnerId],
      );

      if (partner.rowCount === 0) {
        return null;
      }
    }

    const updated = await transaction.query(
      `update app.document
          set title = coalesce($2, title),
              reference = case when $3 then $4 else reference end,
              partner_id = case when $5 then $6::uuid else partner_id end,
              document_date = coalesce($7::date, document_date),
              valid_from = case when $8 then $9::date else valid_from end,
              valid_to = case when $10 then $11::date else valid_to end,
              status = coalesce($12, status),
              notes = case when $13 then $14 else notes end,
              updated_at = now()
        where id = $1`,
      [
        input.documentId,
        body.title ?? null,
        body.reference !== undefined,
        body.reference ?? null,
        body.partnerId !== undefined,
        body.partnerId ?? null,
        body.documentDate ?? null,
        body.validFrom !== undefined,
        body.validFrom ?? null,
        body.validTo !== undefined,
        body.validTo ?? null,
        body.status ?? null,
        body.notes !== undefined,
        body.notes ?? null,
      ],
    );

    // The member role holds no write capability, so a policy-blocked update matches no row.
    if (updated.rowCount === 0) {
      return null;
    }

    if (body.attributes !== undefined) {
      await writeAttributes(
        transaction,
        input.organizationId,
        input.documentId,
        body.attributes,
      );
    }

    const after = await loadSummary(
      transaction,
      input.documentId,
      input.legalEntityIds,
    );

    if (after === null) {
      return null;
    }

    // The partner rides on the receivable and payable lines and the document date is the event date, so both stale the event.
    if (
      before.hasEvent &&
      (after.partnerId !== before.partnerId ||
        after.documentDate !== before.documentDate)
    ) {
      // The invoice header rides along, or a patch would drop the rounding legs and the invoice-level tax point.
      const invoice = await loadDerivationInput(transaction, input.documentId);

      await rederive(
        transaction,
        input.organizationId,
        {
          documentDate: after.documentDate,
          id: after.id,
          kind: after.kind,
          legalEntityId: after.legalEntityId,
          partnerId: after.partnerId,
          roundingAmount: invoice.roundingAmount,
          taxPointDate: invoice.taxPointDate,
        },
        invoice.lines,
      );
    }

    await transaction.query(
      "select app.record_audit('document.updated', 'document', $1, $2::jsonb)",
      [input.documentId, JSON.stringify({ fields: Object.keys(body).sort() })],
    );

    return loadDetail(transaction, after, input.legalEntityIds);
  });
}

// The derived event, its lines, the issues, the content and the links go with the document: the foreign keys cascade.
export async function deleteDocument(
  pool: DatabasePool,
  input: ReadDocumentInput,
): Promise<boolean> {
  return runInTenantContext(pool, input, async (transaction) => {
    const removed = await transaction.query(
      `delete from app.document
        where id = $1
          and ($2::uuid[] is null or legal_entity_id = any($2::uuid[]))`,
      [input.documentId, entityFilter(input.legalEntityIds)],
    );

    if (removed.rowCount === 0) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('document.deleted', 'document', $1, '{}'::jsonb)",
      [input.documentId],
    );
    return true;
  });
}

export async function createDocumentLink(
  pool: DatabasePool,
  input: CreateDocumentLinkInput,
): Promise<DocumentLink | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    // Both ends must be visible in the caller's scope, or the link would leak the existence of the other document.
    const visible = await transaction.query<{ total: number }>(
      `select count(*)::int as total
         from app.document
        where id = any($1::uuid[])
          and ($2::uuid[] is null or legal_entity_id = any($2::uuid[]))`,
      [
        [input.documentId, input.toDocumentId],
        entityFilter(input.legalEntityIds),
      ],
    );

    if (visible.rows[0]?.total !== 2) {
      return null;
    }

    const created = await transaction.query<{
      created_at: Date;
      from_document_id: string;
      id: string;
      kind: string;
      to_document_id: string;
    }>(
      `insert into app.document_link (organization_id, from_document_id, to_document_id, kind, created_by)
       values ($1, $2, $3, $4, $5)
       returning id, from_document_id, to_document_id, kind, created_at`,
      [
        input.organizationId,
        input.documentId,
        input.toDocumentId,
        input.kind,
        input.userId,
      ],
    );
    const row = created.rows[0];

    if (row === undefined) {
      throw new Error('The document link insert returned no row.');
    }

    await transaction.query(
      "select app.record_audit('document.linked', 'document', $1, $2::jsonb)",
      [input.documentId, JSON.stringify({ kind: input.kind })],
    );
    return {
      createdAt: row.created_at.toISOString(),
      fromDocumentId: row.from_document_id,
      id: row.id,
      kind: row.kind as DocumentLink['kind'],
      toDocumentId: row.to_document_id,
    };
  });
}

export async function deleteDocumentLink(
  pool: DatabasePool,
  input: DeleteDocumentLinkInput,
): Promise<boolean> {
  return runInTenantContext(pool, input, async (transaction) => {
    // A link is removable from either end, and the document in the path is the one the scope is checked on.
    const removed = await transaction.query(
      `delete from app.document_link as l
        using app.document as d
        where l.id = $1
          and (l.from_document_id = $2 or l.to_document_id = $2)
          and d.id = $2
          and ($3::uuid[] is null or d.legal_entity_id = any($3::uuid[]))`,
      [input.linkId, input.documentId, entityFilter(input.legalEntityIds)],
    );

    if (removed.rowCount === 0) {
      return false;
    }

    await transaction.query(
      "select app.record_audit('document.unlinked', 'document', $1, '{}'::jsonb)",
      [input.documentId],
    );
    return true;
  });
}

// The whole directive chart is a shared reference list without row level security; it is the same for every tenant.
export async function listDirectiveAccounts(
  pool: DatabasePool,
  input: TenantContext,
): Promise<DirectiveAccount[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<{
      class: number;
      code: string;
      group_code: string;
      name_cs: string;
      name_en: string;
      nature: string;
    }>(
      `select code, group_code, class, name_cs, name_en, nature
         from app.directive_account
        order by code`,
      [],
    );

    return result.rows.map((row) => ({
      class: row.class,
      code: row.code,
      groupCode: row.group_code,
      nameCs: row.name_cs,
      nameEn: row.name_en,
      nature: row.nature as DirectiveAccount['nature'],
    }));
  });
}

// The unique (from, to, kind) constraint is the only conflict a well-formed link body can hit.
export function isDuplicateDocumentLink(error: unknown): boolean {
  return isUniqueViolation(error, 'document_link_unique');
}

// The partial unique index on (legal_entity_id, kind, reference) for current documents.
export function isDuplicateDocumentReference(error: unknown): boolean {
  return isUniqueViolation(error, 'document_current_reference_key');
}

export abstract class DocumentRepository {
  abstract createDocument(
    input: CreateDocumentInput,
  ): Promise<DocumentDetail | null>;
  abstract createLink(
    input: CreateDocumentLinkInput,
  ): Promise<DocumentLink | null>;
  abstract deleteDocument(input: ReadDocumentInput): Promise<boolean>;
  abstract deleteLink(input: DeleteDocumentLinkInput): Promise<boolean>;
  abstract listDirectiveAccounts(
    input: TenantContext,
  ): Promise<DirectiveAccount[]>;
  abstract listDocuments(
    input: ListDocumentsInput,
  ): Promise<DocumentListResponse>;
  abstract readAnalytics(
    input: EntityScopeSelector,
  ): Promise<DocumentAnalyticsResponse>;
  abstract readDocument(
    input: ReadDocumentInput,
  ): Promise<DocumentDetail | null>;
  abstract updateDocument(
    input: UpdateDocumentInput,
  ): Promise<DocumentDetail | null>;
}

@Injectable()
export class DatabaseDocumentRepository
  extends DocumentRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async createDocument(
    input: CreateDocumentInput,
  ): Promise<DocumentDetail | null> {
    return createDocument(await this.getPool(), input);
  }

  async createLink(
    input: CreateDocumentLinkInput,
  ): Promise<DocumentLink | null> {
    return createDocumentLink(await this.getPool(), input);
  }

  async deleteDocument(input: ReadDocumentInput): Promise<boolean> {
    return deleteDocument(await this.getPool(), input);
  }

  async deleteLink(input: DeleteDocumentLinkInput): Promise<boolean> {
    return deleteDocumentLink(await this.getPool(), input);
  }

  async listDirectiveAccounts(
    input: TenantContext,
  ): Promise<DirectiveAccount[]> {
    return listDirectiveAccounts(await this.getPool(), input);
  }

  async listDocuments(
    input: ListDocumentsInput,
  ): Promise<DocumentListResponse> {
    return listDocuments(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async readAnalytics(
    input: EntityScopeSelector,
  ): Promise<DocumentAnalyticsResponse> {
    return readDocumentAnalytics(await this.getPool(), input);
  }

  async readDocument(input: ReadDocumentInput): Promise<DocumentDetail | null> {
    return readDocument(await this.getPool(), input);
  }

  async updateDocument(
    input: UpdateDocumentInput,
  ): Promise<DocumentDetail | null> {
    return updateDocument(await this.getPool(), input);
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
