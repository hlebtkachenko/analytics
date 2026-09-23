'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import { Stack, Tag } from '@bap/design-system/react';
import { useTranslation } from 'react-i18next';

import {
  decimalUnits,
  formatDecimalUnits,
} from '../../lib/documents/contract.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { parsedIsdocDraftSchema } from '../../lib/inbox/contract.ts';
import type { InboxExtraction } from '../../lib/inbox/contract.ts';
import { inboxIssueCodeLabelKeys } from '../../lib/inbox/labels.ts';
import styles from './parsed-invoice-summary.module.scss';

export type ParsedInvoice = NonNullable<
  ReturnType<typeof parsedIsdocDraftSchema.parse>['invoice']
>;

// The invoice block of a parsed row, or undefined when the row carries none, as for a credit note.
export function parsedInvoiceOf(
  parsed: InboxExtraction | null,
): ParsedInvoice | undefined {
  const result = parsedIsdocDraftSchema.safeParse(parsed?.draft);
  return result.success ? (result.data.invoice ?? undefined) : undefined;
}

const units = (value: string): bigint => decimalUnits(value) ?? 0n;

// The newest ISDOC row read back for a person: lines and deductions, totals, issues, and the unverified signature.
export default function ParsedInvoiceSummary({
  currencyCode,
  parsed,
}: Readonly<{ currencyCode: string; parsed: InboxExtraction }>) {
  const { t } = useTranslation();
  const invoice = parsedInvoiceOf(parsed);
  const totalAmount = parsed.draft['totalAmount'];

  const columns: GridColumn[] = [
    {
      header: t('documents.lineDescription'),
      key: 'description',
      renderCell: (row) => (
        <span className={styles.lineCell!}>
          <span>{row['description']}</span>
          {row['marker'] === 'advance' ? (
            <Tag size="sm" type="gray">
              {t('documents.lineKindAdvanceDeduction')}
            </Tag>
          ) : null}
        </span>
      ),
    },
    { align: 'end', header: t('documents.lineQuantity'), key: 'quantity' },
    { align: 'end', header: t('documents.lineUnitPrice'), key: 'unitPrice' },
    { align: 'end', header: t('documents.detail.vatColumn'), key: 'vat' },
    { align: 'end', header: t('documents.columnTotal'), key: 'total' },
  ];

  // A deduction is parsed non negative, so it is negated to sum to the amount due.
  const signed = (invoice?.lines ?? []).map((line) => {
    const sign = line.lineKind === 'advance_deduction' ? -1n : 1n;
    const vat = sign * units(line.vatAmount);
    return { line, sign, total: sign * units(line.baseAmount) + vat, vat };
  });
  const vatTotal = signed.reduce((sum, entry) => sum + entry.vat, 0n);
  const amountDue = signed.reduce(
    (sum, entry) => sum + entry.total,
    units(invoice?.roundingAmount ?? '0'),
  );
  const rows: GridRow[] = signed.map(({ line, sign, total, vat }, index) => {
    return {
      description: line.description,
      id: String(index),
      marker: sign < 0n ? 'advance' : '',
      quantity:
        line.quantity === undefined
          ? ''
          : [line.quantity, line.unit].filter(Boolean).join(' '),
      total: formatMoney(formatDecimalUnits(total), currencyCode),
      unitPrice:
        line.unitPrice === undefined
          ? ''
          : formatMoney(line.unitPrice, currencyCode),
      vat: formatMoney(formatDecimalUnits(vat), currencyCode),
    };
  });
  if (invoice !== undefined && units(invoice.roundingAmount) !== 0n) {
    rows.push({
      description: t('documents.totalRounding'),
      id: 'rounding',
      marker: '',
      quantity: '',
      total: formatMoney(invoice.roundingAmount, currencyCode),
      unitPrice: '',
      vat: '',
    });
  }

  const facts = [
    invoice?.taxPointDate === undefined
      ? null
      : `${t('documents.fieldTaxPointDate')}: ${formatDate(invoice.taxPointDate)}`,
    invoice?.dueDate === undefined
      ? null
      : `${t('documents.fieldDueDate')}: ${formatDate(invoice.dueDate)}`,
    invoice?.variableSymbol === undefined
      ? null
      : `${t('documents.fieldVariableSymbol')}: ${invoice.variableSymbol}`,
    invoice === undefined && typeof totalAmount === 'string'
      ? `${t('documents.columnTotal')}: ${formatMoney(totalAmount, currencyCode)}`
      : null,
  ].filter((fact) => fact !== null);

  return (
    <Stack gap={4}>
      <p className={styles.note!}>{t('inbox.item.parsedSignatureNote')}</p>
      {facts.length === 0 ? null : (
        <ul aria-label={t('inbox.item.parsedFacts')}>
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {parsed.issues.length === 0 ? null : (
        <ul aria-label={t('inbox.item.parsedIssues')}>
          {parsed.issues.map((issue, index) => (
            <li key={`${String(index)}-${issue.code}`}>
              {t(inboxIssueCodeLabelKeys[issue.code])}{' '}
              <span className={styles.note!}>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      {parsed.reasons.length === 0 ? null : (
        <ul aria-label={t('inbox.item.parsedReasons')}>
          {parsed.reasons.map((reason, index) => (
            <li
              className={styles.note!}
              key={`${String(index)}-${reason.evidence}`}
            >
              {reason.evidence}
            </li>
          ))}
        </ul>
      )}
      {invoice === undefined ? null : (
        <DataGrid
          ariaLabel={t('inbox.item.parsedLines')}
          columns={columns}
          fitContainer
          rows={rows}
          totalsRow={{
            description: t('documents.totalAmountDue'),
            total: formatMoney(formatDecimalUnits(amountDue), currencyCode),
            vat: formatMoney(formatDecimalUnits(vatTotal), currencyCode),
          }}
        />
      )}
    </Stack>
  );
}
