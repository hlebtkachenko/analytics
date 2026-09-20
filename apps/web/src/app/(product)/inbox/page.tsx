'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  BatchAction,
  GridColumn,
  GridRow,
} from '@bap/design-system/blocks';
import {
  Button,
  InlineNotification,
  Link,
  Modal,
  Select,
  SelectItem,
  Stack,
  Tag,
  TextInput,
} from '@bap/design-system/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UploadDropZone from '../../../components/inbox/upload-drop-zone';
import PageContainer from '../../../components/page-container';
import { getJson, isAbortError } from '../../../lib/datasets/client';
import { withOrganization } from '../../../lib/documents/client';
import { bulkInboxItems, inboxItemsPath } from '../../../lib/inbox/client';
import {
  DEFAULT_INBOX_PAGE_SIZE,
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
  InboxDiscardReason,
  InboxIssueCode,
  InboxItemListResponse,
  InboxItemStatus,
} from '../../../lib/inbox/contract.ts';
import {
  inboxBulkActionLabelKeys,
  inboxBulkRefusalCodeLabelKeys,
  inboxConfidenceBandLabelKeys,
  inboxDiscardReasonLabelKeys,
  inboxItemState,
  inboxItemStateLabelKeys,
  inboxItemStateTagTypes,
  inboxStatusFilterLabelKeys,
  inboxStatusFilters,
  inboxStatusLabelKeys,
  inboxStatusTagTypes,
} from '../../../lib/inbox/labels.ts';
import type {
  InboxItemState,
  InboxStatusFilter,
} from '../../../lib/inbox/labels.ts';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

const pageSizes = [25, 50, 100];
const filterKeys = Object.keys(inboxStatusFilters) as InboxStatusFilter[];

