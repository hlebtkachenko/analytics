'use client';

import {
  Button,
  Column,
  DatePicker,
  DatePickerInput,
  Form,
  Grid,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListRow,
  StructuredListWrapper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  TextInput,
} from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { ReactElement } from 'react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PartnerPicker from '../../../../components/documents/partner-picker';
import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import {
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
} from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';
import {
  documentsPath,
  optional,
  sendJson,
  withOrganization,
} from '../../../../lib/documents/client';
import {
  createDocumentRequestSchema,
  decimalUnits,
  derivedVatAmount,
  documentDetailSchema,
  documentKindSchema,
  formatDecimalUnits,
  grossUnits,
  invoiceLineCategorySchema,
  invoiceLineKindSchema,
  isInvoiceKind,
  vatModeSchema,
} from '../../../../lib/documents/contract.ts';
import type {
  DocumentKind,
  InvoiceLineCategory,
  InvoiceLineKind,
  NewDocument,
  VatMode,
} from '../../../../lib/documents/contract.ts';
import {
  documentKindLabelKeys,
  invoiceLineCategoryLabelKeys,
  invoiceLineKindLabelKeys,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import { formatMoney, isoDay } from '../../../../lib/format.ts';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LineDraft = Readonly<{
  activityCode: string;
  baseAmount: string;
  // An advance deduction line sends no category, but the draft always holds a real one.
  category: InvoiceLineCategory;
  description: string;
  key: string;
  lineKind: InvoiceLineKind;
  periodEnd: string;
  periodStart: string;
  quantity: string;
  taxPointDate: string;
  unitPrice: string;
  vatAmount: string;
  vatEdited: boolean;
  vatMode: VatMode;
  vatRate: string;
}>;

let nextLineKey = 0;

function emptyLine(): LineDraft {
  nextLineKey += 1;
  return {
    activityCode: '',
    baseAmount: '',
    category: 'services',
    description: '',
    key: `line-${String(nextLineKey)}`,
    lineKind: 'item',
    periodEnd: '',
    periodStart: '',
    quantity: '',
    taxPointDate: '',
    unitPrice: '',
    vatAmount: '0',
    vatEdited: false,
    vatMode: 'standard',
    vatRate: '21',
  };
}

// Select values come from the contract's own option lists, so an unknown value falls back.
function asKind(value: string): DocumentKind {
  const parsed = documentKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'other';
}

function asCategory(value: string): InvoiceLineCategory {
  const parsed = invoiceLineCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : 'services';
}

function asLineKind(value: string): InvoiceLineKind {
  const parsed = invoiceLineKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'item';
}

function asVatMode(value: string): VatMode {
  const parsed = vatModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'standard';
}

// The VAT a standard line carries, computed by the contract's own integer rounding.
function derivedVat(line: LineDraft): string {
  return line.vatMode === 'standard'
    ? (derivedVatAmount(line.baseAmount, line.vatRate) ?? '0')
    : '0';
}

// The one date control the form uses, so every document date reads and commits the same way.
function DateField({
  id,
  labelText,
  onChange,
}: Readonly<{
  id: string;
  labelText: string;
  onChange: (value: string) => void;
}>): ReactElement {
  return (
    <DatePicker
      datePickerType="single"
      dateFormat="Y-m-d"
      onChange={(dates: Date[]) => {
        onChange(isoDay(dates[0]));
      }}
    >
      {/* The default Carbon pattern is m/d/Y, which rejects the Y-m-d value and blocks
          the form's native validation; the ISO pattern matches the picker's format. */}
      <DatePickerInput
        id={id}
        labelText={labelText}
        pattern="\d{4}-\d{2}-\d{2}"
        placeholder="yyyy-mm-dd"
      />
    </DatePicker>
  );
}

export default function NewDocumentPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { notify } = useToast();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [legalEntityId, setLegalEntityId] = useState('');
  const [kind, setKind] = useState<DocumentKind>('received_invoice');
  const [title, setTitle] = useState('');
  const [reference, setReference] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState('CZK');
  const [notes, setNotes] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [taxPointDate, setTaxPointDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [variableSymbol, setVariableSymbol] = useState('');
  const [roundingAmount, setRoundingAmount] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(legalEntitiesPath(organizationId), controller.signal)
      .then((payload) => legalEntityListSchema.parse(payload))
      .then((payload) => {
        setLegalEntities(payload.legalEntities);
        setLegalEntityId((current) =>
          current.length > 0 ? current : (payload.legalEntities[0]?.id ?? ''),
        );
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setLegalEntities([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId]);

  const invoiceKind = isInvoiceKind(kind);
  // The preview adds the very decimal strings the request carries, so no float touches money.
  const previewGross = grossUnits(lines, 'item');
  const previewAdvance = grossUnits(lines, 'advance_deduction');
  const previewRounding = decimalUnits(roundingAmount) ?? 0n;
  const previewAmountDue = previewGross + previewRounding - previewAdvance;

  // Each section carries a Complete or Missing tag from the fields it owns.
  const whereComplete = legalEntityId.length > 0;
  const documentComplete =
    title.trim().length > 0 && documentDate.trim().length > 0;
  const linesComplete = lines.every(
    (line) =>
      line.description.trim().length > 0 && line.baseAmount.trim().length > 0,
  );

  function sectionTag(complete: boolean): ReactElement {
    return complete ? (
      <Tag size="sm" type="green">
        {t('documents.new.tagComplete')}
      </Tag>
    ) : (
      <Tag size="sm" type="gray">
        {t('documents.new.tagMissing')}
      </Tag>
    );
  }

  function previewAmount(units: bigint): string {
    return formatMoney(formatDecimalUnits(units), currencyCode);
  }

  function updateLine(index: number, patch: Partial<LineDraft>): void {
    setLines((current) =>
      current.map((line, position) => {
        if (position !== index) {
          return line;
        }
        const next = { ...line, ...patch };
        // A deducted advance takes its dates from the invoice it settles, so the line drops its own.
        if (patch.lineKind === 'advance_deduction') {
          next.periodEnd = '';
          next.periodStart = '';
          next.taxPointDate = '';
        }
        // Only a standard line carries VAT, and only an edited amount survives a recompute.
        if (next.vatMode !== 'standard') {
          // Exempt and outside-scope supplies carry no rate either, reverse charge keeps one.
          const vatRate =
            next.vatMode === 'reverse_charge' ? next.vatRate : '0';
          return { ...next, vatAmount: '0', vatEdited: false, vatRate };
        }
        return patch.vatAmount === undefined
          ? {
              ...next,
              vatAmount: next.vatEdited ? next.vatAmount : derivedVat(next),
            }
          : next;
      }),
    );
  }

  function requestBody(): NewDocument {
    return {
      currencyCode,
      documentDate,
      invoice: invoiceKind
        ? {
            dueDate: optional(dueDate),
            lines: lines.map((line) => ({
              activityCode: optional(line.activityCode),
              baseAmount: line.baseAmount,
              description: line.description,
              lineKind: line.lineKind,
              quantity: optional(line.quantity),
              unitPrice: optional(line.unitPrice),
              vatAmount: line.vatAmount,
              vatMode: line.vatMode,
              vatRate: line.vatRate,
              // A deducted advance carries no category and books on the tax point of this invoice.
              ...(line.lineKind === 'item'
                ? {
                    category: line.category,
                    periodEnd: optional(line.periodEnd),
                    periodStart: optional(line.periodStart),
                    taxPointDate: optional(line.taxPointDate),
                  }
                : {}),
            })),
            receivedDate: optional(receivedDate),
            roundingAmount: optional(roundingAmount),
            taxPointDate: optional(taxPointDate),
            variableSymbol: optional(variableSymbol),
          }
        : undefined,
      kind,
      legalEntityId,
      notes: optional(notes),
      partnerId: optional(partnerId),
      reference: optional(reference),
      title,
    };
  }

  async function submit(): Promise<void> {
    const parsed = createDocumentRequestSchema.safeParse(requestBody());

    if (!parsed.success) {
      setInvalid(true);
      setFailed(false);
      return;
    }

    setInvalid(false);
    setFailed(false);
    setSubmitting(true);

    try {
      const detail = await sendJson(
        {
          body: parsed.data,
          method: 'POST',
          path: documentsPath(organizationId),
        },
        documentDetailSchema,
      );
      notify({ kind: 'success', title: t('documents.created') });
      // The organization stays in the URL, exactly as the list page links a document.
      const suffix =
        organization.slug.length > 0
          ? `?organization=${encodeURIComponent(organization.slug)}`
          : '';
      router.push(
        `/documents/${encodeURIComponent(detail.document.id)}${suffix}` as Route,
      );
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <h1>{t('documents.newTitle')}</h1>
      {invalid ? (
        <InlineNotification
          kind="warning"
          lowContrast
          role="alert"
          title={t('documents.invalid')}
        />
      ) : null}
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.createFailed')}
        />
      ) : null}
      <Grid>
        <Column lg={10} md={8} sm={4}>
          <Form
            aria-label={t('documents.newTitle')}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Stack gap={7}>
              <section aria-labelledby="document-where-heading">
                <Stack gap={5}>
                  <div className={styles.sectionHead!}>
                    <h2
                      className={styles.sectionHeading!}
                      id="document-where-heading"
                    >
                      {t('documents.new.whereTitle')}
                    </h2>
                    {sectionTag(whereComplete)}
                  </div>
                  <Select
                    id="document-entity"
                    labelText={t('documents.entity')}
                    onChange={(event) => {
                      setLegalEntityId(event.target.value);
                    }}
                    value={legalEntityId}
                  >
                    {legalEntities.map((entity) => (
                      <SelectItem
                        key={entity.id}
                        text={entity.name}
                        value={entity.id}
                      />
                    ))}
                  </Select>
                  <Select
                    id="document-kind"
                    labelText={t('documents.fieldKind')}
                    onChange={(event) => {
                      setKind(asKind(event.target.value));
                    }}
                    value={kind}
                  >
                    {documentKindSchema.options.map((option) => (
                      <SelectItem
                        key={option}
                        text={t(documentKindLabelKeys[option])}
                        value={option}
                      />
                    ))}
                  </Select>
                </Stack>
              </section>

              <section aria-labelledby="document-detail-heading">
                <Stack gap={5}>
                  <div className={styles.sectionHead!}>
                    <h2
                      className={styles.sectionHeading!}
                      id="document-detail-heading"
                    >
                      {t('documents.new.documentTitle')}
                    </h2>
                    {sectionTag(documentComplete)}
                  </div>
                  <TextInput
                    id="document-title"
                    labelText={t('documents.fieldTitle')}
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                    value={title}
                  />
                  <DateField
                    id="document-date"
                    labelText={t('documents.fieldDate')}
                    onChange={setDocumentDate}
                  />
                  <TextInput
                    id="document-reference"
                    labelText={t('documents.fieldReference')}
                    onChange={(event) => {
                      setReference(event.target.value);
                    }}
                    value={reference}
                  />
                  <TextInput
                    id="document-currency"
                    labelText={t('documents.fieldCurrency')}
                    onChange={(event) => {
                      setCurrencyCode(event.target.value);
                    }}
                    value={currencyCode}
                  />
                  <PartnerPicker
                    idPrefix="document"
                    onSelect={setPartnerId}
                    organizationId={organizationId}
                    selectedPartnerId={partnerId}
                  />
                  <TextArea
                    id="document-notes"
                    labelText={t('documents.fieldNotes')}
                    onChange={(event) => {
                      setNotes(event.target.value);
                    }}
                    value={notes}
                  />
                </Stack>
              </section>

              {invoiceKind ? (
                <section aria-labelledby="document-lines-heading">
                  <Stack gap={5}>
                    <div className={styles.sectionHead!}>
                      <h2
                        className={styles.sectionHeading!}
                        id="document-lines-heading"
                      >
                        {t('documents.new.linesTitle')}
                      </h2>
                      {sectionTag(linesComplete)}
                    </div>
                    <DateField
                      id="invoice-tax-point"
                      labelText={t('documents.fieldTaxPointDate')}
                      onChange={setTaxPointDate}
                    />
                    <DateField
                      id="invoice-due-date"
                      labelText={t('documents.fieldDueDate')}
                      onChange={setDueDate}
                    />
                    <DateField
                      id="invoice-received-date"
                      labelText={t('documents.fieldReceivedDate')}
                      onChange={setReceivedDate}
                    />
                    <TextInput
                      id="invoice-rounding-amount"
                      labelText={t('documents.fieldRoundingAmount')}
                      onChange={(event) => {
                        setRoundingAmount(event.target.value);
                      }}
                      value={roundingAmount}
                    />
                    <TextInput
                      id="invoice-variable-symbol"
                      labelText={t('documents.fieldVariableSymbol')}
                      onChange={(event) => {
                        setVariableSymbol(event.target.value);
                      }}
                      value={variableSymbol}
                    />
                    <TableContainer
                      className={styles.tableContainer!}
                      title={t('documents.invoiceLines')}
                    >
                      <Table aria-label={t('documents.invoiceLines')} size="sm">
                        <TableHead>
                          <TableRow>
                            <TableHeader scope="col">
                              {t('documents.lineDescription')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineKind')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineCategory')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineQuantity')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineUnitPrice')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineBaseAmount')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineVatMode')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineVatRate')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.lineVatAmount')}
                            </TableHeader>
                            <TableHeader scope="col">
                              {t('documents.columnActions')}
                            </TableHeader>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {lines.map((line, index) => (
                            <Fragment key={line.key}>
                              <TableRow>
                                <TableCell>
                                  <TextInput
                                    id={`line-description-${String(index)}`}
                                    labelText={`${t('documents.lineDescription')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        description: event.target.value,
                                      });
                                    }}
                                    value={line.description}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Select
                                    id={`line-kind-${String(index)}`}
                                    labelText={`${t('documents.lineKind')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        lineKind: asLineKind(
                                          event.target.value,
                                        ),
                                      });
                                    }}
                                    value={line.lineKind}
                                  >
                                    {invoiceLineKindSchema.options.map(
                                      (option) => (
                                        <SelectItem
                                          key={option}
                                          text={t(
                                            invoiceLineKindLabelKeys[option],
                                          )}
                                          value={option}
                                        />
                                      ),
                                    )}
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Select
                                    disabled={
                                      line.lineKind === 'advance_deduction'
                                    }
                                    id={`line-category-${String(index)}`}
                                    labelText={`${t('documents.lineCategory')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        category: asCategory(
                                          event.target.value,
                                        ),
                                      });
                                    }}
                                    value={line.category}
                                  >
                                    {invoiceLineCategorySchema.options.map(
                                      (option) => (
                                        <SelectItem
                                          key={option}
                                          text={t(
                                            invoiceLineCategoryLabelKeys[
                                              option
                                            ],
                                          )}
                                          value={option}
                                        />
                                      ),
                                    )}
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <TextInput
                                    id={`line-quantity-${String(index)}`}
                                    labelText={`${t('documents.lineQuantity')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        quantity: event.target.value,
                                      });
                                    }}
                                    value={line.quantity}
                                  />
                                </TableCell>
                                <TableCell>
                                  <TextInput
                                    id={`line-unit-price-${String(index)}`}
                                    labelText={`${t('documents.lineUnitPrice')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        unitPrice: event.target.value,
                                      });
                                    }}
                                    value={line.unitPrice}
                                  />
                                </TableCell>
                                <TableCell>
                                  <TextInput
                                    id={`line-base-${String(index)}`}
                                    labelText={`${t('documents.lineBaseAmount')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        baseAmount: event.target.value,
                                      });
                                    }}
                                    value={line.baseAmount}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Select
                                    id={`line-vat-mode-${String(index)}`}
                                    labelText={`${t('documents.lineVatMode')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        vatMode: asVatMode(event.target.value),
                                      });
                                    }}
                                    value={line.vatMode}
                                  >
                                    {vatModeSchema.options.map((option) => (
                                      <SelectItem
                                        key={option}
                                        text={t(vatModeLabelKeys[option])}
                                        value={option}
                                      />
                                    ))}
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <TextInput
                                    id={`line-vat-rate-${String(index)}`}
                                    labelText={`${t('documents.lineVatRate')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        vatRate: event.target.value,
                                      });
                                    }}
                                    value={line.vatRate}
                                  />
                                </TableCell>
                                <TableCell>
                                  <TextInput
                                    id={`line-vat-amount-${String(index)}`}
                                    labelText={`${t('documents.lineVatAmount')} ${String(index + 1)}`}
                                    onChange={(event) => {
                                      updateLine(index, {
                                        vatAmount: event.target.value,
                                        vatEdited: true,
                                      });
                                    }}
                                    value={line.vatAmount}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Button
                                    disabled={lines.length === 1}
                                    kind="ghost"
                                    onClick={() => {
                                      setLines((current) =>
                                        current.filter(
                                          (_line, position) =>
                                            position !== index,
                                        ),
                                      );
                                    }}
                                    size="sm"
                                    type="button"
                                  >
                                    {t('documents.removeLine', {
                                      line: index + 1,
                                    })}
                                  </Button>
                                </TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell colSpan={10}>
                                  <div className={styles.lineDetails!}>
                                    <TextInput
                                      disabled={
                                        line.lineKind === 'advance_deduction'
                                      }
                                      id={`line-tax-point-${String(index)}`}
                                      labelText={`${t('documents.lineTaxPointDate')} ${String(index + 1)}`}
                                      onChange={(event) => {
                                        updateLine(index, {
                                          taxPointDate: event.target.value,
                                        });
                                      }}
                                      type="date"
                                      value={line.taxPointDate}
                                    />
                                    <TextInput
                                      disabled={
                                        line.lineKind === 'advance_deduction'
                                      }
                                      id={`line-period-start-${String(index)}`}
                                      labelText={`${t('documents.linePeriodStart')} ${String(index + 1)}`}
                                      onChange={(event) => {
                                        updateLine(index, {
                                          periodStart: event.target.value,
                                        });
                                      }}
                                      type="date"
                                      value={line.periodStart}
                                    />
                                    <TextInput
                                      disabled={
                                        line.lineKind === 'advance_deduction'
                                      }
                                      id={`line-period-end-${String(index)}`}
                                      labelText={`${t('documents.linePeriodEnd')} ${String(index + 1)}`}
                                      onChange={(event) => {
                                        updateLine(index, {
                                          periodEnd: event.target.value,
                                        });
                                      }}
                                      type="date"
                                      value={line.periodEnd}
                                    />
                                    <TextInput
                                      id={`line-activity-${String(index)}`}
                                      labelText={`${t('documents.lineActivity')} ${String(index + 1)}`}
                                      onChange={(event) => {
                                        updateLine(index, {
                                          activityCode: event.target.value,
                                        });
                                      }}
                                      value={line.activityCode}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <Button
                      kind="tertiary"
                      onClick={() => {
                        setLines((current) => [...current, emptyLine()]);
                      }}
                      type="button"
                    >
                      {t('documents.addLine')}
                    </Button>
                    <StructuredListWrapper
                      aria-label={t('documents.totalsInvoice')}
                      isCondensed
                    >
                      <StructuredListBody>
                        <StructuredListRow>
                          <StructuredListCell>
                            {t('documents.totalGross')}
                          </StructuredListCell>
                          <StructuredListCell>
                            {previewAmount(previewGross)}
                          </StructuredListCell>
                        </StructuredListRow>
                        <StructuredListRow>
                          <StructuredListCell>
                            {t('documents.totalRounding')}
                          </StructuredListCell>
                          <StructuredListCell>
                            {previewAmount(previewRounding)}
                          </StructuredListCell>
                        </StructuredListRow>
                        <StructuredListRow>
                          <StructuredListCell>
                            {t('documents.totalAdvance')}
                          </StructuredListCell>
                          <StructuredListCell>
                            {previewAmount(previewAdvance)}
                          </StructuredListCell>
                        </StructuredListRow>
                        <StructuredListRow>
                          <StructuredListCell>
                            {t('documents.totalAmountDue')}
                          </StructuredListCell>
                          <StructuredListCell>
                            {previewAmount(previewAmountDue)}
                          </StructuredListCell>
                        </StructuredListRow>
                      </StructuredListBody>
                    </StructuredListWrapper>
                  </Stack>
                </section>
              ) : null}

              <div className={styles.bottomBar!}>
                <Button
                  kind="secondary"
                  onClick={() => {
                    router.push(
                      withOrganization(
                        '/documents',
                        organization.slug,
                      ) as Route,
                    );
                  }}
                  type="button"
                >
                  {t('documents.cancel')}
                </Button>
                <Button disabled={submitting} type="submit">
                  {t('documents.submit')}
                </Button>
              </div>
            </Stack>
          </Form>
        </Column>
      </Grid>
    </PageContainer>
  );
}
