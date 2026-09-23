'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridRow,
  RowAction,
  SortSpec,
  ToolbarAction,
} from '@bap/design-system/blocks';
import {
  Button,
  ComboBox,
  DatePicker,
  DatePickerInput,
  DismissibleTag,
  InlineNotification,
  MultiSelect,
  OverflowMenu,
  OverflowMenuItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
} from '@bap/design-system/react';
import { DocumentAdd } from '@bap/design-system/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import EntityMultiSelect from '../../../components/documents/entity-multiselect';
import StatTiles from '../../../components/documents/stat-tiles';
import PageContainer from '../../../components/page-container';
import { StatusIndicator } from '../../../components/status-indicator';
import { getJson, isAbortError } from '../../../lib/datasets/client';
import {
  documentsPath,
  partnersPath,
  withOrganization,
} from '../../../lib/documents/client';
import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  documentKindSchema,
  documentListResponseSchema,
  documentSortSchema,
  partnerListSchema,
} from '../../../lib/documents/contract.ts';
import type {
  DocumentKind,
  DocumentListResponse,
  DocumentOrder,
  DocumentSort,
  Partner,
} from '../../../lib/documents/contract.ts';
import {
  documentKindLabelKeys,
  documentStatusLabelKeys,
  documentStatusSeverity,
} from '../../../lib/documents/labels.ts';
import { documentKindIcon } from '../../../lib/documents/kind-icon.ts';
import {
  documentTabCountKeys,
  documentTabLabelKeys,
  documentTabStatuses,
  documentTabs,
  isDocumentTab,
  storedEntities,
} from '../../../lib/documents/list.ts';
import type { DocumentTab } from '../../../lib/documents/list.ts';
import { formatDate, formatMoney, isoDay } from '../../../lib/format.ts';
import { lastSeenKey, isNewSince } from '../../../lib/inbox/last-seen.ts';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

const searchDebounceMs = 300;
const pageSizes = [25, 50, 100];

// The grid column keys the server can sort by, both ways of the mapping.
const columnSortKeys: Readonly<Record<string, DocumentSort>> = {
  date: 'documentDate',
  document: 'title',
  total: 'totalAmount',
};
const sortColumnKeys: Readonly<Record<DocumentSort, string>> = {
  createdAt: 'date',
  documentDate: 'date',
  reference: 'document',
  title: 'document',
  totalAmount: 'total',
};

// The stored filters are read from the URL, so a reload or a shared link reopens the same view.
function storedKinds(value: string | null): DocumentKind[] {
  const parsed = z.array(documentKindSchema).safeParse(value?.split(',') ?? []);
  return parsed.success ? parsed.data : [];
}

function storedSort(value: string | null): DocumentSort {
  const parsed = documentSortSchema.safeParse(value);
  return parsed.success ? parsed.data : 'documentDate';
}

