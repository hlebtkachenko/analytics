'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridFilterGroup,
  GridRow,
  SortSpec,
  ToolbarAction,
} from '@bap/design-system/blocks';
import { DocumentAdd } from '@bap/design-system/icons';
import {
  Button,
  ComboBox,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Layer,
  Link,
  Select,
  SelectItem,
  Tag,
  Tile,
} from '@bap/design-system/react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import PageContainer from '../../../components/page-container';
import { StatusIndicator } from '../../../components/status-indicator';
import { getJson, isAbortError } from '../../../lib/datasets/client';
import {
  documentsPath,
  formatAmount,
  partnersPath,
  withOrganization,
} from '../../../lib/documents/client';
import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  documentKindSchema,
  documentListResponseSchema,
  documentOrderSchema,
  documentSortSchema,
  documentStatusSchema,
  partnerListSchema,
} from '../../../lib/documents/contract.ts';
import type {
  DocumentKind,
  DocumentListResponse,
  DocumentOrder,
  DocumentSort,
  DocumentStatus,
  Partner,
} from '../../../lib/documents/contract.ts';
import {
  documentKindLabelKeys,
  documentStatusLabelKeys,
  documentStatusSeverity,
} from '../../../lib/documents/labels.ts';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';

const allEntitiesValue = '';
const searchDebounceMs = 300;
const pageSizes = [25, 50, 100];
const defaultSort: DocumentSort = 'documentDate';
const defaultOrder: DocumentOrder = 'desc';
const sortableColumns: readonly DocumentSort[] = [
  'reference',
  'title',
  'documentDate',
  'totalAmount',
];

function isSortable(key: string): key is DocumentSort {
  return (sortableColumns as readonly string[]).includes(key);
}

// Both the URL and the grid filter panel hand back plain strings to validate.
function asKinds(values: readonly string[]): DocumentKind[] {
  const parsed = z.array(documentKindSchema).safeParse(values);
  return parsed.success ? parsed.data : [];
}

function asStatuses(values: readonly string[]): DocumentStatus[] {
  const parsed = z.array(documentStatusSchema).safeParse(values);
  return parsed.success ? parsed.data : [];
}

// The stored filters are read from the URL, so a reload or a shared link reopens the same view.
function storedKinds(value: string | null): DocumentKind[] {
  return asKinds(value?.split(',') ?? []);
}

function storedStatuses(value: string | null): DocumentStatus[] {
  return asStatuses(value?.split(',') ?? []);
}

function storedPage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function storedPageSize(value: string | null): number {
  const size = Number(value);
  return pageSizes.includes(size) ? size : DEFAULT_DOCUMENT_PAGE_SIZE;
}

type ListResult = Readonly<{ key: string; value?: DocumentListResponse }>;

