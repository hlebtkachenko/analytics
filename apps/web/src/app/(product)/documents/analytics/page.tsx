'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  ChartFrame,
  GroupedBarChart,
  ScaleTypes,
  SimpleBarChart,
  StackedBarChart,
  TruncationTypes,
} from '@bap/design-system/charts';
import type {
  BarChartOptions,
  ChartTable,
  ChartTheme,
} from '@bap/design-system/charts';
import {
  Button,
  Column,
  DataTableSkeleton,
  Grid,
  Heading,
  InlineNotification,
  Section,
  Tile,
} from '@bap/design-system/react';
import { DocumentAdd } from '@bap/design-system/icons';
import { useThemeMode } from '@bap/design-system/theme';
import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import EntityMultiSelect from '../../../../components/documents/entity-multiselect';
import StatTiles from '../../../../components/documents/stat-tiles';
import PageContainer from '../../../../components/page-container';
import { StatusIndicator } from '../../../../components/status-indicator';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentAnalyticsPath,
  withOrganization,
} from '../../../../lib/documents/client';
import { documentAnalyticsResponseSchema } from '../../../../lib/documents/contract.ts';
import type {
  DocumentAnalyticsResponse,
  DocumentKind,
} from '../../../../lib/documents/contract.ts';
import {
  documentStatusLabelKeys,
  documentStatusSeverity,
  invoiceLineKindLabelKeys,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import {
  amountUnit,
  monthTotalsSeries,
  partnerSeries,
  tooltipValue,
  vatBalanceSeries,
} from '../../../../lib/documents/analytics-series.ts';
import type { ChartSeries } from '../../../../lib/documents/analytics-series.ts';
import { documentKindIcon } from '../../../../lib/documents/kind-icon.ts';
import { storedEntities } from '../../../../lib/documents/list.ts';
import {
  formatDate,
  formatMoney,
  formatMonth,
} from '../../../../lib/format.ts';
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

const countFormat = new Intl.NumberFormat('cs-CZ');
// Axis ticks read "1,2 mil."; tooltips and tables keep the full Czech amount.
const compactFormat = new Intl.NumberFormat('cs-CZ', { notation: 'compact' });

type BarOptionsInput = Readonly<{
  amountTitle: string;
  height: string;
  // Partners read top to bottom, so their names sit on the left axis.
  horizontal?: boolean;
  language: string;
  legend: boolean;
  pairingOption: number;
  stacked?: boolean;
  theme: ChartTheme;
  title: string;
}>;

// The table sits in ChartFrame, so no toolbar; months tick short and tooltip long, both in the UI language.
function barOptions(input: BarOptionsInput): BarChartOptions {
  const valueAxis = {
    includeZero: true,
    mapsTo: 'value',
    scaleType: ScaleTypes.LINEAR,
    stacked: input.stacked ?? false,
    ticks: {
      formatter: (tick: number | Date) => compactFormat.format(Number(tick)),
    },
    title: input.amountTitle,
  };
  const keyAxis = {
    mapsTo: 'key',
    scaleType: ScaleTypes.LABELS,
    // Partner names draw in full: a name past the threshold would otherwise reach the label hover tooltip as raw HTML.
    ...(input.horizontal
      ? {
          truncation: {
            threshold: Number.MAX_SAFE_INTEGER,
            type: TruncationTypes.NONE,
          },
        }
      : {
          ticks: {
            formatter: (tick: number | Date) =>
              formatMonth(String(tick), input.language, 'short'),
          },
        }),
  };

  return {
    accessibility: { svgAriaLabel: input.title },
    animations: false,
    axes: input.horizontal
      ? { bottom: valueAxis, left: keyAxis }
      : { bottom: keyAxis, left: valueAxis },
    color: { pairing: { option: input.pairingOption } },
    height: input.height,
    legend: { enabled: input.legend },
    resizable: true,
    theme: input.theme,
    toolbar: { enabled: false },
    tooltip: {
      valueFormatter: (value: unknown) => tooltipValue(value, input.language),
    },
  };
}

type AnalyticsChartProps = Readonly<{
  children: ReactNode;
  description?: string;
  emptyText: string;
  series: ChartSeries;
  table: Omit<ChartTable, 'rows'>;
  testId: string;
  title: string;
}>;

// One chart slot: the chart with its table, or one sentence when there is nothing to draw.
function AnalyticsChart({
  children,
  description,
  emptyText,
  series,
  table,
  testId,
  title,
}: AnalyticsChartProps) {
  return (
    <Section className={styles.chart!} data-testid={testId}>
      {series.empty ? (
        <>
          <Heading>{title}</Heading>
          <p>{emptyText}</p>
        </>
      ) : (
        <ChartFrame
          {...(description === undefined ? {} : { description })}
          table={{ ...table, rows: series.rows }}
          title={title}
        >
          {children}
        </ChartFrame>
      )}
    </Section>
  );
}

export default function DocumentAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { resolvedTheme } = useThemeMode();
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [entityIds, setEntityIds] = useState<string[]>(() =>
    storedEntities(searchParams.get('entity')),
  );
  const [result, setResult] = useState<AnalyticsResult>();

  const canRead = access?.capabilities.readDocuments ?? false;
  // A denied read is answered by the capability gate, so the route is never asked at all.
  const allowed = accessState === 'idle' && canRead;
  // The scope sends legalEntityId once per chosen entity; no choice reads the whole organization.
  const analyticsKey = documentAnalyticsPath(organizationId, entityIds);

  // Drop URL entity ids unknown after an organization change, else the all-or-nothing scope reads nothing.
  if (
    legalEntities.length > 0 &&
    entityIds.some((id) => !legalEntities.some((entity) => entity.id === id))
  ) {
    setEntityIds(
      entityIds.filter((id) =>
        legalEntities.some((entity) => entity.id === id),
      ),
    );
  }

  // The browser URL keeps the chosen scope, so a reload or a shared link reopens it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (organization.slug.length > 0) {
      params.set('organization', organization.slug);
    }
    if (entityIds.length > 0) {
      params.set('entity', entityIds.join(','));
    }
    const queryString = params.toString();
    window.history.replaceState(
      null,
      '',
      queryString.length === 0 ? '?' : `?${queryString}`,
    );
  }, [entityIds, organization.slug]);

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
  const showResults =
    !loading && analytics !== undefined && documents.length > 0;

  // Advance and rounding live on the Lines tab; fixed widths keep amounts whole and text truncating.
  const documentColumns: readonly GridColumn[] = [
    { header: t('documents.columnReference'), key: 'reference', width: 130 },
    {
      header: t('documents.columnTitle'),
      key: 'title',
      renderCell: (row) => {
        const Icon = documentKindIcon(row.kind as DocumentKind);
        return (
          <span className={styles.documentCell!}>
            <Icon size={16} />
            <a
              href={withOrganization(
                `/documents/${encodeURIComponent(String(row.id))}`,
                organization.slug,
              )}
            >
              {row.title}
            </a>
          </span>
        );
      },
    },
    { header: t('documents.columnPartner'), key: 'partner', width: 140 },
    { header: t('documents.analyticsColumnDate'), key: 'date', width: 104 },
    {
      align: 'end',
      header: t('documents.analyticsColumnGross'),
      key: 'gross',
      width: 136,
    },
    {
      align: 'end',
      header: t('documents.analyticsColumnAmountDue'),
      key: 'amountDue',
      width: 136,
    },
    {
      header: t('documents.columnStatus'),
      key: 'status',
      width: 110,
      renderCell: (row) => {
        const status =
          row.status as DocumentAnalyticsResponse['documents'][number]['status'];
        return (
          <StatusIndicator
            label={t(documentStatusLabelKeys[status])}
            severity={documentStatusSeverity[status]}
          />
        );
      },
    },
  ];
  const documentRows: readonly GridRow[] = documents.map((document) => ({
    amountDue: formatMoney(document.amountDue, document.currencyCode),
    date: formatDate(document.documentDate),
    gross: formatMoney(document.grossTotal, document.currencyCode),
    id: document.id,
    kind: document.kind,
    partner: document.partnerName ?? t('documents.notAvailable'),
    reference: document.reference ?? t('documents.notAvailable'),
    status: document.status,
    title: document.title,
  }));

  const byMonthColumns: readonly GridColumn[] = [
    { header: t('documents.analyticsColumnMonth'), key: 'month' },
    { header: t('documents.eventColumnAccount'), key: 'accountCode' },
    { header: t('documents.analyticsColumnAccountName'), key: 'accountName' },
    { align: 'end', header: t('documents.eventColumnDebit'), key: 'debit' },
    { align: 'end', header: t('documents.eventColumnCredit'), key: 'credit' },
  ];
  const byMonthRows: readonly GridRow[] = (analytics?.byMonth ?? []).map(
    (row) => ({
      accountCode: row.accountCode,
      accountName: row.accountName,
      credit: formatMoney(row.credit),
      debit: formatMoney(row.debit),
      id: `${row.month}-${row.accountCode}`,
      month: formatMonth(row.month, i18n.language),
    }),
  );

  const byActivityColumns: readonly GridColumn[] = [
    { header: t('documents.eventColumnActivity'), key: 'activityCode' },
    { align: 'end', header: t('documents.eventColumnDebit'), key: 'debit' },
    { align: 'end', header: t('documents.eventColumnCredit'), key: 'credit' },
    { align: 'end', header: t('documents.analyticsColumnLines'), key: 'lines' },
  ];
  const byActivityRows: readonly GridRow[] = (analytics?.byActivity ?? []).map(
    (row) => ({
      activityCode: row.activityCode,
      credit: formatMoney(row.credit),
      debit: formatMoney(row.debit),
      id: row.activityCode,
      lines: countFormat.format(row.lineCount),
    }),
  );

  const byVatRegimeColumns: readonly GridColumn[] = [
    { header: t('documents.lineKind'), key: 'lineKind' },
    { header: t('documents.lineVatMode'), key: 'vatMode' },
    { align: 'end', header: t('documents.lineVatRate'), key: 'vatRate' },
    {
      align: 'end',
      header: t('documents.lineBaseAmount'),
      key: 'baseAmount',
    },
    { align: 'end', header: t('documents.lineVatAmount'), key: 'vatAmount' },
    { align: 'end', header: t('documents.analyticsColumnLines'), key: 'lines' },
  ];
  const byVatRegimeRows: readonly GridRow[] = (
    analytics?.byVatRegime ?? []
  ).map((row) => ({
    baseAmount: formatMoney(row.baseAmount),
    id: `${row.lineKind}-${row.vatMode}-${row.vatRate}`,
    lineKind: t(invoiceLineKindLabelKeys[row.lineKind]),
    lines: countFormat.format(row.lineCount),
    vatAmount: formatMoney(row.vatAmount),
    vatMode: t(vatModeLabelKeys[row.vatMode]),
    vatRate: row.vatRate,
  }));

  const byAccountColumns: readonly GridColumn[] = [
    { header: t('documents.eventColumnAccount'), key: 'accountCode' },
    { header: t('documents.analyticsColumnAccountName'), key: 'accountName' },
    { header: t('documents.analyticsColumnNature'), key: 'nature' },
    { align: 'end', header: t('documents.eventColumnDebit'), key: 'debit' },
    { align: 'end', header: t('documents.eventColumnCredit'), key: 'credit' },
  ];
  const byAccountRows: readonly GridRow[] = (analytics?.byAccount ?? []).map(
    (row) => ({
      accountCode: row.accountCode,
      accountName: row.accountName,
      credit: formatMoney(row.credit),
      debit: formatMoney(row.debit),
      id: row.accountCode,
      nature: row.nature,
    }),
  );

  const language = i18n.language;
  const currencyCodes = analytics?.currencyCodes ?? [];
  const unit = amountUnit(currencyCodes);
  const amountTitle =
    unit === undefined
      ? t('documents.analyticsChartAmount')
      : t('documents.analyticsChartAmountIn', { currency: unit });
  const theme = resolvedTheme as ChartTheme;
  const monthTitle = t('documents.analyticsChartMonthTitle');
  const vatTitle = t('documents.analyticsChartVatTitle');
  const partnersTitle = t('documents.analyticsChartPartnersTitle');
  const monthSeries = monthTotalsSeries(
    analytics?.byMonthTotals ?? [],
    {
      expense: t('documents.analyticsChartExpenses'),
      revenue: t('documents.analyticsChartRevenue'),
    },
    language,
  );
  const vatSeries = vatBalanceSeries(
    analytics?.byMonthTotals ?? [],
    t('documents.analyticsChartVatBalance'),
    language,
  );
  const partnersSeries = partnerSeries(analytics?.byPartner ?? [], {
    issued: t('documents.analyticsChartIssued'),
    received: t('documents.analyticsChartReceived'),
  });

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1 className={styles.title!}>{t('documents.analyticsTitle')}</h1>
        {legalEntities.length === 0 ? null : (
          <EntityMultiSelect
            entities={legalEntities}
            onChange={(ids) => {
              setEntityIds([...ids]);
            }}
            selectedIds={entityIds}
          />
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
      {analytics === undefined ? null : (
        <div data-testid="analytics-stats">
          <StatTiles
            tiles={[
              {
                key: 'invoicesAnalysed',
                label: t('documents.analyticsStatInvoicesAnalysed'),
                value: countFormat.format(analytics.stats.documentCount),
              },
              {
                key: 'eventLines',
                label: t('documents.analyticsStatEventLines'),
                value: countFormat.format(analytics.stats.eventLineCount),
              },
              {
                key: 'invoiceLines',
                label: t('documents.analyticsStatInvoiceLines'),
                value: countFormat.format(analytics.stats.invoiceLineCount),
              },
            ]}
          />
        </div>
      )}
      {loading ? (
        <DataTableSkeleton
          aria-label={t('documents.analyticsLoading')}
          columnCount={documentColumns.length}
          rowCount={5}
          showHeader={false}
          showToolbar={false}
        />
      ) : null}
      {!loading && analytics !== undefined && documents.length === 0 ? (
        <Tile>
          <p>{t('documents.analyticsEmptyScope')}</p>
          <div className={styles.emptyActions!}>
            <Button
              href={
                withOrganization('/documents/new', organization.slug) as Route
              }
              renderIcon={DocumentAdd}
              size="md"
            >
              {t('documents.analyticsEmptyRegister')}
            </Button>
            <Button
              href={withOrganization('/inbox', organization.slug) as Route}
              kind="tertiary"
              size="md"
            >
              {t('documents.analyticsEmptyInbox')}
            </Button>
          </div>
        </Tile>
      ) : null}
      {showResults ? (
        <div className={styles.charts!}>
          {currencyCodes.length > 1 ? (
            <InlineNotification
              hideCloseButton
              kind="warning"
              lowContrast
              title={t('documents.analyticsChartMixedCurrency', {
                currencies: new Intl.ListFormat(language, {
                  type: 'conjunction',
                }).format(currencyCodes),
              })}
            />
          ) : null}
          <Grid>
            <Column sm={4} md={8} lg={16}>
              <AnalyticsChart
                emptyText={t('documents.analyticsChartMonthEmpty')}
                series={monthSeries}
                table={{
                  columns: [
                    {
                      key: 'month',
                      label: t('documents.analyticsColumnMonth'),
                    },
                    {
                      key: 'revenue',
                      label: t('documents.analyticsChartRevenue'),
                    },
                    {
                      key: 'expense',
                      label: t('documents.analyticsChartExpenses'),
                    },
                  ],
                  label: t('documents.analyticsChartMonthTable'),
                }}
                testId="analytics-chart-month"
                title={monthTitle}
              >
                <GroupedBarChart
                  data={[...monthSeries.data]}
                  options={barOptions({
                    amountTitle,
                    height: '320px',
                    language,
                    legend: true,
                    pairingOption: 1,
                    theme,
                    title: monthTitle,
                  })}
                />
              </AnalyticsChart>
            </Column>
            <Column sm={4} md={8} lg={16} xlg={8}>
              <AnalyticsChart
                description={t('documents.analyticsChartVatDescription')}
                emptyText={t('documents.analyticsChartVatEmpty')}
                series={vatSeries}
                table={{
                  columns: [
                    {
                      key: 'month',
                      label: t('documents.analyticsColumnMonth'),
                    },
                    {
                      key: 'vatBalance',
                      label: t('documents.analyticsChartVatBalance'),
                    },
                  ],
                  label: t('documents.analyticsChartVatTable'),
                }}
                testId="analytics-chart-vat"
                title={vatTitle}
              >
                <SimpleBarChart
                  data={[...vatSeries.data]}
                  options={barOptions({
                    amountTitle,
                    height: '320px',
                    language,
                    legend: false,
                    pairingOption: 3,
                    theme,
                    title: vatTitle,
                  })}
                />
              </AnalyticsChart>
            </Column>
            <Column sm={4} md={8} lg={16} xlg={8}>
              <AnalyticsChart
                emptyText={t('documents.analyticsChartPartnersEmpty')}
                series={partnersSeries}
                table={{
                  columns: [
                    {
                      key: 'partner',
                      label: t('documents.analyticsChartPartner'),
                    },
                    {
                      key: 'issued',
                      label: t('documents.analyticsChartIssued'),
                    },
                    {
                      key: 'received',
                      label: t('documents.analyticsChartReceived'),
                    },
                  ],
                  label: t('documents.analyticsChartPartnersTable'),
                }}
                testId="analytics-chart-partners"
                title={partnersTitle}
              >
                <StackedBarChart
                  data={[...partnersSeries.data]}
                  options={barOptions({
                    amountTitle,
                    height: '360px',
                    horizontal: true,
                    language,
                    legend: true,
                    pairingOption: 1,
                    stacked: true,
                    theme,
                    title: partnersTitle,
                  })}
                />
              </AnalyticsChart>
            </Column>
          </Grid>
        </div>
      ) : null}
      {showResults ? (
        <div className={styles.tables!}>
          <div data-testid="analytics-documents">
            <DataGrid
              ariaLabel={t('documents.analyticsDocumentsTitle')}
              columns={documentColumns}
              fitContainer
              rows={documentRows}
              size="md"
            />
          </div>
          <div data-testid="analytics-by-month">
            <DataGrid
              ariaLabel={t('documents.analyticsByMonthTitle')}
              columns={byMonthColumns}
              fitContainer
              rows={byMonthRows}
              size="md"
            />
          </div>
          <div data-testid="analytics-by-activity">
            <DataGrid
              ariaLabel={t('documents.analyticsByActivityTitle')}
              columns={byActivityColumns}
              fitContainer
              rows={byActivityRows}
              size="md"
            />
          </div>
          <div data-testid="analytics-by-vat-regime">
            <DataGrid
              ariaLabel={t('documents.analyticsByVatRegimeTitle')}
              columns={byVatRegimeColumns}
              fitContainer
              rows={byVatRegimeRows}
              size="md"
            />
          </div>
          <div data-testid="analytics-by-account">
            <DataGrid
              ariaLabel={t('documents.analyticsByAccountTitle')}
              columns={byAccountColumns}
              fitContainer
              rows={byAccountRows}
              size="md"
            />
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