function storedOrder(value: string | null): DocumentOrder {
  return value === 'asc' ? 'asc' : 'desc';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [tab, setTab] = useState<DocumentTab>(() => {
    const stored = searchParams.get('tab');
    return isDocumentTab(stored) ? stored : 'all';
  });
  const [entityIds, setEntityIds] = useState<string[]>(() =>
    storedEntities(searchParams.get('entity')),
  );
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get('q') ?? '',
  );
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [kinds, setKinds] = useState<DocumentKind[]>(() =>
    storedKinds(searchParams.get('kind')),
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
    storedSort(searchParams.get('sort')),
  );
  const [order, setOrder] = useState<DocumentOrder>(() =>
    storedOrder(searchParams.get('order')),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<ListResult>();

  // The "New" baseline is read once per load and advanced to now; only a reload moves it.
  const [seen, setSeen] = useState<{ baseline: string | null; org: string }>();
  if (
    organizationId.length > 0 &&
    seen?.org !== organizationId &&
    typeof window !== 'undefined'
  ) {
    setSeen({
      baseline: window.localStorage.getItem(
        lastSeenKey('documents', organizationId),
      ),
      org: organizationId,
    });
  }
  useEffect(() => {
    if (seen === undefined) {
      return;
    }
    window.localStorage.setItem(
      lastSeenKey('documents', seen.org),
      new Date().toISOString(),
    );
  }, [seen]);
  const newBaseline = seen?.org === organizationId ? seen.baseline : null;

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

  // Drop URL entity ids unknown after an organization change, else the all-or-nothing scope lists nothing.
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

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const id of entityIds) {
      params.append('legalEntityId', id);
    }
    const statuses = documentTabStatuses[tab];
    if (statuses !== undefined) {
      params.set('status', statuses.join(','));
    }
    if (kinds.length > 0) {
      params.set('kind', kinds.join(','));
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
    params.set('sort', sort);
    params.set('order', order);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params;
  }, [
    dateFrom,
    dateTo,
    entityIds,
    kinds,
    order,
    page,
    pageSize,
    partnerId,
    search,
    sort,
    tab,
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
    const params = new URLSearchParams();
    if (organization.slug.length > 0) {
      params.set('organization', organization.slug);
    }
    params.set('tab', tab);
    if (entityIds.length > 0) {
      params.set('entity', entityIds.join(','));
    }
    if (kinds.length > 0) {
      params.set('kind', kinds.join(','));
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
    params.set('sort', sort);
    params.set('order', order);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [
    dateFrom,
    dateTo,
    entityIds,
    kinds,
    order,
    organization.slug,
    page,
    pageSize,
    partnerId,
    search,
    sort,
    tab,
  ]);

  // The result carries the query it answered, so a stale page is never shown as current.
  const list = result?.key === queryKey ? result.value : undefined;
  const counts = list?.counts;
  const documents = list?.documents ?? [];
  const documentsById = new Map(
    documents.map((document) => [document.id, document] as const),
  );
  const hasFilters =
    kinds.length > 0 ||
    search.length > 0 ||
    partnerId.length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0;
  const canRead = access?.capabilities.readDocuments ?? false;
  const canManage = access?.capabilities.manageDocuments ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || result?.key !== queryKey));
  const failed =
    organization.state === 'error' ||
    (result?.key === queryKey && result.value === undefined);

  function newDocumentHref(): Route {
    return withOrganization('/documents/new', organization.slug) as Route;
  }

  function analyticsHref(): Route {
    return withOrganization('/documents/analytics', organization.slug) as Route;
  }

  function documentHref(documentId: string): Route {
    return withOrganization(
      `/documents/${encodeURIComponent(documentId)}`,
      organization.slug,
    ) as Route;
  }

  // Amounts in different currencies never add up, so each currency keeps its own total.
  const totalInScope =
    list !== undefined && list.totalsByCurrency.length > 0
      ? list.totalsByCurrency
          .map((total) => formatMoney(total.totalAmount, total.currencyCode))
          .join(' · ')
      : t('documents.list.emptyValue');

  const statTiles: readonly { key: string; label: string; value: string }[] = [
    {
      key: 'documents',
      label: t('documents.list.statDocuments'),
      value: String(counts?.all ?? 0),
    },
    {
      key: 'needsReview',
      label: t('documents.list.statNeedsReview'),
      value: String(counts?.needsReview ?? 0),
    },
    {
      key: 'withIssues',
      label: t('documents.list.statWithIssues'),
      value: String(counts?.withIssues ?? 0),
    },
    {
      key: 'totalInScope',
      label: t('documents.list.statTotalInScope'),
      value: totalInScope,
    },
  ];

  const columns: readonly GridColumn[] = [
    {
      header: t('documents.list.columnDocument'),
      key: 'document',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        if (document === undefined) {
          return null;
        }
        const Icon = documentKindIcon(document.kind);
        return (
          <span className={styles.documentCell!}>
            <Icon
              aria-hidden="true"
              className={styles.documentIcon!}
              size={20}
              title={t(documentKindLabelKeys[document.kind])}
            />
            <span className={styles.documentText!}>
              <span className={styles.documentTitle!} title={document.title}>
                {document.title}
              </span>
              {document.reference !== null ? (
                <span className={styles.documentReference!}>
                  {document.reference}
                </span>
              ) : null}
            </span>
            {isNewSince(newBaseline, document.createdAt) ? (
              <Tag size="sm" type="blue">
                {t('documents.list.new')}
              </Tag>
            ) : null}
          </span>
        );
      },
      sortable: true,
    },
    {
      header: t('documents.list.columnDate'),
      key: 'date',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        return document === undefined
          ? null
          : formatDate(document.documentDate);
      },
      sortable: true,
      width: 120,
    },
    {
      header: t('documents.list.columnPartner'),
      key: 'partner',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        if (document === undefined) {
          return null;
        }
        return document.partnerName ?? t('documents.list.emptyValue');
      },
      width: 220,
    },
    {
      align: 'end',
      header: t('documents.list.columnTotal'),
      key: 'total',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        if (document === undefined) {
          return null;
        }
        return (
          <span className={styles.amount!}>
            {document.totalAmount === null
              ? t('documents.list.emptyValue')
              : formatMoney(document.totalAmount, document.currencyCode)}
          </span>
        );
      },
      sortable: true,
      width: 140,
    },
    {
      header: t('documents.list.columnStatus'),
      key: 'status',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        if (document === undefined) {
          return null;
        }
        return (
          <StatusIndicator
            label={t(documentStatusLabelKeys[document.status])}
            severity={documentStatusSeverity[document.status]}
          />
        );
      },
      width: 130,
    },
    {
      header: t('documents.list.columnIssues'),
      key: 'issues',
      renderCell: (row) => {
        const document = documentsById.get(row.id);
        if (document === undefined) {
          return null;
        }
        const tags = [];
        if (document.openIssueCount > 0) {
          tags.push(
            <Tag key="count" size="sm" type="red">
              {String(document.openIssueCount)}
            </Tag>,
          );
        }
        if (document.isBalanced === false) {
          tags.push(
            <Tag key="unbalanced" size="sm" type="red">
              {t('documents.balancedNo')}
            </Tag>,
          );
        }
        return tags.length === 0 ? (
          t('documents.list.emptyValue')
        ) : (
          <span className={styles.issuesCell!}>{tags}</span>
        );
      },
      width: 100,
    },
  ];

  // Cells stay primitive so sorting works; the visuals come from renderCell.
  const rows: readonly GridRow[] = documents.map((document) => ({
    id: document.id,
    date: document.documentDate,
    document: document.title,
    partner: document.partnerName ?? '',
    total: document.totalAmount === null ? null : Number(document.totalAmount),
  }));

  const rowActions = (row: GridRow): readonly RowAction[] => {
    const document = documentsById.get(row.id);
    if (document === undefined) {
      return [];
    }
    return [
      {
        id: 'view',
        label: t('documents.view'),
        onClick: () => {
          router.push(documentHref(document.id));
        },
      },
    ];
  };

  const toolbarActions: readonly ToolbarAction[] = [
    {
      id: 'filter',
      kind: 'ghost',
      label: t('documents.list.filter'),
      onClick: () => {
        setFiltersOpen((open) => !open);
      },
    },
  ];

  // The server owns row order; mirror the active sort back to the grid header.
  const sortSpecs: readonly SortSpec[] = [
    { key: sortColumnKeys[sort], direction: order === 'asc' ? 'ASC' : 'DESC' },
  ];

  const dataGrid = (
    <DataGrid
      ariaLabel={t('documents.listTitle')}
      columns={columns}
      emptyLabel={t(hasFilters ? 'documents.emptyFiltered' : 'documents.empty')}
      errorLabel={t('documents.error')}
      fitContainer
      initialSort={[
        {
          direction: order === 'asc' ? 'ASC' : 'DESC',
          key: sortColumnKeys[sort],
        },
      ]}
      onPageChange={(nextPage, nextPageSize) => {
        setPage(nextPage);
        setPageSize(nextPageSize);
      }}
      onRowClick={(row) => {
        router.push(documentHref(row.id));
      }}
      onSearch={(value) => {
        setSearchInput(value);
      }}
      onSortChange={(specs) => {
        const next = specs[0];
        if (next === undefined) {
          setSort('documentDate');
          setOrder('desc');
        } else {
          const nextSort = columnSortKeys[next.key];
          if (nextSort === undefined) {
            return;
          }
          setSort(nextSort);
          setOrder(next.direction === 'ASC' ? 'asc' : 'desc');
        }
        setPage(1);
      }}
      page={page}
      pageSize={pageSize}
      pageSizes={pageSizes}
      pagination
      paginationMode="server"
      rowActions={rowActions}
      rowActionsLabel={(row) =>
        t('documents.list.actionsFor', { title: String(row['document']) })
      }
      rows={rows}
      search
      searchValue={searchInput}
      size="md"
      sort={sortSpecs}
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
      toolbarActions={toolbarActions}
      totalItems={list?.total ?? 0}
    />
  );

  // The active filters as removable tags, shown above the grid.
  const filterTags = hasFilters ? (
    <div className={styles.filterTags!}>
      {kinds.map((kind) => (
        <DismissibleTag
          key={kind}
          onClose={() => {
            setKinds((current) => current.filter((item) => item !== kind));
            setPage(1);
          }}
          text={`${t('documents.filterKind')}: ${t(documentKindLabelKeys[kind])}`}
          title={t('documents.list.filterRemove', {
            filter: t('documents.filterKind'),
          })}
          type="gray"
        />
      ))}
      {partnerId.length > 0 ? (
        <DismissibleTag
          onClose={() => {
            setPartnerId('');
            setPage(1);
          }}
          text={`${t('documents.filterPartner')}: ${
            partners.find((partner) => partner.id === partnerId)?.name ??
            partnerId
          }`}
          title={t('documents.list.filterRemove', {
            filter: t('documents.filterPartner'),
          })}
          type="gray"
        />
      ) : null}
      {dateFrom.length > 0 ? (
        <DismissibleTag
          onClose={() => {
            setDateFrom('');
            setPage(1);
          }}
          text={`${t('documents.dateFrom')}: ${formatDate(dateFrom)}`}
          title={t('documents.list.filterRemove', {
            filter: t('documents.dateFrom'),
          })}
          type="gray"
        />
      ) : null}
      {dateTo.length > 0 ? (
        <DismissibleTag
          onClose={() => {
            setDateTo('');
            setPage(1);
          }}
          text={`${t('documents.dateTo')}: ${formatDate(dateTo)}`}
          title={t('documents.list.filterRemove', {
            filter: t('documents.dateTo'),
          })}
          type="gray"
        />
      ) : null}
    </div>
  ) : null;

  // The expandable filter controls, revealed by the Filter toggle.
  const filterPanel = filtersOpen ? (
    <div
      aria-label={t('documents.list.filtersRegion')}
      className={styles.filterPanel!}
      role="group"
    >
      <MultiSelect
        id="documents-kind"
        items={documentKindSchema.options}
        itemToString={(item) =>
          item === null ? '' : t(documentKindLabelKeys[item])
        }
        label={t('documents.filterKind')}
        onChange={(change) => {
          setKinds(change.selectedItems ?? []);
          setPage(1);
        }}
        selectedItems={kinds}
        titleText={t('documents.filterKind')}
      />
      <ComboBox
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
        datePickerType="single"
        dateFormat="Y-m-d"
        onChange={(dates: Date[]) => {
          setDateFrom(isoDay(dates[0]));
          setPage(1);
        }}
        value={dateFrom.length > 0 ? [dateFrom] : []}
      >
        <DatePickerInput
          id="documents-date-from"
          labelText={t('documents.dateFrom')}
          placeholder="yyyy-mm-dd"
        />
      </DatePicker>
      <DatePicker
        datePickerType="single"
        dateFormat="Y-m-d"
        onChange={(dates: Date[]) => {
          setDateTo(isoDay(dates[0]));
          setPage(1);
        }}
        value={dateTo.length > 0 ? [dateTo] : []}
      >
        <DatePickerInput
          id="documents-date-to"
          labelText={t('documents.dateTo')}
          placeholder="yyyy-mm-dd"
        />
      </DatePicker>
    </div>
  ) : null;

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('documents.title')}</h1>
        <div className={styles.headingActions!}>
          {legalEntities.length > 0 ? (
            <EntityMultiSelect
              entities={legalEntities}
              onChange={(ids) => {
                setEntityIds([...ids]);
                setPage(1);
              }}
              selectedIds={entityIds}
            />
          ) : null}
          {canManage ? (
            <Button href={newDocumentHref()} renderIcon={DocumentAdd} size="md">
              {t('documents.newDocument')}
            </Button>
          ) : null}
          {canRead ? (
            <OverflowMenu
              aria-label={t('documents.list.actionsMenu')}
              flipped
              iconDescription={t('documents.list.actionsMenu')}
              size="md"
            >
              <OverflowMenuItem
                href={analyticsHref()}
                itemText={t('documents.analytics')}
              />
            </OverflowMenu>
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
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.error')}
        />
      ) : null}

      <StatTiles ariaLabel={t('documents.list.statsTitle')} tiles={statTiles} />

      <div className={styles.tabsRow!}>
        <Tabs
          onChange={(event: { selectedIndex: number }) => {
            const next = documentTabs[event.selectedIndex];
            if (next !== undefined) {
              setTab(next);
              setPage(1);
            }
          }}
          selectedIndex={documentTabs.indexOf(tab)}
        >
          <TabList aria-label={t('documents.list.tabsLabel')}>
            {documentTabs.map((name) => (
              <Tab key={name}>
                {t('documents.list.tabWithCount', {
                  count:
                    counts === undefined
                      ? 0
                      : counts[documentTabCountKeys[name]],
                  label: t(documentTabLabelKeys[name]),
                })}
              </Tab>
            ))}
          </TabList>
          <TabPanels>
            {documentTabs.map((name, index) => (
              <TabPanel key={name}>
                {index === documentTabs.indexOf(tab) ? (
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
    </PageContainer>
  );
}
