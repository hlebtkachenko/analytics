// The analytics read: nine statements over the stored split, no arithmetic in TypeScript beyond the row counts and the elapsed time.

import { runInTenantContext } from '@bap/db';
import type { DatabasePool } from '@bap/db/pool';
import type { QueryResult, QueryResultRow } from 'pg';

import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import {
  ANALYTICS_CHART_MONTHS,
  INVOICE_KINDS,
  MAX_ANALYTICS_DOCUMENTS,
  MAX_ANALYTICS_PARTNERS,
} from './contract.js';
import type {
  AccountNature,
  DocumentAnalyticsResponse,
  DocumentKind,
  DocumentStatus,
  InvoiceLineKind,
  VatMode,
} from './contract.js';
import { VAT_ACCOUNT } from './derivation.js';
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

// A superseded version keeps its invoice content but loses its event, so the invoice reads skip it like the event reads do.
const INVOICE_LINE_FILTER = `il.organization_id = $1
            and ($2::uuid[] is null or d.legal_entity_id = any($2::uuid[]))
            and d.is_current`;

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
      and d.is_current
    order by d.document_date desc, d.id desc
    limit $3`;

// Only an invoice derives an event and a superseded version loses its own, so this counts the invoices the aggregates read.
const DOCUMENT_COUNT_QUERY = `select count(*)::int as document_count
     from app.economic_event as e
     join app.invoice as i
       on i.document_id = e.document_id and i.organization_id = e.organization_id
    where e.organization_id = $1
      and ($2::uuid[] is null or e.legal_entity_id = any($2::uuid[]))`;

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

// The month key is built exactly like BY_MONTH_QUERY's, and the series fills the window's empty months with zero.
// Output and input VAT both post to the VAT account, so its credit minus debit is the month's balance.
const BY_MONTH_TOTALS_QUERY = `with totals as (
     select date_trunc('month', l.effective_date)::date as month,
            coalesce(sum(case when l.side = 'credit' then l.amount else -l.amount end)
              filter (where a.nature = 'REVENUE'), 0.0000) as revenue,
            coalesce(sum(case when l.side = 'debit' then l.amount else -l.amount end)
              filter (where a.nature = 'EXPENSE'), 0.0000) as expense,
            coalesce(sum(case when l.side = 'credit' then l.amount else -l.amount end)
              filter (where l.account_code = $3), 0.0000) as vat_balance
       ${EVENT_LINE_SOURCE}
       join app.directive_account as a on a.code = l.account_code
      where ${EVENT_LINE_FILTER}
      group by 1
   )
   select m.month::date::text as month,
          coalesce(t.revenue, 0.0000)::text as revenue,
          coalesce(t.expense, 0.0000)::text as expense,
          coalesce(t.vat_balance, 0.0000)::text as vat_balance
     from generate_series(
            (select max(month) from totals) - make_interval(months => $4::int - 1),
            (select max(month) from totals),
            interval '1 month'
          ) as m(month)
     left join totals as t on t.month = m.month::date
    order by 1`;

// The current invoices in scope, read from the register like DOCUMENTS_QUERY; every one of them derives the event the charts read.
const CURRENT_INVOICE_FILTER = `d.organization_id = $1
            and ($2::uuid[] is null or d.legal_entity_id = any($2::uuid[]))
            and d.is_current
            and d.kind = any($3::text[])`;

// The printed total per partner.
const BY_PARTNER_QUERY = `select d.partner_id,
          p.name as partner_name,
          coalesce(sum(d.total_amount) filter (where d.kind = 'issued_invoice'), 0.0000)::text as issued,
          coalesce(sum(d.total_amount) filter (where d.kind = 'received_invoice'), 0.0000)::text as received
     from app.document as d
     join app.partner as p
       on p.id = d.partner_id and p.organization_id = d.organization_id
    where ${CURRENT_INVOICE_FILTER}
    group by d.partner_id, p.name
    order by coalesce(sum(d.total_amount), 0) desc, d.partner_id
    limit $4`;

// Event amounts carry no currency, so the currencies of the invoices behind them are the only honest unit label.
const CURRENCY_CODES_QUERY = `select distinct d.currency_code
     from app.document as d
    where ${CURRENT_INVOICE_FILTER}
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

interface DocumentCountRow {
  document_count: number;
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

interface MonthTotalRow {
  expense: string;
  month: string;
  revenue: string;
  vat_balance: string;
}

interface PartnerRow {
  issued: string;
  partner_id: string;
  partner_name: string;
  received: string;
}

interface CurrencyRow {
  currency_code: string;
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
    const documentCount = await run<DocumentCountRow>(
      DOCUMENT_COUNT_QUERY,
      values,
    );
    const byMonth = await run<MonthRow>(BY_MONTH_QUERY, values);
    const byActivity = await run<ActivityRow>(BY_ACTIVITY_QUERY, values);
    const byVatRegime = await run<VatRegimeRow>(BY_VAT_REGIME_QUERY, values);
    const byAccount = await run<AccountRow>(BY_ACCOUNT_QUERY, values);
    const byMonthTotals = await run<MonthTotalRow>(BY_MONTH_TOTALS_QUERY, [
      ...values,
      VAT_ACCOUNT,
      ANALYTICS_CHART_MONTHS,
    ]);
    const byPartner = await run<PartnerRow>(BY_PARTNER_QUERY, [
      ...values,
      INVOICE_KINDS,
      MAX_ANALYTICS_PARTNERS,
    ]);
    const currencyCodes = await run<CurrencyRow>(CURRENCY_CODES_QUERY, [
      ...values,
      INVOICE_KINDS,
    ]);
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
      byMonthTotals: byMonthTotals.rows.map((row) => ({
        expense: row.expense,
        month: row.month,
        revenue: row.revenue,
        vatBalance: row.vat_balance,
      })),
      byPartner: byPartner.rows.map((row) => ({
        issued: row.issued,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        received: row.received,
      })),
      byVatRegime: byVatRegime.rows.map((row) => ({
        baseAmount: row.base_amount,
        lineCount: row.line_count,
        lineKind: row.line_kind as InvoiceLineKind,
        vatAmount: row.vat_amount,
        vatMode: row.vat_mode as VatMode,
        vatRate: row.vat_rate,
      })),
      currencyCodes: currencyCodes.rows.map((row) => row.currency_code),
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
        documentCount: documentCount.rows[0]?.document_count ?? 0,
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