export default function DocumentsPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [entityId, setEntityId] = useState(
    () => searchParams.get('entity') ?? allEntitiesValue,
  );
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get('q') ?? '',
  );
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [kinds, setKinds] = useState<DocumentKind[]>(() =>
    storedKinds(searchParams.get('kind')),
  );
  const [statuses, setStatuses] = useState<DocumentStatus[]>(() =>
    storedStatuses(searchParams.get('status')),
  );
  const [dateFrom, setDateFrom] = useState(
    () => searchParams.get('dateFrom') ?? '',
  );
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') ?? '');
  const [partnerId, setPartnerId] = useState(
    () => searchParams.get('partnerId') ?? '',
  );
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [page, setPage] = useState(() => storedPage(searchParams.get('page')));
  const [pageSize, setPageSize] = useState(() =>
    storedPageSize(searchParams.get('pageSize')),
  );
  const [sort, setSort] = useState<DocumentSort>(() =>
    documentSortSchema.catch(defaultSort).parse(searchParams.get('sort')),
  );
  const [order, setOrder] = useState<DocumentOrder>(() =>
    documentOrderSchema.catch(defaultOrder).parse(searchParams.get('order')),
  );
  const [result, setResult] = useState<ListResult>();

  // The typed search box drives the server query only once typing settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setSearch(next);
      // The first run restores the stored query, so only a real change resets the page.
      if (next !== search) {
        setPage(1);
      }
    }, searchDebounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [search, searchInput]);

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(
      partnersPath(organizationId, partnerQuery.trim()),
      controller.signal,
    )
      .then((payload) => partnerListSchema.parse(payload))
      .then((payload) => {
        setPartners(payload.partners);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPartners([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, partnerQuery]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (entityId.length > 0) {
      params.set('legalEntityId', entityId);
    }
    if (kinds.length > 0) {
      params.set('kind', kinds.join(','));
    }
    if (statuses.length > 0) {
      params.set('status', statuses.join(','));
    }
    if (partnerId.length > 0) {
      params.set('partnerId', partnerId);
    }
    if (dateFrom.length > 0) {
      params.set('dateFrom', dateFrom);
    }
    if (dateTo.length > 0) {
      params.set('dateTo', dateTo);
    }
    if (search.length > 0) {
      params.set('q', search);
    }
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    params.set('sort', sort);
    params.set('order', order);
    return params;
  }, [
    dateFrom,
    dateTo,
    entityId,
    kinds,
    order,
    page,
    pageSize,
    partnerId,
    search,
    sort,
    statuses,
  ]);

  const queryKey = query.toString();

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(documentsPath(organizationId, query), controller.signal)
      .then((payload) => documentListResponseSchema.parse(payload))
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
    const params = new URLSearchParams(query);
    if (organization.slug.length > 0) {
      params.set('organization', organization.slug);
    }
    if (entityId.length > 0) {
      params.delete('legalEntityId');
      params.set('entity', entityId);
    }
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [entityId, organization.slug, query]);

  // The result carries the query it answered, so a stale page is never shown as current.
  const list = result?.key === queryKey ? result.value : undefined;
  const listState: LoadState =
    result?.key !== queryKey
      ? 'loading'
      : result.value === undefined
        ? 'error'
        : 'idle';
  const documents = list?.documents ?? [];
  const filtered =
    kinds.length > 0 ||
    statuses.length > 0 ||
    search.length > 0 ||
    partnerId.length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    entityId.length > 0;
  const canRead = access?.capabilities.readDocuments ?? false;
  const canManage = access?.capabilities.manageDocuments ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || listState === 'loading'));
  const failed = organization.state === 'error' || listState === 'error';

  const columns: readonly GridColumn[] = [
    {
      header: t('documents.columnReference'),
      key: 'reference',
      sortable: true,
    },
    { header: t('documents.columnTitle'), key: 'title', sortable: true },
    {
      header: t('documents.columnKind'),
      key: 'kind',
      renderCell: (row) => (
        <Tag size="sm" type="outline">
          {t(documentKindLabelKeys[row['kind'] as DocumentKind])}
        </Tag>
      ),
    },
    {
      header: t('documents.columnDate'),
      key: 'documentDate',
      sortable: true,
    },
    { header: t('documents.columnPartner'), key: 'partnerName' },
    {
      align: 'end',
      header: t('documents.columnTotal'),
      key: 'totalAmount',
      sortable: true,
    },
    { header: t('documents.columnCurrency'), key: 'currencyCode' },
    {
      header: t('documents.columnStatus'),
      key: 'status',
      renderCell: (row) => {
        const status = row['status'] as DocumentStatus;
        return (
          <StatusIndicator
            label={t(documentStatusLabelKeys[status])}
            severity={documentStatusSeverity[status]}
          />
        );
      },
    },
    {
      header: t('documents.columnBalanced'),
      key: 'balanced',
      renderCell: (row) => {
        const balanced = row['balanced'];
        if (balanced === null || balanced === undefined) {
          return t('documents.notAvailable');
        }
        return (
          <StatusIndicator
            label={t(
              balanced ? 'documents.balancedYes' : 'documents.balancedNo',
            )}
            severity={balanced ? 'success' : 'error'}
          />
        );
      },
    },
    { align: 'end', header: t('documents.columnIssues'), key: 'issues' },
    {
      header: t('documents.columnActions'),
      key: 'actions',
      renderCell: (row) => (
        <Link href={documentHref(row.id)}>
          {t('documents.viewNamed', { title: String(row['title']) })}
        </Link>
      ),
    },
  ];

  // Kind and status stay raw so the grid filter matches them; labels come from renderCell.
  const rows: readonly GridRow[] = documents.map((document) => ({
    balanced: document.isBalanced,
    currencyCode: document.currencyCode,
    documentDate: document.documentDate,
    id: document.id,
    issues: document.openIssueCount,
    kind: document.kind,
    partnerName: document.partnerName ?? t('documents.notAvailable'),
    reference: document.reference ?? t('documents.notAvailable'),
    status: document.status,
    title: document.title,
    totalAmount:
      document.totalAmount === null
        ? t('documents.notAvailable')
        : formatAmount(document.totalAmount, document.currencyCode),
  }));

  const filterGroups: readonly GridFilterGroup[] = [
    {
      heading: t('documents.filterKind'),
      key: 'kind',
      options: documentKindSchema.options.map((kind) => ({
        id: kind,
        label: t(documentKindLabelKeys[kind]),
      })),
    },
    {
      heading: t('documents.filterStatus'),
      key: 'status',
      options: documentStatusSchema.options.map((status) => ({
        id: status,
        label: t(documentStatusLabelKeys[status]),
      })),
    },
  ];

  const toolbarActions: readonly ToolbarAction[] = filtered
    ? [
        {
          id: 'clear-filters',
          kind: 'ghost',
          label: t('documents.clearFilters'),
          onClick: clearFilters,
        },
      ]
    : [];

  // The register is always sorted, so a cleared header falls back to the default order.
  function sortBy(specs: readonly SortSpec[]): void {
    const spec = specs[0];
    if (spec === undefined || !isSortable(spec.key)) {
      setSort(defaultSort);
      setOrder(defaultOrder);
    } else {
      setSort(spec.key);
      setOrder(spec.direction === 'ASC' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  function clearFilters(): void {
    setKinds([]);
    setStatuses([]);
    setDateFrom('');
    setDateTo('');
    setPartnerId('');
    setSearchInput('');
    setSearch('');
    setEntityId(allEntitiesValue);
    setPage(1);
  }

  function newDocumentHref(): string {
    return withOrganization('/documents/new', organization.slug);
  }

  function analyticsHref(): string {
    return withOrganization('/documents/analytics', organization.slug);
  }

  function documentHref(documentId: string): string {
    return withOrganization(
      `/documents/${encodeURIComponent(documentId)}`,
      organization.slug,
    );
  }

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('documents.title')}</h1>
        <div className={styles.headingActions!}>
          {canRead ? (
            <Button href={analyticsHref()} kind="tertiary" size="md">
              {t('documents.analytics')}
            </Button>
          ) : null}
          {canManage ? (
            <Button href={newDocumentHref()} renderIcon={DocumentAdd} size="md">
              {t('documents.newDocument')}
            </Button>
          ) : null}
        </div>
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
      {organization.organizations.length > 0 ? (
        <Select
          id="documents-organization"
          labelText={t('documents.organization')}
          onChange={(event) => {
            organization.select(event.target.value);
            setEntityId(allEntitiesValue);
            setPage(1);
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
          id="documents-entity"
          labelText={t('documents.entity')}
          onChange={(event) => {
            setEntityId(event.target.value);
            setPage(1);
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
      {list !== undefined && list.totalsByCurrency.length > 0 ? (
        <Layer>
          <section aria-label={t('documents.totalsTitle')}>
            <div className={styles.totals!}>
              {list.totalsByCurrency.map((total) => (
                <Tile key={total.currencyCode}>
                  <p className={styles.totalLabel!}>{total.currencyCode}</p>
                  <p className={styles.totalValue!}>
                    {formatAmount(total.totalAmount, total.currencyCode)}
                  </p>
                </Tile>
              ))}
            </div>
          </section>
        </Layer>
      ) : null}
      <ComboBox
        className={styles.filter!}
        id="documents-partner"
        items={partners}
        itemToString={(item) => item?.name ?? ''}
        onChange={(change) => {
          setPartnerId(change.selectedItem?.id ?? '');
          setPage(1);
        }}
        onInputChange={(value) => {
          setPartnerQuery(value);
        }}
        placeholder={t('documents.filterPartnerPlaceholder')}
        selectedItem={
          partners.find((partner) => partner.id === partnerId) ?? null
        }
        titleText={t('documents.filterPartner')}
      />
      <DatePicker
        className={styles.filter!}
        datePickerType="range"
        dateFormat="Y-m-d"
        onChange={(dates: Date[]) => {
          setDateFrom(isoDate(dates[0]));
          setDateTo(isoDate(dates[1]));
          setPage(1);
        }}
      >
        <DatePickerInput
          id="documents-date-from"
          labelText={t('documents.dateFrom')}
          placeholder="yyyy-mm-dd"
        />
        <DatePickerInput
          id="documents-date-to"
          labelText={t('documents.dateTo')}
          placeholder="yyyy-mm-dd"
        />
      </DatePicker>
      <DataGrid
        columns={columns}
        description={t('documents.listDescription')}
        emptyLabel={t(filtered ? 'documents.emptyFiltered' : 'documents.empty')}
        errorLabel={t('documents.error')}
        filterValues={{ kind: kinds, status: statuses }}
        filters={filterGroups}
        onFilterChange={(values) => {
          setKinds(asKinds(values['kind'] ?? []));
          setStatuses(asStatuses(values['status'] ?? []));
          setPage(1);
        }}
        onPageChange={(nextPage, nextPageSize) => {
          setPage(nextPage);
          setPageSize(nextPageSize);
        }}
        onSearch={setSearchInput}
        onSortChange={sortBy}
        page={page}
        pageSize={pageSize}
        pageSizes={pageSizes}
        pagination
        paginationMode="server"
        rows={rows}
        search
        searchPlaceholder={t('documents.searchPlaceholder')}
        searchPlacement="persistent"
        searchValue={searchInput}
        size="md"
        sort={[{ direction: order === 'asc' ? 'ASC' : 'DESC', key: sort }]}
        sortMode="server"
        sortable
        state={
          failed
            ? 'error'
            : loading
              ? 'loading'
              : rows.length === 0
                ? 'empty'
                : 'ready'
        }
        title={t('documents.listTitle')}
        toolbarActions={toolbarActions}
        totalItems={list?.total ?? 0}
      />
    </PageContainer>
  );
}

// Carbon hands back Date objects in the browser's own zone, while the contract
// speaks calendar dates, so the parts are read locally and never through UTC.
function isoDate(value: Date | undefined): string {
  if (value === undefined) {
    return '';
  }
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}