function isFilter(value: string | null): value is InboxStatusFilter {
  return value !== null && (filterKeys as string[]).includes(value);
}

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
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [filter, setFilter] = useState<InboxStatusFilter>(() => {
    const stored = searchParams.get('filter');
    return isFilter(stored) ? stored : 'all';
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
  const [assigneeDraft, setAssigneeDraft] = useState(assignee);
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

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('status', inboxStatusFilters[filter].join(','));
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
  }, [assignee, confidence, filter, issue, page, pageSize]);
  const queryKey = `${query.toString()}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(inboxItemsPath(organizationId, query), controller.signal)
      .then((payload) => inboxItemListResponseSchema.parse(payload))
      .then((payload) => {
        setResult({ key: queryKey, value: payload });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
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
    params.set('filter', filter);
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
  }, [assignee, confidence, filter, issue, organization.slug, page, pageSize]);

  const refresh = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  // The result carries the query it answered, so a stale page is never shown as current.
  const list = result?.key === queryKey ? result.value : undefined;
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

  function itemHref(itemId: string): string {
    return withOrganization(
      `/inbox/${encodeURIComponent(itemId)}`,
      organization.slug,
    );
  }

  const entityNames = new Map(
    legalEntities.map((entity) => [entity.id, entity.name]),
  );

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
              bulkAssignee.trim().length === 0 ? null : bulkAssignee.trim(),
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
        setPending({ action, ids });
      },
    }));
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

  // The first file names the item; the rest are counted, e.g. "invoice.pdf +2".
  function fileLabel(primaryFilename: string | null, fileCount: number) {
    const name = primaryFilename ?? t('inbox.notAvailable');
    return fileCount > 1 ? `${name} +${String(fileCount - 1)}` : name;
  }

  const columns: readonly GridColumn[] = [
    { header: t('inbox.columnReceivedAt'), key: 'receivedAt' },
    { header: t('inbox.columnFile'), key: 'file' },
    { header: t('inbox.columnDetectedType'), key: 'detectedType' },
    { align: 'end', header: t('inbox.columnConfidence'), key: 'confidence' },
    {
      header: t('inbox.columnStatus'),
      key: 'status',
      renderCell: (row) => {
        const status = row['status'] as InboxItemStatus;
        return (
          <Tag size="sm" type={inboxStatusTagTypes[status]}>
            {t(inboxStatusLabelKeys[status])}
          </Tag>
        );
      },
    },
    {
      header: t('inbox.columnState'),
      key: 'state',
      renderCell: (row) => {
        const state = row['state'] as InboxItemState;
        return (
          <Tag size="sm" type={inboxItemStateTagTypes[state]}>
            {t(inboxItemStateLabelKeys[state])}
          </Tag>
        );
      },
    },
    { header: t('inbox.columnEntity'), key: 'legalEntity' },
    { header: t('inbox.columnAssignee'), key: 'assignee' },
    {
      header: t('inbox.detail'),
      key: 'open',
      renderCell: (row) => (
        <Link href={itemHref(row.id)}>
          {t('inbox.openItem', { name: String(row['receivedAt']) })}
        </Link>
      ),
    },
  ];

  // Cells stay primitive so the grid can sort and search them; the tag comes from renderCell.
  const rows: readonly GridRow[] = (list?.items ?? []).map((item) => ({
    assignee: item.assigneeId ?? t('inbox.assigneeNone'),
    confidence:
      item.confidence === null
        ? t('inbox.notAvailable')
        : `${String(Math.round(item.confidence * 100))} %`,
    detectedType: item.detectedType ?? t('inbox.notAvailable'),
    file: fileLabel(item.primaryFilename, item.fileCount),
    id: item.id,
    legalEntity:
      item.legalEntityId === null
        ? t('inbox.entityNone')
        : (entityNames.get(item.legalEntityId) ?? item.legalEntityId),
    open: item.id,
    receivedAt: item.receivedAt,
    state: inboxItemState(item),
    status: item.status,
  }));

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('inbox.title')}</h1>
        {canManage || canManageChannels ? (
          <div className={styles.headingActions!}>
            {canManageChannels ? (
              <Button
                href={withOrganization('/inbox/channels', organization.slug)}
                kind="tertiary"
                size="md"
              >
                {t('inbox.channels')}
              </Button>
            ) : null}
            <Button
              href={withOrganization('/inbox/rules', organization.slug)}
              kind="tertiary"
              size="md"
            >
              {t('inbox.rules')}
            </Button>
            {canManageChannels ? (
              <Button
                href={withOrganization('/inbox/settings', organization.slug)}
                kind="tertiary"
                size="md"
              >
                {t('inbox.settings')}
              </Button>
            ) : null}
          </div>
        ) : null}
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
      {organization.organizations.length > 0 ? (
        <Select
          id="inbox-organization"
          labelText={t('access.organization')}
          onChange={(event) => {
            organization.select(event.target.value);
            setPage(1);
          }}
          value={organizationId}
        >
          {organization.organizations.map((item) => (
            <SelectItem key={item.id} text={item.name} value={item.id} />
          ))}
        </Select>
      ) : null}
      {canManage ? (
        <UploadDropZone
          itemHref={itemHref}
          onUploaded={refresh}
          organizationId={organizationId}
        />
      ) : null}
      <div className={styles.filters!}>
        <Select
          id="inbox-filter"
          labelText={t('inbox.filterStatus')}
          onChange={(event) => {
            const next = event.target.value;
            setFilter(isFilter(next) ? next : 'all');
            setPage(1);
          }}
          value={filter}
        >
          {filterKeys.map((key) => (
            <SelectItem
              key={key}
              text={t(inboxStatusFilterLabelKeys[key])}
              value={key}
            />
          ))}
        </Select>
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
        <TextInput
          helperText={t('inbox.filterAssigneeHelp')}
          id="inbox-filter-assignee"
          labelText={t('inbox.filterAssignee')}
          onBlur={() => {
            setAssignee(assigneeDraft.trim());
            setPage(1);
          }}
          onChange={(event) => {
            setAssigneeDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setAssignee(assigneeDraft.trim());
              setPage(1);
            }
          }}
          value={assigneeDraft}
        />
      </div>
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
                subtitle: t('inbox.bulkRefused', {
                  ids: refusedSummary,
                }),
              })}
          title={t('inbox.bulkResult', {
            ok: String(bulkResult.results.length - refusedIds.length),
            total: String(bulkResult.results.length),
          })}
        />
      )}
      <DataGrid
        batchActions={canManage ? batchActions : []}
        columns={columns}
        description={t('inbox.listDescription')}
        emptyLabel={t(filter === 'all' ? 'inbox.empty' : 'inbox.emptyFiltered')}
        errorLabel={t('inbox.error')}
        onPageChange={(nextPage, nextPageSize) => {
          setPage(nextPage);
          setPageSize(nextPageSize);
        }}
        page={page}
        pageSize={pageSize}
        pageSizes={pageSizes}
        pagination
        paginationMode="server"
        rows={rows}
        selection={canManage ? 'multi' : 'none'}
        size="md"
        state={
          failed
            ? 'error'
            : loading
              ? 'loading'
              : rows.length === 0
                ? 'empty'
                : 'ready'
        }
        title={t('inbox.listTitle')}
        totalItems={list?.total ?? 0}
      />
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
              <TextInput
                id="inbox-bulk-assignee"
                labelText={t('inbox.assignee')}
                onChange={(event) => {
                  setBulkAssignee(event.target.value);
                }}
                placeholder={t('inbox.assigneePlaceholder')}
                value={bulkAssignee}
              />
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
    </PageContainer>
  );
}
