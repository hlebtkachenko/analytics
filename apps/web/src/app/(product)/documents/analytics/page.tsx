'use client';

import {
  DataTable,
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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import {
  accessPath,
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
  organizationAccessSchema,
} from '../../../../lib/datasets/client';
import type {
  LegalEntity,
  OrganizationAccess,
} from '../../../../lib/datasets/client';
import {
  documentAnalyticsPath,
  formatAmount,
} from '../../../../lib/documents/client';
import { documentAnalyticsResponseSchema } from '../../../../lib/documents/contract.ts';
import type { DocumentAnalyticsResponse } from '../../../../lib/documents/contract.ts';
import {
  documentStatusLabelKeys,
  documentStatusTagTypes,
  invoiceLineKindLabelKeys,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';

// The result carries the read it answered, so a stale scope is never shown as current.
type AnalyticsResult = Readonly<{
  key: string;
  value?: DocumentAnalyticsResponse;
}>;

const allEntitiesValue = '';

export default function DocumentAnalyticsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const [access, setAccess] = useState<OrganizationAccess>();
  const [accessState, setAccessState] = useState<LoadState>('loading');
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [entityId, setEntityId] = useState(allEntitiesValue);
  const [result, setResult] = useState<AnalyticsResult>();

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(accessPath(organizationId), controller.signal)
      .then((payload) => organizationAccessSchema.parse(payload))
      .then((contract) => {
        setAccess(contract);
        setAccessState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setAccess(undefined);
          setAccessState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId]);

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(legalEntitiesPath(organizationId), controller.signal)
      .then((payload) => legalEntityListSchema.parse(payload))
      .then((payload) => {
        setLegalEntities(payload.legalEntities);
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

  const analyticsKey = documentAnalyticsPath(organizationId, entityId);

  useEffect(() => {
    if (organizationId.length === 0) {
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
  }, [analyticsKey, organizationId]);

  const analytics = result?.key === analyticsKey ? result.value : undefined;
  const analyticsState: LoadState =
    result?.key !== analyticsKey
      ? 'loading'
      : result.value === undefined
        ? 'error'
        : 'idle';
  const canRead = access?.capabilities.readDocuments ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || analyticsState === 'loading'));
  const failed = organization.state === 'error' || analyticsState === 'error';
  const documents = analytics?.documents ?? [];

  const documentHeaders = [
    { header: t('documents.columnReference'), key: 'reference' },
    { header: t('documents.columnTitle'), key: 'title' },
    { header: t('documents.columnPartner'), key: 'partnerName' },
    { header: t('documents.analyticsColumnDate'), key: 'documentDate' },
    { header: t('documents.analyticsColumnGross'), key: 'grossTotal' },
    { header: t('documents.analyticsColumnAdvance'), key: 'advanceTotal' },
    { header: t('documents.analyticsColumnRounding'), key: 'roundingAmount' },
    { header: t('documents.analyticsColumnAmountDue'), key: 'amountDue' },
    { header: t('documents.columnStatus'), key: 'status' },
  ];
  const byMonthHeaders = [
    { header: t('documents.analyticsColumnMonth'), key: 'month' },
    { header: t('documents.eventColumnAccount'), key: 'accountCode' },
    { header: t('documents.analyticsColumnAccountName'), key: 'accountName' },
    { header: t('documents.eventColumnDebit'), key: 'debit' },
    { header: t('documents.eventColumnCredit'), key: 'credit' },
  ];
  const byActivityHeaders = [
    { header: t('documents.eventColumnActivity'), key: 'activityCode' },
    { header: t('documents.eventColumnDebit'), key: 'debit' },
    { header: t('documents.eventColumnCredit'), key: 'credit' },
    { header: t('documents.analyticsColumnLines'), key: 'lineCount' },
  ];
  const byVatRegimeHeaders = [
    { header: t('documents.lineKind'), key: 'lineKind' },
    { header: t('documents.lineVatMode'), key: 'vatMode' },
    { header: t('documents.lineVatRate'), key: 'vatRate' },
    { header: t('documents.lineBaseAmount'), key: 'baseAmount' },
    { header: t('documents.lineVatAmount'), key: 'vatAmount' },
    { header: t('documents.analyticsColumnLines'), key: 'lineCount' },
  ];
  const byAccountHeaders = [
    { header: t('documents.eventColumnAccount'), key: 'accountCode' },
    { header: t('documents.analyticsColumnAccountName'), key: 'accountName' },
    { header: t('documents.analyticsColumnNature'), key: 'nature' },
    { header: t('documents.eventColumnDebit'), key: 'debit' },
    { header: t('documents.eventColumnCredit'), key: 'credit' },
  ];

  function documentHref(documentId: string): string {
    const suffix =
      organization.slug.length > 0
        ? `?organization=${encodeURIComponent(organization.slug)}`
        : '';
    return `/documents/${encodeURIComponent(documentId)}${suffix}`;
  }

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
          <div data-testid="analytics-documents">
            <DataTable
              headers={documentHeaders}
              rows={documents.map((document) => ({ id: document.id }))}
            >
              {({ getTableContainerProps, getTableProps }) => (
                <TableContainer
                  className={styles.tableContainer!}
                  title={t('documents.analyticsDocumentsTitle')}
                  {...getTableContainerProps()}
                >
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {documentHeaders.map((header) => (
                          <TableHeader key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {documents.map((document) => (
                        <TableRow key={document.id}>
                          <TableCell>
                            {document.reference ?? t('documents.notAvailable')}
                          </TableCell>
                          <TableCell>
                            <a href={documentHref(document.id)}>
                              {document.title}
                            </a>
                          </TableCell>
                          <TableCell>
                            {document.partnerName ??
                              t('documents.notAvailable')}
                          </TableCell>
                          <TableCell>{document.documentDate}</TableCell>
                          <TableCell className={styles.amount!}>
                            {formatAmount(
                              document.grossTotal,
                              document.currencyCode,
                            )}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {formatAmount(
                              document.advanceTotal,
                              document.currencyCode,
                            )}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {formatAmount(
                              document.roundingAmount,
                              document.currencyCode,
                            )}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {formatAmount(
                              document.amountDue,
                              document.currencyCode,
                            )}
                          </TableCell>
                          <TableCell>
                            <Tag
                              size="sm"
                              type={documentStatusTagTypes[document.status]}
                            >
                              {t(documentStatusLabelKeys[document.status])}
                            </Tag>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
          <div data-testid="analytics-by-month">
            <DataTable
              headers={byMonthHeaders}
              rows={analytics.byMonth.map((row) => ({
                id: `${row.month}-${row.accountCode}`,
              }))}
            >
              {({ getTableContainerProps, getTableProps }) => (
                <TableContainer
                  className={styles.tableContainer!}
                  title={t('documents.analyticsByMonthTitle')}
                  {...getTableContainerProps()}
                >
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {byMonthHeaders.map((header) => (
                          <TableHeader key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.byMonth.map((row) => (
                        <TableRow key={`${row.month}-${row.accountCode}`}>
                          <TableCell>{monthLabel(row.month)}</TableCell>
                          <TableCell>{row.accountCode}</TableCell>
                          <TableCell>{row.accountName}</TableCell>
                          <TableCell className={styles.amount!}>
                            {row.debit}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {row.credit}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
          <div data-testid="analytics-by-activity">
            <DataTable
              headers={byActivityHeaders}
              rows={analytics.byActivity.map((row) => ({
                id: row.activityCode,
              }))}
            >
              {({ getTableContainerProps, getTableProps }) => (
                <TableContainer
                  className={styles.tableContainer!}
                  title={t('documents.analyticsByActivityTitle')}
                  {...getTableContainerProps()}
                >
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {byActivityHeaders.map((header) => (
                          <TableHeader key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.byActivity.map((row) => (
                        <TableRow key={row.activityCode}>
                          <TableCell>{row.activityCode}</TableCell>
                          <TableCell className={styles.amount!}>
                            {row.debit}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {row.credit}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {row.lineCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
          <div data-testid="analytics-by-vat-regime">
            <DataTable
              headers={byVatRegimeHeaders}
              rows={analytics.byVatRegime.map((row) => ({
                id: `${row.lineKind}-${row.vatMode}-${row.vatRate}`,
              }))}
            >
              {({ getTableContainerProps, getTableProps }) => (
                <TableContainer
                  className={styles.tableContainer!}
                  title={t('documents.analyticsByVatRegimeTitle')}
                  {...getTableContainerProps()}
                >
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {byVatRegimeHeaders.map((header) => (
                          <TableHeader key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.byVatRegime.map((row) => (
                        <TableRow
                          key={`${row.lineKind}-${row.vatMode}-${row.vatRate}`}
                        >
                          <TableCell>
                            {t(invoiceLineKindLabelKeys[row.lineKind])}
                          </TableCell>
                          <TableCell>
                            {t(vatModeLabelKeys[row.vatMode])}
                          </TableCell>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
          <div data-testid="analytics-by-account">
            <DataTable
              headers={byAccountHeaders}
              rows={analytics.byAccount.map((row) => ({
                id: row.accountCode,
              }))}
            >
              {({ getTableContainerProps, getTableProps }) => (
                <TableContainer
                  className={styles.tableContainer!}
                  title={t('documents.analyticsByAccountTitle')}
                  {...getTableContainerProps()}
                >
                  <Table {...getTableProps()} size="md">
                    <TableHead>
                      <TableRow>
                        {byAccountHeaders.map((header) => (
                          <TableHeader key={header.key}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.byAccount.map((row) => (
                        <TableRow key={row.accountCode}>
                          <TableCell>{row.accountCode}</TableCell>
                          <TableCell>{row.accountName}</TableCell>
                          <TableCell>{row.nature}</TableCell>
                          <TableCell className={styles.amount!}>
                            {row.debit}
                          </TableCell>
                          <TableCell className={styles.amount!}>
                            {row.credit}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}

// The aggregate keys a calendar month, so the stored first day reads as the month itself.
function monthLabel(month: string): string {
  return month.slice(0, 7);
}
