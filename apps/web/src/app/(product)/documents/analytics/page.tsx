'use client';

import {
  DataTableSkeleton,
  InlineNotification,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from '@bap/design-system/react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentAnalyticsPath,
  formatAmount,
  withOrganization,
} from '../../../../lib/documents/client';
import { documentAnalyticsResponseSchema } from '../../../../lib/documents/contract.ts';
import type { DocumentAnalyticsResponse } from '../../../../lib/documents/contract.ts';
import {
  documentStatusLabelKeys,
  documentStatusTagTypes,
  invoiceLineKindLabelKeys,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';

// The result carries the read it answered, so a stale scope is never shown as current.
type AnalyticsResult = Readonly<{
  key: string;
  value?: DocumentAnalyticsResponse;
}>;

// A row hands over its cells already rendered, so alignment stays with the column that needs it.
type AnalyticsRow = Readonly<{ cells: ReactNode; id: string }>;

const allEntitiesValue = '';

// The five aggregates differ only in their columns, so one table renders them all.
function AnalyticsTable({
  headers,
  rows,
  testId,
  title,
}: Readonly<{
  headers: readonly string[];
  rows: readonly AnalyticsRow[];
  testId: string;
  title: string;
}>) {
  return (
    <div data-testid={testId}>
      <TableContainer className={styles.tableContainer!} title={title}>
        <Table size="md">
          <TableHead>
            <TableRow>
              {headers.map((header) => (
                <TableHeader key={header}>{header}</TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>{row.cells}</TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

export default function DocumentAnalyticsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [entityId, setEntityId] = useState(allEntitiesValue);
  const [result, setResult] = useState<AnalyticsResult>();

  const canRead = access?.capabilities.readDocuments ?? false;
  // A denied read is answered by the capability gate, so the route is never asked at all.
  const allowed = accessState === 'idle' && canRead;
  const analyticsKey = documentAnalyticsPath(organizationId, entityId);

  useEffect(() => {
    if (organizationId.length === 0 || !allowed) {
      return;
    }

    const controller = new AbortController();
    void getJson(analyticsKey, controller.signal)
      .then((payload) => documentAnalyticsResponseSchema.parse(payload))
      .then((payload) => {
        setResult({ key: analyticsKey, value: payload });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: analyticsKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [allowed, analyticsKey, organizationId]);

  const analytics = result?.key === analyticsKey ? result.value : undefined;
  const analyticsState: LoadState =
    result?.key !== analyticsKey
      ? 'loading'
      : result.value === undefined
        ? 'error'
        : 'idle';
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || (allowed && analyticsState === 'loading')));
  const failed =
    organization.state === 'error' || (allowed && analyticsState === 'error');
  const documents = analytics?.documents ?? [];

  const documentHeaders = [
    t('documents.columnReference'),
    t('documents.columnTitle'),
    t('documents.columnPartner'),
    t('documents.analyticsColumnDate'),
    t('documents.analyticsColumnGross'),
    t('documents.analyticsColumnAdvance'),
    t('documents.analyticsColumnRounding'),
    t('documents.analyticsColumnAmountDue'),
    t('documents.columnStatus'),
  ];
  const byMonthHeaders = [
    t('documents.analyticsColumnMonth'),
    t('documents.eventColumnAccount'),
    t('documents.analyticsColumnAccountName'),
    t('documents.eventColumnDebit'),
    t('documents.eventColumnCredit'),
  ];
  const byActivityHeaders = [
    t('documents.eventColumnActivity'),
    t('documents.eventColumnDebit'),
    t('documents.eventColumnCredit'),
    t('documents.analyticsColumnLines'),
  ];
  const byVatRegimeHeaders = [
    t('documents.lineKind'),
    t('documents.lineVatMode'),
    t('documents.lineVatRate'),
    t('documents.lineBaseAmount'),
    t('documents.lineVatAmount'),
    t('documents.analyticsColumnLines'),
  ];
  const byAccountHeaders = [
    t('documents.eventColumnAccount'),
    t('documents.analyticsColumnAccountName'),
    t('documents.analyticsColumnNature'),
    t('documents.eventColumnDebit'),
    t('documents.eventColumnCredit'),
  ];

  return (
    <PageContainer>
      <div className={styles.heading!}>
        <h1>{t('documents.analyticsTitle')}</h1>
        {analytics === undefined ? null : (
          <p data-testid="analytics-stats">
            {t('documents.analyticsStats', {
              elapsed: analytics.stats.elapsedMs,
              eventLines: analytics.stats.eventLineCount,
              invoiceLines: analytics.stats.invoiceLineCount,
              queries: analytics.stats.queryCount,
            })}
          </p>
        )}
      </div>
      {accessState === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.accessError')}
        />
      ) : null}
      {accessState === 'idle' && !canRead ? (
        <InlineNotification
          kind="warning"
          lowContrast
          title={t('documents.denied')}
        />
      ) : null}
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.analyticsError')}
        />
      ) : null}
      {organization.organizations.length > 0 ? (
        <Select
          id="documents-analytics-organization"
          labelText={t('documents.organization')}
          onChange={(event) => {
            organization.select(event.target.value);
            setEntityId(allEntitiesValue);
          }}
          value={organizationId}
        >
          {organization.organizations.map((item) => (
            <SelectItem key={item.id} text={item.name} value={item.id} />
          ))}
        </Select>
      ) : null}
      {legalEntities.length > 0 ? (
        <Select
          id="documents-analytics-entity"
          labelText={t('documents.entity')}
          onChange={(event) => {
            setEntityId(event.target.value);
          }}
          value={entityId}
        >
          <SelectItem
            text={t('documents.entityAll')}
            value={allEntitiesValue}
          />
          {legalEntities.map((entity) => (
            <SelectItem key={entity.id} text={entity.name} value={entity.id} />
          ))}
        </Select>
      ) : null}
      {loading ? (
        <DataTableSkeleton
          aria-label={t('documents.analyticsLoading')}
          columnCount={documentHeaders.length}
          rowCount={5}
          showHeader={false}
          showToolbar={false}
        />
      ) : null}
      {!loading && analytics !== undefined && documents.length === 0 ? (
        <Tile>
          <p>{t('documents.analyticsEmpty')}</p>
        </Tile>
      ) : null}
      {!loading && analytics !== undefined && documents.length > 0 ? (
        <>
          <AnalyticsTable
            headers={documentHeaders}
            rows={documents.map((document) => ({
              cells: (
                <>
                  <TableCell>
                    {document.reference ?? t('documents.notAvailable')}
                  </TableCell>
                  <TableCell>
                    <a
                      href={withOrganization(
                        `/documents/${encodeURIComponent(document.id)}`,
                        organization.slug,
                      )}
                    >
                      {document.title}
                    </a>
                  </TableCell>
                  <TableCell>
                    {document.partnerName ?? t('documents.notAvailable')}
                  </TableCell>
                  <TableCell>{document.documentDate}</TableCell>
                  <TableCell className={styles.amount!}>
                    {formatAmount(document.grossTotal, document.currencyCode)}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {formatAmount(document.advanceTotal, document.currencyCode)}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {formatAmount(
                      document.roundingAmount,
                      document.currencyCode,
                    )}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {formatAmount(document.amountDue, document.currencyCode)}
                  </TableCell>
                  <TableCell>
                    <Tag
                      size="sm"
                      type={documentStatusTagTypes[document.status]}
                    >
                      {t(documentStatusLabelKeys[document.status])}
                    </Tag>
                  </TableCell>
                </>
              ),
              id: document.id,
            }))}
            testId="analytics-documents"
            title={t('documents.analyticsDocumentsTitle')}
          />
          <AnalyticsTable
            headers={byMonthHeaders}
            rows={analytics.byMonth.map((row) => ({
              cells: (
                <>
                  <TableCell>{monthLabel(row.month)}</TableCell>
                  <TableCell>{row.accountCode}</TableCell>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell className={styles.amount!}>{row.debit}</TableCell>
                  <TableCell className={styles.amount!}>{row.credit}</TableCell>
                </>
              ),
              id: `${row.month}-${row.accountCode}`,
            }))}
            testId="analytics-by-month"
            title={t('documents.analyticsByMonthTitle')}
          />
          <AnalyticsTable
            headers={byActivityHeaders}
            rows={analytics.byActivity.map((row) => ({
              cells: (
                <>
                  <TableCell>{row.activityCode}</TableCell>
                  <TableCell className={styles.amount!}>{row.debit}</TableCell>
                  <TableCell className={styles.amount!}>{row.credit}</TableCell>
                  <TableCell className={styles.amount!}>
                    {row.lineCount}
                  </TableCell>
                </>
              ),
              id: row.activityCode,
            }))}
            testId="analytics-by-activity"
            title={t('documents.analyticsByActivityTitle')}
          />
          <AnalyticsTable
            headers={byVatRegimeHeaders}
            rows={analytics.byVatRegime.map((row) => ({
              cells: (
                <>
                  <TableCell>
                    {t(invoiceLineKindLabelKeys[row.lineKind])}
                  </TableCell>
                  <TableCell>{t(vatModeLabelKeys[row.vatMode])}</TableCell>
                  <TableCell className={styles.amount!}>
                    {row.vatRate}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {row.baseAmount}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {row.vatAmount}
                  </TableCell>
                  <TableCell className={styles.amount!}>
                    {row.lineCount}
                  </TableCell>
                </>
              ),
              id: `${row.lineKind}-${row.vatMode}-${row.vatRate}`,
            }))}
            testId="analytics-by-vat-regime"
            title={t('documents.analyticsByVatRegimeTitle')}
          />
          <AnalyticsTable
            headers={byAccountHeaders}
            rows={analytics.byAccount.map((row) => ({
              cells: (
                <>
                  <TableCell>{row.accountCode}</TableCell>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell>{row.nature}</TableCell>
                  <TableCell className={styles.amount!}>{row.debit}</TableCell>
                  <TableCell className={styles.amount!}>{row.credit}</TableCell>
                </>
              ),
              id: row.accountCode,
            }))}
            testId="analytics-by-account"
            title={t('documents.analyticsByAccountTitle')}
          />
        </>
      ) : null}
    </PageContainer>
  );
}

// The aggregate keys a calendar month, so the stored first day reads as the month itself.
function monthLabel(month: string): string {
  return month.slice(0, 7);
}
