'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  BatchAction,
  GridColumn,
  GridRow,
  ToolbarAction,
} from '@bap/design-system/blocks';
import {
  Button,
  DismissibleTag,
  InlineNotification,
  Link,
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
  TextInput,
} from '@bap/design-system/react';
import {
  DataSet,
  DataTable,
  Document,
  DocumentPdf,
  DocumentUnknown,
  Email,
  Finance,
  Image,
  Txt,
  Upload,
  Xml,
} from '@bap/design-system/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UploadModal } from '../../../components/inbox/upload-modal';
import PageContainer from '../../../components/page-container';
import { StatusIndicator } from '../../../components/status-indicator';
import { getJson } from '../../../lib/datasets/client';
import { withOrganization } from '../../../lib/documents/client';
import { bulkInboxItems, inboxItemsPath } from '../../../lib/inbox/client';
import { inboxLastSeenKey, isNewSince } from '../../../lib/inbox/last-seen.ts';
import {
  DEFAULT_INBOX_PAGE_SIZE,
  INBOX_ASSIGNEE_NONE,
  inboxBulkActionSchema,
  inboxConfidenceBandSchema,
  inboxDiscardReasonSchema,
  inboxIssueCodeSchema,
  inboxItemListResponseSchema,
} from '../../../lib/inbox/contract.ts';
import type {
  BulkInboxItemsRequest,
  BulkInboxItemsResponse,
  InboxBulkAction,
  InboxConfidenceBand,
  InboxDetectedType,
  InboxDiscardReason,
  InboxIssueCode,
  InboxItemCounts,
  InboxItemListEntry,
  InboxItemListResponse,
} from '../../../lib/inbox/contract.ts';
import {
  inboxBulkActionLabelKeys,
  inboxBulkRefusalCodeLabelKeys,
  inboxConfidenceBandLabelKeys,
  inboxDiscardReasonLabelKeys,
  inboxListStatusLabelKeys,
  inboxSourceLabelKeys,
  inboxStatusSeverity,
  inboxTabQuery,
  inboxTabs,
  isInboxTab,
} from '../../../lib/inbox/labels.ts';
import type {
  InboxListStatusWord,
  InboxTab,
} from '../../../lib/inbox/labels.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { useMembers } from '../../../lib/inbox/use-members';
import styles from './page.module.scss';

const pageSizes = [25, 50, 100];
const tabLabelKeys: Readonly<Record<InboxTab, string>> = {
  all: 'inbox.list.tabAll',
  discarded: 'inbox.list.tabDiscarded',
  filed: 'inbox.list.tabFiled',
  toReview: 'inbox.list.tabToReview',
};

const tabCountKeys: Readonly<Record<InboxTab, keyof InboxItemCounts>> = {
  all: 'all',
  discarded: 'discarded',
  filed: 'filed',
  toReview: 'toReview',
};

// One icon per detected file type; the detected type rides along as the icon's tooltip.
const detectedTypeIcons: Readonly<Record<string, typeof Document>> = {
  camt_statement: Finance,
  gpc_statement: Finance,
  image: Image,
  isdoc_invoice: Xml,
  money_s3_export: Xml,
  pdf: DocumentPdf,
  pohoda_export: Xml,
  tabular: DataTable,
  text: Txt,
  unknown: DocumentUnknown,
} satisfies Record<InboxDetectedType, typeof Document>;

// Fallback icon per payload kind when the detected type is missing or unmapped.
const payloadIcons: Readonly<Record<string, typeof Document>> = {
  email: Email,
  file: Document,
  structured: DataSet,
  text: Txt,
};

function storedPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function storedPageSize(value: string | null): number {
  const size = Number(value);
  return pageSizes.includes(size) ? size : DEFAULT_INBOX_PAGE_SIZE;
}

// A stored filter value is taken only when the contract still names it; anything else is no filter.
function storedIssue(value: string | null): InboxIssueCode | '' {
  const parsed = inboxIssueCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : '';
}

