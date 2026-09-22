'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  InlineNotification,
  Link,
  Select,
  SelectItem,
  Tag,
} from '@bap/design-system/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UploadDropZone from '../../../components/inbox/upload-drop-zone';
import PageContainer from '../../../components/page-container';
import { getJson, isAbortError } from '../../../lib/datasets/client';
import { withOrganization } from '../../../lib/documents/client';
import { inboxItemsPath } from '../../../lib/inbox/client';
import {
  DEFAULT_INBOX_PAGE_SIZE,
  inboxItemListResponseSchema,
} from '../../../lib/inbox/contract.ts';
import type {
  InboxItemListResponse,
  InboxItemStatus,
} from '../../../lib/inbox/contract.ts';
import {
  inboxStatusFilterLabelKeys,
  inboxStatusFilters,
  inboxStatusLabelKeys,
  inboxStatusTagTypes,
} from '../../../lib/inbox/labels.ts';
import type { InboxStatusFilter } from '../../../lib/inbox/labels.ts';
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

type ListResult = Readonly<{ key: string; value?: InboxItemListResponse }>;

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
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<ListResult>();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('status', inboxStatusFilters[filter].join(','));
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params;
  }, [filter, page, pageSize]);
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
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [filter, organization.slug, page, pageSize]);

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
    status: item.status,
  }));

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('inbox.title')}</h1>
        {canManageChannels ? (
          <div className={styles.headingActions!}>
            <Button
              href={withOrganization('/inbox/channels', organization.slug)}
              kind="tertiary"
              size="md"
            >
              {t('inbox.channels')}
            </Button>
            <Button
              href={withOrganization('/inbox/settings', organization.slug)}
              kind="tertiary"
              size="md"
            >
              {t('inbox.settings')}
            </Button>
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
      </div>
      <DataGrid
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
    </PageContainer>
  );
}
