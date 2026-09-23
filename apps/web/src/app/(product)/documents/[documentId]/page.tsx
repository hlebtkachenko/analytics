'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridRow,
  RowAction,
  ToolbarAction,
} from '@bap/design-system/blocks';
import {
  Button,
  ComboBox,
  ContainedList,
  ContainedListItem,
  InlineNotification,
  Link,
  ListItem,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
  UnorderedList,
} from '@bap/design-system/react';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { createElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import OriginalPreview from '../../../../components/documents/original-preview';
import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import { StatusIndicator } from '../../../../components/status-indicator';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentLinkPath,
  documentLinksPath,
  documentPath,
  documentsPath,
  sendJson,
  sendWithoutContent,
  withOrganization,
} from '../../../../lib/documents/client';
import {
  decimalUnits,
  documentDetailSchema,
  documentLinkKindSchema,
  documentLinkSchema,
  documentListResponseSchema,
  formatDecimalUnits,
  isInvoiceKind,
} from '../../../../lib/documents/contract.ts';
import type {
  DocumentDetail,
  DocumentLinkKind,
  DocumentStatus,
  DocumentSummary,
} from '../../../../lib/documents/contract.ts';
import { documentSourceLabelKeys } from '../../../../lib/documents/detail-labels.ts';
import { documentKindIcon } from '../../../../lib/documents/kind-icon.ts';
import {
  dataIssueLabelKeys,
  documentKindLabelKeys,
  documentLinkKindLabelKeys,
  documentStatusLabelKeys,
  documentStatusSeverity,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import { formatDate, formatMoney } from '../../../../lib/format.ts';
import { inboxBlobDownloadPath } from '../../../../lib/inbox/client';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';
type DetailResult = Readonly<{ key: string; value?: DocumentDetail }>;

const statusActions: readonly Readonly<{
  labelKey: string;
  status: DocumentStatus;
}>[] = [
  { labelKey: 'documents.markVerified', status: 'verified' },
  { labelKey: 'documents.markNeedsReview', status: 'needs_review' },
  { labelKey: 'documents.archive', status: 'archived' },
];

// The one primary status verb by the current status; archived offers none.
function primaryStatusFor(status: DocumentStatus): DocumentStatus | null {
  if (status === 'registered' || status === 'needs_review') {
    return 'verified';
  }
  if (status === 'verified') {
    return 'archived';
  }
  return null;
}

export default function DocumentDetailPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const parameters = useParams<{ documentId: string }>();
  const documentId = parameters.documentId;
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access } = useOrganizationAccess(organizationId);
  const canManage = access?.capabilities.manageDocuments ?? false;
  const legalEntities = useLegalEntities(organizationId);
  const [result, setResult] = useState<DetailResult>();
  const [statusFailed, setStatusFailed] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<DocumentLinkKind>('relates');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [candidates, setCandidates] = useState<DocumentSummary[]>([]);

  // The result carries the read it answered, so a reload never shows another document.
  const detailKey = `${organizationId}:${documentId}`;
  const detail = result?.key === detailKey ? result.value : undefined;
  const state: LoadState =
    result?.key !== detailKey
      ? 'loading'
      : result.value === undefined
        ? 'error'
        : 'idle';

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(documentPath(organizationId, documentId), controller.signal)
      .then((payload) => documentDetailSchema.parse(payload))
      .then((payload) => {
        setResult({ key: detailKey, value: payload });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: detailKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [detailKey, documentId, organizationId]);

  useEffect(() => {
    if (organizationId.length === 0 || linkQuery.trim().length === 0) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      page: '1',
      pageSize: '25',
      q: linkQuery.trim(),
    });
    void getJson(documentsPath(organizationId, query), controller.signal)
      .then((payload) => documentListResponseSchema.parse(payload))
      .then((payload) => {
        setCandidates(
          payload.documents.filter((summary) => summary.id !== documentId),
        );
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setCandidates([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [documentId, linkQuery, organizationId]);

  // The write answers with the whole document, so nothing has to be read back.
  async function changeStatus(status: DocumentStatus): Promise<void> {
    try {
      const updated = await sendJson(
        {
          body: { status },
          method: 'PATCH',
          path: documentPath(organizationId, documentId),
        },
        documentDetailSchema,
      );
      setStatusFailed(false);
      setResult({ key: detailKey, value: updated });
      notify({ kind: 'success', title: t('documents.statusUpdated') });
    } catch {
      setStatusFailed(true);
    }
  }

  // A link write answers with the one link it touched, so only the list changes.
  function replaceLinks(
    change: (links: DocumentDetail['links']) => DocumentDetail['links'],
  ): void {
    setResult((current) =>
      current?.value === undefined
        ? current
        : {
            key: current.key,
            value: { ...current.value, links: change(current.value.links) },
          },
    );
  }

  async function addLink(): Promise<void> {
    if (linkTargetId.length === 0) {
      return;
    }

    try {
      const link = await sendJson(
        {
          body: { kind: linkKind, toDocumentId: linkTargetId },
          method: 'POST',
          path: documentLinksPath(organizationId, documentId),
        },
        documentLinkSchema,
      );
      setLinkFailed(false);
      setLinkTargetId('');
      setLinkModalOpen(false);
      replaceLinks((links) => [...links, link]);
      notify({ kind: 'success', title: t('documents.linkAdded') });
    } catch {
      setLinkFailed(true);
    }
  }

  async function removeLink(linkId: string): Promise<void> {
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: documentLinkPath(organizationId, documentId, linkId),
      });
      setLinkFailed(false);
      replaceLinks((links) => links.filter((link) => link.id !== linkId));
      notify({ kind: 'success', title: t('documents.linkRemoved') });
    } catch {
      setLinkFailed(true);
    }
  }

  function inboxHref(id: string): string {
    return withOrganization(
      `/inbox/${encodeURIComponent(id)}`,
      organization.slug,
    );
  }

  function documentHref(id: string): string {
    return withOrganization(
      `/documents/${encodeURIComponent(id)}`,
      organization.slug,
    );
  }

  if (state === 'error') {
    return (
      <PageContainer>
        <h1>{t('documents.title')}</h1>
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.detailError')}
        />
      </PageContainer>
    );
  }

  if (detail === undefined) {
    return (
      <PageContainer>
        <h1>{t('documents.title')}</h1>
        <p>{t('documents.detailLoading')}</p>
      </PageContainer>
    );
  }

  const document = detail.document;
  const currency = document.currencyCode;
  const empty = t('documents.detail.emptyValue');
  const invoiceKind = isInvoiceKind(document.kind);
  const attributes = Object.entries(detail.attributes);
  const openIssues = detail.issues.filter((issue) => issue.resolvedAt === null);
  const files = detail.files;
  const inboxItems = detail.inboxItems;
  const kindLabel = t(documentKindLabelKeys[document.kind]);

  // createElement keeps the kind glyph from reading as a component built during render.
  const kindGlyph = (className: string, size: number): ReactNode =>
    createElement(documentKindIcon(document.kind), {
      className,
      size,
      title: kindLabel,
    });

  // The title stands in for a filename with the reference, so a scan never reads as its blob name.
  const titleIsFilename = files.some(
    (file) => file.filename !== null && file.filename === document.title,
  );
  const displayTitle =
    titleIsFilename && document.reference !== null
      ? document.reference
      : document.title;

  // The one-line summary of what the document is, by labels and never by a code.
  const metaParts = [t(documentKindLabelKeys[document.kind])];
  if (document.reference !== null) {
    metaParts.push(document.reference);
  }
  metaParts.push(formatDate(document.documentDate));
  if (document.partnerName !== null) {
    metaParts.push(document.partnerName);
  }
  const metaLine = metaParts.join(' · ');

  const primaryStatus = primaryStatusFor(document.status);
  const primaryLabelKey =
    primaryStatus === 'verified'
      ? 'documents.markVerified'
      : primaryStatus === 'archived'
        ? 'documents.archive'
        : null;
  const overflowStatuses = statusActions.filter(
    (action) =>
      action.status !== document.status && action.status !== primaryStatus,
  );

  // The summary tile holds a fixed sixteen pairs; a missing value prints an em dash.
  const entityName = legalEntities.find(
    (entity) => entity.id === document.legalEntityId,
  )?.name;
  const itemVatModes = new Set(
    (detail.invoice?.lines ?? [])
      .filter((line) => line.lineKind === 'item')
      .map((line) => line.vatMode),
  );
  const vatModeValue =
    itemVatModes.size === 1
      ? t(vatModeLabelKeys[[...itemVatModes][0]!])
      : empty;
  const summaryItems: Readonly<{ label: string; value: ReactNode }>[] = [
    {
      label: t('documents.fieldReference'),
      value: document.reference ?? empty,
    },
    {
      label: t('documents.fieldDate'),
      value: formatDate(document.documentDate),
    },
    {
      label: t('documents.fieldDueDate'),
      value:
        detail.invoice?.dueDate == null
          ? empty
          : formatDate(detail.invoice.dueDate),
    },
    {
      label: t('documents.fieldPartner'),
      value: document.partnerName ?? empty,
    },
    { label: t('documents.entity'), value: entityName ?? empty },
    {
      label: t('documents.fieldKind'),
      value: (
        <span className={styles.kindValue!}>
          {kindGlyph(styles.kindIcon!, 16)}
          {kindLabel}
        </span>
      ),
    },
    { label: t('documents.fieldCurrency'), value: currency },
    {
      label: t('documents.columnTotal'),
      value:
        document.totalAmount === null
          ? empty
          : formatMoney(document.totalAmount, currency),
    },
    {
      label: t('documents.totalAmountDue'),
      value:
        detail.invoice === null
          ? empty
          : formatMoney(detail.invoice.amountDue, currency),
    },
    { label: t('documents.lineVatMode'), value: vatModeValue },
    {
      label: t('documents.detail.fieldSource'),
      value: t(documentSourceLabelKeys[document.source]),
    },
    {
      label: t('documents.detail.fieldVersion'),
      value: String(document.version),
    },
    {
      label: t('documents.columnStatus'),
      value: (
        <StatusIndicator
          label={t(documentStatusLabelKeys[document.status])}
          severity={documentStatusSeverity[document.status]}
        />
      ),
    },
    {
      label: t('documents.columnIssues'),
      value:
        document.openIssueCount > 0 ? (
          <Tag size="sm" type="red">
            {t('documents.detail.issuesCount', {
              count: document.openIssueCount,
            })}
          </Tag>
        ) : (
          t('documents.detail.noIssues')
        ),
    },
    {
      label: t('documents.detail.fieldFiledFromInbox'),
      value:
        inboxItems.length === 0 ? empty : formatDate(inboxItems[0]!.receivedAt),
    },
    {
      label: t('documents.detail.fieldFiles'),
      value: files.length === 0 ? empty : String(files.length),
    },
  ];

  // The invoice lines plus a rounding row when it carries a value; the amount due is the totals row.
  const lineColumns: GridColumn[] = [
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
  const lineRows: GridRow[] = (detail.invoice?.lines ?? []).map((line) => {
    // A deduction is stored non negative, so it is shown negated to sum to the amount due.
    const sign = line.lineKind === 'advance_deduction' ? -1n : 1n;
    const vatUnits = decimalUnits(line.vatAmount) ?? 0n;
    const totalUnits = (decimalUnits(line.baseAmount) ?? 0n) + vatUnits;
    return {
      description: line.description,
      id: line.id,
      marker: sign < 0n ? 'advance' : '',
      quantity: line.quantity ?? empty,
      total: formatMoney(formatDecimalUnits(sign * totalUnits), currency),
      unitPrice:
        line.unitPrice === null ? empty : formatMoney(line.unitPrice, currency),
      vat: formatMoney(formatDecimalUnits(sign * vatUnits), currency),
    };
  });
  if (
    detail.invoice !== null &&
    (decimalUnits(detail.invoice.roundingAmount) ?? 0n) !== 0n
  ) {
    lineRows.push({
      description: t('documents.totalRounding'),
      id: 'rounding',
      marker: '',
      quantity: '',
      total: formatMoney(detail.invoice.roundingAmount, currency),
      unitPrice: '',
      vat: '',
    });
  }
  const linesTotalsRow: Readonly<Record<string, ReactNode>> | undefined =
    detail.invoice === null
      ? undefined
      : {
          description: t('documents.totalAmountDue'),
          total: formatMoney(detail.invoice.amountDue, currency),
        };

  // The derived double entry with the balance as its totals row.
  const eventColumns: GridColumn[] = [
    { header: t('documents.eventColumnAccount'), key: 'account' },
    { align: 'end', header: t('documents.eventColumnDebit'), key: 'debit' },
    { align: 'end', header: t('documents.eventColumnCredit'), key: 'credit' },
  ];
  const eventRows: GridRow[] = (detail.event?.lines ?? []).map((line) => ({
    account: `${line.accountCode} ${line.accountName}`,
    credit: line.side === 'credit' ? formatMoney(line.amount, currency) : '',
    debit: line.side === 'debit' ? formatMoney(line.amount, currency) : '',
    id: String(line.lineNo),
  }));
  const eventTotalsRow: Readonly<Record<string, ReactNode>> | undefined =
    detail.event === null
      ? undefined
      : {
          account: t('documents.detail.eventBalance'),
          credit: formatMoney(detail.event.creditTotal, currency),
          debit: formatMoney(detail.event.debitTotal, currency),
        };

  // The linked documents, each opened by a labelled link, never by its identifier.
  const linkColumns: GridColumn[] = [
    { header: t('documents.linkKind'), key: 'relationship' },
    {
      header: t('documents.detail.linkDocument'),
      key: 'document',
      renderCell: (row) => (
        <Link href={String(row['href'])}>
          {t('documents.detail.openDocument')}
        </Link>
      ),
    },
    { header: t('documents.detail.dateColumn'), key: 'date' },
  ];
  const linkRows: GridRow[] = detail.links.map((link) => ({
    date: formatDate(link.createdAt),
    document: '',
    href: documentHref(
      link.fromDocumentId === document.id
        ? link.toDocumentId
        : link.fromDocumentId,
    ),
    id: link.id,
    relationship: t(documentLinkKindLabelKeys[link.kind]),
  }));
  const linkToolbarActions: ToolbarAction[] = canManage
    ? [
        {
          id: 'link',
          label: t('documents.detail.linkAction'),
          onClick: () => {
            setLinkModalOpen(true);
          },
        },
      ]
    : [];
  const linkRowActions = canManage
    ? (row: GridRow): RowAction[] => [
        {
          id: 'remove',
          isDelete: true,
          label: t('documents.removeLink'),
          onClick: () => {
            void removeLink(row.id);
          },
        },
      ]
    : undefined;

  // The activity, newest first, from what the detail exposes and nothing invented.
  type ActivityEntry = Readonly<{ href?: string; id: string; text: string }>;
  const activityEntries: ActivityEntry[] = [];
  if (detail.supersededByDocumentId !== null) {
    activityEntries.push({
      href: documentHref(detail.supersededByDocumentId),
      id: 'superseded-by',
      text: t('documents.supersededByLink'),
    });
  }
  for (const item of inboxItems) {
    activityEntries.push({
      href: inboxHref(item.id),
      id: `filed-${item.id}`,
      text: t('documents.detail.filedFromInbox', {
        date: formatDate(item.receivedAt),
      }),
    });
  }
  if (detail.supersedesDocumentId !== null) {
    activityEntries.push({
      href: documentHref(detail.supersedesDocumentId),
      id: 'supersedes',
      text: t('documents.supersedesLink'),
    });
  }
  activityEntries.push({
    id: 'registered',
    text: t('documents.detail.activityRegistered', {
      date: formatDate(document.createdAt),
    }),
  });

  const originalPanel = (
    <div className={styles.originalLayout!}>
      {files[0] === undefined ? (
        <p>{t('documents.detail.noOriginal')}</p>
      ) : (
        <OriginalPreview
          file={{
            blobId: files[0].blobId,
            byteSize: files[0].byteSize,
            mediaType: files[0].mediaType,
            name: files[0].filename,
          }}
          frameTitle={t('documents.detail.previewFrame')}
          noPreviewLabel={t('documents.detail.noPreview')}
          organizationId={organizationId}
        />
      )}
      <Stack gap={5}>
        {files.length === 0 ? null : (
          <ContainedList
            kind="on-page"
            label={t('documents.originalsTitle')}
            size="sm"
          >
            {files.map((file) => {
              const name =
                file.filename ??
                t('documents.originalFile', {
                  position: String(file.position),
                });
              return (
                <ContainedListItem
                  action={
                    // A short link keeps the action slot narrow; the file name is its accessible name.
                    <Link
                      aria-label={t('documents.detail.downloadNamed', { name })}
                      href={inboxBlobDownloadPath(organizationId, file.blobId)}
                    >
                      {t('documents.detail.download')}
                    </Link>
                  }
                  key={file.blobId}
                >
                  <span className={styles.fileName!} title={name}>
                    {name}
                  </span>
                </ContainedListItem>
              );
            })}
          </ContainedList>
        )}
        {inboxItems.map((item) => (
          <Link href={inboxHref(item.id)} key={item.id}>
            {t('documents.detail.filedFromInbox', {
              date: formatDate(item.receivedAt),
            })}
          </Link>
        ))}
      </Stack>
    </div>
  );

  const linesPanel = (
    <DataGrid
      ariaLabel={t('documents.invoiceLines')}
      columns={lineColumns}
      fitContainer
      rows={lineRows}
      {...(linesTotalsRow === undefined ? {} : { totalsRow: linesTotalsRow })}
    />
  );

  const eventPanel = (
    <Stack gap={5}>
      {detail.event !== null && !detail.event.isBalanced ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.eventUnbalanced')}
        />
      ) : null}
      <DataGrid
        ariaLabel={t('documents.eventTitle')}
        columns={eventColumns}
        fitContainer
        rows={eventRows}
        {...(eventTotalsRow === undefined ? {} : { totalsRow: eventTotalsRow })}
      />
    </Stack>
  );

  const linksPanel = (
    <DataGrid
      ariaLabel={t('documents.linksTitle')}
      columns={linkColumns}
      emptyLabel={t('documents.linksNone')}
      fitContainer
      rows={linkRows}
      toolbarActions={linkToolbarActions}
      {...(linkRowActions === undefined ? {} : { rowActions: linkRowActions })}
    />
  );

  const activityPanel = (
    <UnorderedList aria-label={t('documents.detail.activityLabel')}>
      {activityEntries.map((entry) => (
        <ListItem key={entry.id}>
          {entry.href === undefined ? (
            entry.text
          ) : (
            <Link href={entry.href}>{entry.text}</Link>
          )}
        </ListItem>
      ))}
    </UnorderedList>
  );

  const tabs: Readonly<{ key: string; label: string; panel: ReactNode }>[] = [
    {
      key: 'original',
      label: t('documents.detail.tabOriginal'),
      panel: originalPanel,
    },
  ];
  if (invoiceKind && detail.invoice !== null) {
    tabs.push({
      key: 'lines',
      label: t('documents.detail.tabLines', {
        count: detail.invoice.lines.length,
      }),
      panel: linesPanel,
    });
  }
  if (detail.event !== null) {
    tabs.push({
      key: 'event',
      label: t('documents.detail.tabEvent'),
      panel: eventPanel,
    });
  }
  tabs.push({
    key: 'links',
    label: t('documents.detail.tabLinks', { count: detail.links.length }),
    panel: linksPanel,
  });
  tabs.push({
    key: 'activity',
    label: t('documents.detail.tabActivity'),
    panel: activityPanel,
  });

  // Invoices open on their lines; every other kind opens on the original.
  const linesIndex = tabs.findIndex((tab) => tab.key === 'lines');
  const defaultTabIndex = linesIndex === -1 ? 0 : linesIndex;

  return (
    <PageContainer>
      {statusFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.statusFailed')}
        />
      ) : null}
      {linkFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.linkFailed')}
        />
      ) : null}

      <div className={styles.header!}>
        <div className={styles.headerText!}>
          <div className={styles.titleRow!}>
            {kindGlyph(styles.titleIcon!, 20)}
            <h1 className={styles.title!}>{displayTitle}</h1>
          </div>
          <p className={styles.meta!}>{metaLine}</p>
          <div className={styles.tags!}>
            <StatusIndicator
              label={t(documentStatusLabelKeys[document.status])}
              severity={documentStatusSeverity[document.status]}
            />
            {document.version > 1 ? (
              <Tag size="sm" type="outline">
                {t('documents.detail.versionTag', {
                  version: document.version,
                })}
              </Tag>
            ) : null}
          </div>
        </div>
        {canManage ? (
          <div className={styles.headerActions!}>
            {primaryStatus !== null && primaryLabelKey !== null ? (
              <Button
                onClick={() => {
                  void changeStatus(primaryStatus);
                }}
                type="button"
              >
                {t(primaryLabelKey)}
              </Button>
            ) : null}
            <OverflowMenu
              aria-label={t('documents.detail.moreActions')}
              flipped
              iconDescription={t('documents.detail.moreActions')}
            >
              {overflowStatuses.map((action) => (
                <OverflowMenuItem
                  itemText={t(action.labelKey)}
                  key={action.status}
                  onClick={() => {
                    void changeStatus(action.status);
                  }}
                />
              ))}
              <OverflowMenuItem
                itemText={t('documents.detail.linkAction')}
                onClick={() => {
                  setLinkModalOpen(true);
                }}
              />
              {inboxItems.length > 0 ? (
                <OverflowMenuItem
                  href={inboxHref(inboxItems[0]!.id)}
                  itemText={t('documents.detail.openInInbox')}
                />
              ) : null}
            </OverflowMenu>
          </div>
        ) : null}
      </div>

      <Tile>
        <Stack gap={5}>
          <h2 className={styles.summaryTitle!}>
            {t('documents.detail.summaryTitle')}
          </h2>
          <dl className={styles.summaryGrid!}>
            {summaryItems.map((item) => (
              <div className={styles.summaryItem!} key={item.label}>
                <dt className={styles.summaryLabel!}>{item.label}</dt>
                <dd className={styles.summaryValue!}>{item.value}</dd>
              </div>
            ))}
          </dl>
          {!invoiceKind && attributes.length > 0 ? (
            <dl className={styles.summaryGrid!}>
              {attributes.map(([key, value]) => (
                <div className={styles.summaryItem!} key={key}>
                  <dt className={styles.summaryLabel!}>{key}</dt>
                  <dd className={styles.summaryValue!}>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {document.openIssueCount > 0 ? (
            <ul
              aria-label={t('documents.issuesTitle')}
              className={styles.issueList!}
            >
              {openIssues.map((issue) => (
                <li className={styles.issueItem!} key={issue.id}>
                  <Tag size="sm" type="red">
                    {t(dataIssueLabelKeys[issue.code])}
                  </Tag>
                </li>
              ))}
            </ul>
          ) : null}
        </Stack>
      </Tile>

      <div className={styles.tabs!}>
        <Tabs defaultSelectedIndex={defaultTabIndex}>
          <TabList aria-label={t('documents.title')}>
            {tabs.map((tab) => (
              <Tab key={tab.key}>{tab.label}</Tab>
            ))}
          </TabList>
          <TabPanels>
            {tabs.map((tab) => (
              <TabPanel key={tab.key}>{tab.panel}</TabPanel>
            ))}
          </TabPanels>
        </Tabs>
      </div>

      {linkModalOpen ? (
        <Modal
          modalHeading={t('documents.detail.linkModalTitle')}
          onRequestClose={() => {
            setLinkModalOpen(false);
          }}
          onRequestSubmit={() => {
            void addLink();
          }}
          open
          primaryButtonDisabled={linkTargetId.length === 0}
          primaryButtonText={t('documents.addLink')}
          secondaryButtonText={t('documents.cancel')}
        >
          <Stack gap={5}>
            <Select
              id="document-link-kind"
              labelText={t('documents.linkKind')}
              onChange={(event) => {
                const parsed = documentLinkKindSchema.safeParse(
                  event.target.value,
                );
                setLinkKind(parsed.success ? parsed.data : 'relates');
              }}
              value={linkKind}
            >
              {documentLinkKindSchema.options.map((option) => (
                <SelectItem
                  key={option}
                  text={t(documentLinkKindLabelKeys[option])}
                  value={option}
                />
              ))}
            </Select>
            <ComboBox
              id="document-link-target"
              items={candidates}
              itemToString={(item) => (item === null ? '' : item.title)}
              onChange={(change) => {
                setLinkTargetId(change.selectedItem?.id ?? '');
              }}
              onInputChange={(value) => {
                setLinkQuery(value);
              }}
              selectedItem={
                candidates.find((summary) => summary.id === linkTargetId) ??
                null
              }
              titleText={t('documents.linkTarget')}
            />
          </Stack>
        </Modal>
      ) : null}
    </PageContainer>
  );
}
