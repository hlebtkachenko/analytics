// The analytics read: five statements over the stored split, no arithmetic in TypeScript beyond the row counts and the elapsed time.

import { runInTenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { QueryResult, QueryResultRow } from 'pg';

import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import { MAX_ANALYTICS_DOCUMENTS } from './contract.js';
import type {
  AccountNature,
  DocumentAnalyticsResponse,
  DocumentKind,
  DocumentStatus,
  InvoiceLineKind,
  VatMode,
} from './contract.js';
import { entityFilter } from './sql.js';

// Every aggregate reads the same rows: this organization, and only the documents the caller's entity scope allows.
const EVENT_LINE_SOURCE = `from app.economic_event_line as l
          join app.economic_event as e
            on e.id = l.event_id and e.organization_id = l.organization_id`;

// The event stores its own legal entity, so the entity scope costs no join back to the register.
const EVENT_LINE_FILTER = `l.organization_id = $1
            and ($2::uuid[] is null or e.legal_entity_id = any($2::uuid[]))`;

const INVOICE_LINE_SOURCE = `from app.invoice_line as il
          join app.document as d
            on d.id = il.document_id and d.organization_id = il.organization_id`;

const INVOICE_LINE_FILTER = `il.organization_id = $1
            and ($2::uuid[] is null or d.legal_entity_id = any($2::uuid[]))`;

// One pass per grouping answers both sides, so a debit and a credit total never cost two scans.
const DEBIT_SUM = `coalesce(sum(l.amount) filter (where l.side = 'debit'), 0.0000)::text as debit`;
const CREDIT_SUM = `coalesce(sum(l.amount) filter (where l.side = 'credit'), 0.0000)::text as credit`;

// Joining app.invoice is the kind filter: only an invoice kind carries invoice content.
const DOCUMENTS_QUERY = `select d.id,
          d.kind,
          d.reference,
          d.title,
          p.name as partner_name,
          d.document_date::text as document_date,
          d.currency_code,
          i.gross_total::text as gross_total,
          i.advance_total::text as advance_total,
          i.rounding_amount::text as rounding_amount,
          i.amount_due::text as amount_due,
          d.status
     from app.document as d
     join app.invoice as i
       on i.document_id = d.id and i.organization_id = d.organization_id
     left join app.partner as p
       on p.id = d.partner_id and p.organization_id = d.organization_id
    where d.organization_id = $1
      and ($2::uuid[] is null or d.legal_entity_id = any($2::uuid[]))
    order by d.document_date desc, d.id desc
    limit $3`;

const BY_MONTH_QUERY = `select date_trunc('month', l.effective_date)::date::text as month,
          l.account_code,
          a.name_en as account_name,
          ${DEBIT_SUM},
          ${CREDIT_SUM}
     ${EVENT_LINE_SOURCE}
     join app.directive_account as a on a.code = l.account_code
    where ${EVENT_LINE_FILTER}
    group by 1, 2, 3
    order by 1, 2`;

// Profit and loss accounts only: the VAT and payable legs carry the activity too, but they are not the activity's cost.
const BY_ACTIVITY_QUERY = `select l.activity_code,
          ${DEBIT_SUM},
          ${CREDIT_SUM},
          count(*)::int as line_count
     ${EVENT_LINE_SOURCE}
     join app.directive_account as a on a.code = l.account_code
    where ${EVENT_LINE_FILTER}
      and l.activity_code is not null
      and a.nature in ('EXPENSE', 'REVENUE')
    group by 1
    order by 1`;

const BY_VAT_REGIME_QUERY = `select il.line_kind,
          il.vat_mode,
          il.vat_rate::text as vat_rate,
          coalesce(sum(il.base_amount), 0.0000)::text as base_amount,
          coalesce(sum(il.vat_amount), 0.0000)::text as vat_amount,
          count(*)::int as line_count
     ${INVOICE_LINE_SOURCE}
    where ${INVOICE_LINE_FILTER}
    group by 1, 2, 3
    order by 1, 2, 3`;

// The line count rides along with the totals, so the event line count the response reports costs no statement of its own.
const BY_ACCOUNT_QUERY = `select l.account_code,
          a.name_en as account_name,
          a.nature,
          ${DEBIT_SUM},
          ${CREDIT_SUM},
          count(*)::int as line_count
     ${EVENT_LINE_SOURCE}
     join app.directive_account as a on a.code = l.account_code
    where ${EVENT_LINE_FILTER}
    group by 1, 2, 3
    order by 1`;

interface DocumentRow {
  advance_total: string;
  amount_due: string;
  currency_code: string;
  document_date: string;
  gross_total: string;
  id: string;
  kind: string;
  partner_name: string | null;
  reference: string | null;
  rounding_amount: string;
  status: string;
  title: string;
}

interface MonthRow {
  account_code: string;
  account_name: string;
  credit: string;
  debit: string;
  month: string;
}

interface ActivityRow {
  activity_code: string;
  credit: string;
  debit: string;
  line_count: number;
}

interface VatRegimeRow {
  base_amount: string;
  line_count: number;
  line_kind: string;
  vat_amount: string;
  vat_mode: string;
  vat_rate: string;
}

interface AccountRow {
  account_code: string;
  account_name: string;
  credit: string;
  debit: string;
  line_count: number;
  nature: string;
}

export async function readDocumentAnalytics(
  pool: DatabasePool,
  input: EntityScopeSelector,
): Promise<DocumentAnalyticsResponse> {
  return runInTenantContext(pool, input, async (transaction) => {
    const values = [input.organizationId, entityFilter(input.legalEntityIds)];
    let queryCount = 0;
    // Every statement goes through one counter, so the cost the response states is the cost it paid.
    const run = async <Row extends QueryResultRow>(
      text: string,
      parameters: unknown[],
    ): Promise<QueryResult<Row>> => {
      queryCount += 1;
      return transaction.query<Row>(text, parameters);
    };

    const startedAt = performance.now();
    const documents = await run<DocumentRow>(DOCUMENTS_QUERY, [
      ...values,
      MAX_ANALYTICS_DOCUMENTS,
    ]);
    const byMonth = await run<MonthRow>(BY_MONTH_QUERY, values);
    const byActivity = await run<ActivityRow>(BY_ACTIVITY_QUERY, values);
    const byVatRegime = await run<VatRegimeRow>(BY_VAT_REGIME_QUERY, values);
    const byAccount = await run<AccountRow>(BY_ACCOUNT_QUERY, values);
    const elapsedMs = Math.round(performance.now() - startedAt);

    return {
      byAccount: byAccount.rows.map((row) => ({
        accountCode: row.account_code,
        accountName: row.account_name,
        credit: row.credit,
        debit: row.debit,
        nature: row.nature as AccountNature,
      })),
      byActivity: byActivity.rows.map((row) => ({
        activityCode: row.activity_code,
        credit: row.credit,
        debit: row.debit,
        lineCount: row.line_count,
      })),
      byMonth: byMonth.rows.map((row) => ({
        accountCode: row.account_code,
        accountName: row.account_name,
        credit: row.credit,
        debit: row.debit,
        month: row.month,
      })),
      byVatRegime: byVatRegime.rows.map((row) => ({
        baseAmount: row.base_amount,
        lineCount: row.line_count,
        lineKind: row.line_kind as InvoiceLineKind,
        vatAmount: row.vat_amount,
        vatMode: row.vat_mode as VatMode,
        vatRate: row.vat_rate,
      })),
      documents: documents.rows.map((row) => ({
        advanceTotal: row.advance_total,
        amountDue: row.amount_due,
        currencyCode: row.currency_code,
        documentDate: row.document_date,
        grossTotal: row.gross_total,
        id: row.id,
        kind: row.kind as DocumentKind,
        partnerName: row.partner_name,
        reference: row.reference,
        roundingAmount: row.rounding_amount,
        status: row.status as DocumentStatus,
        title: row.title,
      })),
      stats: {
        elapsedMs,
        eventLineCount: byAccount.rows.reduce(
          (total, row) => total + row.line_count,
          0,
        ),
        invoiceLineCount: byVatRegime.rows.reduce(
          (total, row) => total + row.line_count,
          0,
        ),
        queryCount,
      },
    };
  });
}