function storedConfidence(value: string | null): InboxConfidenceBand | '' {
  const parsed = inboxConfidenceBandSchema.safeParse(value);
  return parsed.success ? parsed.data : '';
}

function asDiscardReason(value: string): InboxDiscardReason {
  const parsed = inboxDiscardReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : 'irrelevant';
}

type ListResult = Readonly<{ key: string; value?: InboxItemListResponse }>;
// The batch action a person picked and the ids it will run on, while its modal asks for the field.
type PendingBulk = Readonly<{
  action: InboxBulkAction;
  ids: readonly string[];
}>;

export default function InboxPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const members = useMembers(organizationId);
  const [tab, setTab] = useState<InboxTab>(() => {
    const stored = searchParams.get('tab');
    return isInboxTab(stored) ? stored : 'toReview';
  });
  const [page, setPage] = useState(() => storedPage(searchParams.get('page')));
  const [pageSize, setPageSize] = useState(() =>
    storedPageSize(searchParams.get('pageSize')),
  );
  const [issue, setIssue] = useState(() =>
    storedIssue(searchParams.get('issue')),
  );
  const [confidence, setConfidence] = useState(() =>
    storedConfidence(searchParams.get('confidence')),
  );
  const [assignee, setAssignee] = useState(
    () => searchParams.get('assigneeId') ?? '',
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<ListResult>();
  const [pending, setPending] = useState<PendingBulk>();
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkSnoozedUntil, setBulkSnoozedUntil] = useState('');
  const [bulkReason, setBulkReason] =
    useState<InboxDiscardReason>('irrelevant');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailed, setBulkFailed] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkInboxItemsResponse>();
  const [dragDepth, setDragDepth] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDropFiles, setUploadDropFiles] = useState<readonly File[]>([]);
  // The "New" baseline is read once per load while the organization resolves; the write stays in an effect.
  const [seen, setSeen] = useState<{ baseline: string | null; org: string }>();
  if (
    organizationId.length > 0 &&
    seen?.org !== organizationId &&
    typeof window !== 'undefined'
  ) {
    setSeen({
      baseline: window.localStorage.getItem(inboxLastSeenKey(organizationId)),
      org: organizationId,
    });
  }
  useEffect(() => {
    if (seen === undefined) {
      return;
    }
    window.localStorage.setItem(
      inboxLastSeenKey(seen.org),
      new Date().toISOString(),
    );
  }, [seen]);
  const newBaseline = seen?.org === organizationId ? seen.baseline : null;

  const query = useMemo(() => {
    const params = inboxTabQuery(tab);
    if (issue.length > 0) {
      params.set('issue', issue);
    }
    if (assignee.length > 0) {
      params.set('assigneeId', assignee);
    }
    if (confidence.length > 0) {
      params.set('confidence', confidence);
    }
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params;
  }, [assignee, confidence, issue, page, pageSize, tab]);
  const queryKey = `${query.toString()}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    // A superseded request may still resolve, so only the live one writes its result.
    void getJson(inboxItemsPath(organizationId, query), controller.signal)
      .then((payload) => inboxItemListResponseSchema.parse(payload))
      .then((payload) => {
        if (!controller.signal.aborted) {
          setResult({ key: queryKey, value: payload });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key: queryKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, query, queryKey]);

  // The browser URL keeps the whole view, so a reload or a shared link reopens it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (organization.slug.length > 0) {
      params.set('organization', organization.slug);
    }
    params.set('tab', tab);
    if (issue.length > 0) {
      params.set('issue', issue);
    }
    if (assignee.length > 0) {
      params.set('assigneeId', assignee);
    }
    if (confidence.length > 0) {
      params.set('confidence', confidence);
    }
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [assignee, confidence, issue, organization.slug, page, pageSize, tab]);

  const refresh = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  // The result carries the query it answered, so a stale page is never shown as current.
  const list = result?.key === queryKey ? result.value : undefined;
  const counts = list?.counts;
  const canRead = access?.capabilities.readDocuments ?? false;
  const canManage = access?.capabilities.manageDocuments ?? false;
  const canManageChannels = access?.capabilities.manageOrganization ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || result?.key !== queryKey));
  const failed =
    organization.state === 'error' ||
    (result?.key === queryKey && result.value === undefined);
  const hasFilters =
    issue.length > 0 || confidence.length > 0 || assignee.length > 0;

  const entityNames = new Map(
    legalEntities.map((entity) => [entity.id, entity.name]),
  );
  const memberNames = new Map(
    (members ?? []).map((member) => [member.id, member.name]),
  );
  const itemsById = new Map(
    (list?.items ?? []).map((item) => [item.id, item] as const),
  );

  function itemHref(itemId: string): string {
    const params = new URLSearchParams();
    if (organization.slug.length > 0) {
      params.set('organization', organization.slug);
    }
    params.set('tab', tab);
    return `/inbox/${encodeURIComponent(itemId)}?${params.toString()}`;
  }

  // The status word: a synthetic "Snoozed" for an open item held into the future, else the plain status.
  function statusWord(item: InboxItemListEntry): InboxListStatusWord {
    const open =
      item.status === 'received' ||
      item.status === 'processing' ||
      item.status === 'needs_review' ||
      item.status === 'failed';
    if (
      open &&
      item.snoozedUntil !== null &&
      new Date(item.snoozedUntil).getTime() > Date.now()
    ) {
      return 'snoozed';
    }
    return item.status;
  }

  // Who filed or discarded the item, in plain words; empty on an item still in review.
  function decidedByText(item: InboxItemListEntry): string {
    if (item.status !== 'routed' && item.status !== 'discarded') {
      return '';
    }
    switch (item.decidedByKind) {
      case 'rule':
        return item.decidedByRuleName === null
          ? t('inbox.list.decidedByDefault')
          : t('inbox.list.decidedByRuleNamed', {
              name: item.decidedByRuleName,
            });
      case 'user':
        if (item.decidedByUserId === null) {
          return t('inbox.list.memberFormer');
        }
        // Undefined while the list loads or after it failed, so a neutral name shows, never "former".
        if (members === undefined) {
          return t('inbox.list.member');
        }
        return (
          memberNames.get(item.decidedByUserId) ?? t('inbox.list.memberFormer')
        );
      case 'hint':
        return t('inbox.list.decidedByChannelDefault');
      default:
        return t('inbox.list.decidedByDefault');
    }
  }

  // The first file names the item, or the sender for an email; the rest are counted as "+N files".
  function itemPrimary(item: InboxItemListEntry): string {
    if (item.payloadKind === 'email') {
      return item.sender ?? item.primaryFilename ?? t('inbox.notAvailable');
    }
    return item.primaryFilename ?? item.sender ?? t('inbox.notAvailable');
  }

  // A page drop opens the upload modal with the files; reset depth since the modal swallows the drop.
  const openUploadWith = useCallback((files: readonly File[]): void => {
    setUploadDropFiles(files);
    setUploadOpen(true);
    setDragDepth(0);
  }, []);

  // One request for the page of ids; the answer is counted per id, never trusted as a whole.
  async function runBulk(): Promise<void> {
    if (pending === undefined) {
      return;
    }
    const body: BulkInboxItemsRequest = {
      action: pending.action,
      itemIds: [...pending.ids],
      ...(pending.action === 'assign'
        ? {
            assigneeId:
              bulkAssignee === INBOX_ASSIGNEE_NONE || bulkAssignee.length === 0
                ? null
                : bulkAssignee,
          }
        : pending.action === 'snooze'
          ? { snoozedUntil: new Date(bulkSnoozedUntil).toISOString() }
          : pending.action === 'discard'
            ? { reason: bulkReason }
            : {}),
    };
    setBulkBusy(true);
    setBulkFailed(false);
    try {
      setBulkResult(await bulkInboxItems(organizationId, body));
      setPending(undefined);
      refresh();
    } catch {
      setBulkFailed(true);
    } finally {
      setBulkBusy(false);
    }
  }

  const batchActions: readonly BatchAction[] =
    inboxBulkActionSchema.options.map((action) => ({
      id: action,
      label: t(inboxBulkActionLabelKeys[action]),
      onClick: (ids) => {
        setBulkResult(undefined);
        setBulkAssignee(INBOX_ASSIGNEE_NONE);
        setPending({ action, ids });
      },
    }));
  // The Filter toggle lives in the grid toolbar; the batch bar overlays it on selection.
  const toolbarActions: readonly ToolbarAction[] = [
    {
      id: 'filter',
      kind: 'ghost',
      label: t('inbox.list.filter'),
      onClick: () => {
        setFiltersOpen((open) => !open);
      },
    },
  ];
  const refused =
    bulkResult?.results.filter((entry) => entry.status === 'refused') ?? [];
  const refusedIds = refused.map((entry) => entry.itemId);
  const refusedSummary = refused
    .map((entry) =>
      entry.code === undefined
        ? entry.itemId
        : `${entry.itemId} (${t(inboxBulkRefusalCodeLabelKeys[entry.code])})`,
    )
    .join(', ');

  // Decided by is meaningful only on the settled tabs, so it rides along there.
  const showDecidedBy = tab === 'filed' || tab === 'discarded';
  const columns: readonly GridColumn[] = [
    {
      header: t('inbox.list.columnItem'),
      key: 'item',
      renderCell: (row) => {
        const item = itemsById.get(row.id);
        if (item === undefined) {
          return null;
        }
        const Icon =
          (item.detectedType
            ? detectedTypeIcons[item.detectedType]
            : undefined) ??
          payloadIcons[item.payloadKind] ??
          DocumentUnknown;
        const extra = item.fileCount - 1;
        const primary = itemPrimary(item);
        return (
          <span className={styles.itemCell!}>
            <Icon
              aria-hidden="true"
              className={styles.itemIcon!}
              size={20}
              title={item.detectedType ?? undefined}
            />
            <span className={styles.itemName!} title={primary}>
              {primary}
            </span>
            {/* The MIME From is unauthenticated, so a sender shown as the name carries the detail's verdict. */}
            {primary === item.sender && !item.senderAuthenticated ? (
              <StatusIndicator
                label={t('inbox.senderUnverified')}
                severity="neutral"
              />
            ) : null}
            {isNewSince(newBaseline, item.receivedAt) ? (
              <Tag size="sm" type="blue">
                {t('inbox.list.new')}
              </Tag>
            ) : null}
            {extra > 0 ? (
              <span className={styles.moreFiles!}>
                {t('inbox.list.moreFiles', { count: extra })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    { header: t('inbox.list.columnReceived'), key: 'received', width: 160 },
    {
      header: t('inbox.list.columnSource'),
      key: 'source',
      renderCell: (row) => {
        const item = itemsById.get(row.id);
        if (item === undefined) {
          return null;
        }
        // The origin becomes a tooltip so the source stays one narrow line.
        return (
          <span title={item.origin ?? undefined}>
            {t(inboxSourceLabelKeys[item.channelKind])}
          </span>
        );
      },
      width: 96,
    },
    { header: t('inbox.list.columnEntity'), key: 'legalEntity', width: 132 },
    {
      header: t('inbox.list.columnStatus'),
      key: 'status',
      renderCell: (row) => {
        const item = itemsById.get(row.id);
        if (item === undefined) {
          return null;
        }
        const word = statusWord(item);
        return (
          <StatusIndicator
            label={t(inboxListStatusLabelKeys[word])}
            severity={
              word === 'snoozed' ? 'neutral' : inboxStatusSeverity[word]
            }
          />
        );
      },
      width: 140,
    },
    ...(showDecidedBy
      ? [
          {
            header: t('inbox.list.columnDecidedBy'),
            key: 'decidedBy',
            renderCell: (row: GridRow) => {
              const item = itemsById.get(row.id);
              return item === undefined ? null : decidedByText(item);
            },
            width: 132,
          },
        ]
      : []),
    {
      header: t('inbox.list.columnAction'),
      key: 'action',
      width: 100,
      renderCell: (row) => {
        const item = itemsById.get(row.id);
        if (item === undefined) {
          return null;
        }
        const review = tab === 'toReview';
        return (
          <Link
            aria-label={t(
              review
                ? 'inbox.list.actionReviewNamed'
                : 'inbox.list.actionOpenNamed',
              { name: itemPrimary(item) },
            )}
            href={itemHref(item.id)}
          >
            {t(review ? 'inbox.list.actionReview' : 'inbox.list.actionOpen')}
          </Link>
        );
      },
    },
  ];

  // Cells stay primitive so the grid renders them directly; the visuals come from renderCell.
  const rows: readonly GridRow[] = (list?.items ?? []).map((item) => ({
    id: item.id,
    legalEntity:
      item.legalEntityId === null
        ? t('inbox.list.entityNotSet')
        : (entityNames.get(item.legalEntityId) ?? t('inbox.list.entityNotSet')),
    received: formatDateTime(item.receivedAt),
  }));

  const dataGrid = (
    <DataGrid
      ariaLabel={t('inbox.listTitle')}
      batchActions={canManage ? batchActions : []}
      columns={columns}
      emptyLabel={t(hasFilters ? 'inbox.emptyFiltered' : 'inbox.empty')}
      errorLabel={t('inbox.error')}
      fitContainer
      onPageChange={(nextPage, nextPageSize) => {
        setPage(nextPage);
        setPageSize(nextPageSize);
      }}
      onRowClick={(row) => {
        router.push(itemHref(row.id) as Route);
      }}
      page={page}
      pageSize={pageSize}
      pageSizes={pageSizes}
      pagination
      paginationMode="server"
      rows={rows}
      selection={canManage ? 'multi' : 'none'}
      size="md"
      toolbarActions={toolbarActions}
      state={
        failed
          ? 'error'
          : loading
            ? 'loading'
            : rows.length === 0
              ? 'empty'
              : 'ready'
      }
      totalItems={list?.total ?? 0}
    />
  );

  // The active filters as removable tags, shown above the grid.
  const filterTags = hasFilters ? (
    <div className={styles.filterTags!}>
      {issue.length > 0 ? (
        <DismissibleTag
          onClose={() => {
            setIssue('');
            setPage(1);
          }}
          text={`${t('inbox.filterIssue')}: ${issue}`}
          title={t('inbox.list.filterRemove', {
            filter: t('inbox.filterIssue'),
          })}
          type="gray"
        />
      ) : null}
      {confidence !== '' ? (
        <DismissibleTag
          onClose={() => {
            setConfidence('');
            setPage(1);
          }}
          text={`${t('inbox.filterConfidence')}: ${t(
            inboxConfidenceBandLabelKeys[confidence],
          )}`}
          title={t('inbox.list.filterRemove', {
            filter: t('inbox.filterConfidence'),
          })}
          type="gray"
        />
      ) : null}
      {assignee.length > 0 ? (
        <DismissibleTag
          onClose={() => {
            setAssignee('');
            setPage(1);
          }}
          text={`${t('inbox.filterAssignee')}: ${
            assignee === INBOX_ASSIGNEE_NONE
              ? t('inbox.assigneeNone')
              : (memberNames.get(assignee) ?? assignee)
          }`}
          title={t('inbox.list.filterRemove', {
            filter: t('inbox.filterAssignee'),
          })}
          type="gray"
        />
      ) : null}
    </div>
  ) : null;

  // The expandable filter controls, revealed by the Filter toggle.
  const filterPanel = filtersOpen ? (
    <div
      aria-label={t('inbox.list.filtersRegion')}
      className={styles.filterPanel!}
      role="group"
    >
      <Select
        id="inbox-filter-issue"
        labelText={t('inbox.filterIssue')}
        onChange={(event) => {
          setIssue(storedIssue(event.target.value));
          setPage(1);
        }}
        value={issue}
      >
        <SelectItem text={t('inbox.filterIssueAny')} value="" />
        {inboxIssueCodeSchema.options.map((code) => (
          <SelectItem key={code} text={code} value={code} />
        ))}
      </Select>
      <Select
        id="inbox-filter-confidence"
        labelText={t('inbox.filterConfidence')}
        onChange={(event) => {
          setConfidence(storedConfidence(event.target.value));
          setPage(1);
        }}
        value={confidence}
      >
        <SelectItem text={t('inbox.confidenceAny')} value="" />
        {inboxConfidenceBandSchema.options.map((band) => (
          <SelectItem
            key={band}
            text={t(inboxConfidenceBandLabelKeys[band])}
            value={band}
          />
        ))}
      </Select>
      <Select
        id="inbox-filter-assignee"
        labelText={t('inbox.filterAssignee')}
        onChange={(event) => {
          setAssignee(event.target.value);
          setPage(1);
        }}
        value={assignee}
      >
        <SelectItem text={t('inbox.list.filterAssigneeAny')} value="" />
        <SelectItem
          text={t('inbox.assigneeNone')}
          value={INBOX_ASSIGNEE_NONE}
        />
        {(members ?? []).map((member) => (
          <SelectItem key={member.id} text={member.name} value={member.id} />
        ))}
      </Select>
    </div>
  ) : null;

  return (
    <div
      // While the modal is open the page ignores drag events, or its dragenter sticks the overlay.
      onDragEnter={(event) => {
        if (
          !uploadOpen &&
          canManage &&
          event.dataTransfer.types.includes('Files')
        ) {
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }
      }}
      onDragLeave={() => {
        if (!uploadOpen && canManage) {
          setDragDepth((depth) => Math.max(0, depth - 1));
        }
      }}
      onDragOver={(event) => {
        if (
          !uploadOpen &&
          canManage &&
          event.dataTransfer.types.includes('Files')
        ) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (!canManage || uploadOpen) {
          return;
        }
        event.preventDefault();
        setDragDepth(0);
        openUploadWith([...event.dataTransfer.files]);
      }}
    >
      <PageContainer>
        <div className={styles.headingRow!}>
          <h1>{t('inbox.title')}</h1>
          <div className={styles.headingActions!}>
            {canManage ? (
              <Button
                kind="primary"
                onClick={() => {
                  openUploadWith([]);
                }}
                renderIcon={Upload}
                size="md"
              >
                {t('inbox.list.upload')}
              </Button>
            ) : null}
            {canManage || canManageChannels ? (
              <OverflowMenu aria-label={t('inbox.actions')} flipped size="md">
                {canManageChannels ? (
                  <OverflowMenuItem
                    href={withOrganization(
                      '/inbox/channels',
                      organization.slug,
                    )}
                    itemText={t('inbox.list.sources')}
                  />
                ) : null}
                {canManage ? (
                  <OverflowMenuItem
                    href={withOrganization('/inbox/rules', organization.slug)}
                    itemText={t('inbox.rules')}
                  />
                ) : null}
                {canManageChannels ? (
                  <OverflowMenuItem
                    href={withOrganization(
                      '/inbox/settings',
                      organization.slug,
                    )}
                    itemText={t('inbox.settings')}
                  />
                ) : null}
              </OverflowMenu>
            ) : null}
          </div>
        </div>

        {accessState === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('inbox.accessError')}
          />
        ) : null}
        {accessState === 'idle' && !canRead ? (
          <InlineNotification
            kind="warning"
            lowContrast
            title={t('inbox.denied')}
          />
        ) : null}
        {failed ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('inbox.error')}
          />
        ) : null}
        {bulkFailed ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('inbox.writeFailed')}
          />
        ) : null}
        {bulkResult === undefined ? null : (
          <InlineNotification
            kind={refusedIds.length === 0 ? 'success' : 'warning'}
            lowContrast
            role="status"
            {...(refusedIds.length === 0
              ? {}
              : {
                  subtitle: t('inbox.bulkRefused', { ids: refusedSummary }),
                })}
            title={t('inbox.bulkResult', {
              ok: String(bulkResult.results.length - refusedIds.length),
              total: String(bulkResult.results.length),
            })}
          />
        )}

        <div className={styles.tabsRow!}>
          <Tabs
            onChange={(event: { selectedIndex: number }) => {
              const next = inboxTabs[event.selectedIndex];
              if (next !== undefined) {
                setTab(next);
                setPage(1);
              }
            }}
            selectedIndex={inboxTabs.indexOf(tab)}
          >
            <TabList aria-label={t('inbox.list.tabsLabel')}>
              {inboxTabs.map((name) => (
                <Tab key={name}>
                  {/* A reloading list has no count yet, so the label carries none rather than a fake zero. */}
                  {counts === undefined
                    ? t(tabLabelKeys[name])
                    : t('inbox.list.tabWithCount', {
                        count: counts[tabCountKeys[name]],
                        label: t(tabLabelKeys[name]),
                      })}
                </Tab>
              ))}
            </TabList>
            <TabPanels>
              {inboxTabs.map((name, index) => (
                <TabPanel key={name}>
                  {index === inboxTabs.indexOf(tab) ? (
                    <div className={styles.gridStack!}>
                      {filterTags}
                      {filterPanel}
                      {dataGrid}
                    </div>
                  ) : null}
                </TabPanel>
              ))}
            </TabPanels>
          </Tabs>
        </div>

        {pending === undefined ? null : (
          <Modal
            modalHeading={t(inboxBulkActionLabelKeys[pending.action])}
            onRequestClose={() => {
              setPending(undefined);
            }}
            onRequestSubmit={() => {
              void runBulk();
            }}
            open
            primaryButtonDisabled={
              bulkBusy ||
              (pending.action === 'snooze' && bulkSnoozedUntil.length === 0)
            }
            primaryButtonText={t(inboxBulkActionLabelKeys[pending.action])}
            secondaryButtonText={t('inbox.cancel')}
          >
            <Stack gap={5}>
              <p>{t('inbox.bulkSelected', { count: pending.ids.length })}</p>
              {pending.action === 'assign' ? (
                <Select
                  id="inbox-bulk-assignee"
                  labelText={t('inbox.assignee')}
                  onChange={(event) => {
                    setBulkAssignee(event.target.value);
                  }}
                  value={bulkAssignee}
                >
                  <SelectItem
                    text={t('inbox.assigneeNone')}
                    value={INBOX_ASSIGNEE_NONE}
                  />
                  {(members ?? []).map((member) => (
                    <SelectItem
                      key={member.id}
                      text={member.name}
                      value={member.id}
                    />
                  ))}
                </Select>
              ) : null}
              {pending.action === 'snooze' ? (
                <TextInput
                  id="inbox-bulk-snooze"
                  labelText={t('inbox.snoozedUntil')}
                  onChange={(event) => {
                    setBulkSnoozedUntil(event.target.value);
                  }}
                  type="datetime-local"
                  value={bulkSnoozedUntil}
                />
              ) : null}
              {pending.action === 'discard' ? (
                <Select
                  id="inbox-bulk-reason"
                  labelText={t('inbox.discardReason')}
                  onChange={(event) => {
                    setBulkReason(asDiscardReason(event.target.value));
                  }}
                  value={bulkReason}
                >
                  {inboxDiscardReasonSchema.options.map((reason) => (
                    <SelectItem
                      key={reason}
                      text={t(inboxDiscardReasonLabelKeys[reason])}
                      value={reason}
                    />
                  ))}
                </Select>
              ) : null}
            </Stack>
          </Modal>
        )}

        {uploadOpen ? (
          <UploadModal
            initialFiles={uploadDropFiles}
            onClose={() => {
              setUploadOpen(false);
              setUploadDropFiles([]);
              setDragDepth(0);
            }}
            onUploaded={refresh}
            organizationId={organizationId}
          />
        ) : null}
      </PageContainer>
      {dragDepth > 0 && canManage && !uploadOpen ? (
        <div className={styles.dropOverlay!}>
          <span className={styles.dropOverlayInner!}>
            {t('inbox.list.dropOverlay')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
