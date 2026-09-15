'use client';

import { DocumentAdd } from '@bap/design-system/icons';
import {
  Button,
  ComboBox,
  DataTable,
  DataTableSkeleton,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Layer,
  MultiSelect,
  OverflowMenu,
  OverflowMenuItem,
  Pagination,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
  Tile,
} from '@bap/design-system/react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import PageContainer from '../../../components/page-container';
import {
  accessPath,
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
  organizationAccessSchema,
} from '../../../lib/datasets/client';
import type {
  LegalEntity,
  OrganizationAccess,
} from '../../../lib/datasets/client';
import {
  documentsPath,
  formatAmount,
  partnersPath,
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
  documentStatusTagTypes,
} from '../../../lib/documents/labels.ts';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';

const allEntitiesValue = '';
const searchDebounceMs = 300;
const pageSizes = [25, 50, 100];
const sortableColumns: readonly DocumentSort[] = [
  'reference',
  'title',
  'documentDate',
  'totalAmount',
];

function isSortable(key: string): key is DocumentSort {
  return (sortableColumns as readonly string[]).includes(key);
}

// The stored filters are read from the URL, so a reload or a shared link reopens the same view.
function storedKinds(value: string | null): DocumentKind[] {
  const parsed = z.array(documentKindSchema).safeParse(value?.split(',') ?? []);
  return parsed.success ? parsed.data : [];
}

function storedStatuses(value: string | null): DocumentStatus[] {
  const parsed = z
    .array(documentStatusSchema)
    .safeParse(value?.split(',') ?? []);
  return parsed.success ? parsed.data : [];
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
  const [access, setAccess] = useState<OrganizationAccess>();
  const [accessState, setAccessState] = useState<LoadState>('loading');
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
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
    documentSortSchema.catch('documentDate').parse(searchParams.get('sort')),
  );
  const [order, setOrder] = useState<DocumentOrder>(() =>
    documentOrderSchema.catch('desc').parse(searchParams.get('order')),
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
    void getJson(accessPath(organizationId), controller.signal)
      .then((payload) => organizationAccessSchema.parse(payload))
      .then((contract) => {
        if (contract.organizationId !== organizationId) {
          throw new Error('Organization mismatch.');
        }
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

  const headers = [
    { header: t('documents.columnReference'), key: 'reference' },
    { header: t('documents.columnTitle'), key: 'title' },
    { header: t('documents.columnKind'), key: 'kind' },
    { header: t('documents.columnDate'), key: 'documentDate' },
    { header: t('documents.columnPartner'), key: 'partnerName' },
    { header: t('documents.columnTotal'), key: 'totalAmount' },
    { header: t('documents.columnCurrency'), key: 'currencyCode' },
    { header: t('documents.columnStatus'), key: 'status' },
    { header: t('documents.columnBalanced'), key: 'balanced' },
    { header: t('documents.columnIssues'), key: 'issues' },
    { header: t('documents.columnActions'), key: 'actions' },
  ];

  // The body renders the documents directly, so the table only needs their identities.
  const rows = documents.map((document) => ({ id: document.id }));

  function sortBy(key: string): void {
    if (!isSortable(key)) {
      return;
    }
    if (sort === key) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key);
      setOrder('desc');
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
    return organization.slug.length > 0
      ? `/documents/new?organization=${encodeURIComponent(organization.slug)}`
      : '/documents/new';
  }

  function documentHref(documentId: string): string {
    const suffix =
      organization.slug.length > 0
        ? `?organization=${encodeURIComponent(organization.slug)}`
        : '';
    return `/documents/${encodeURIComponent(documentId)}${suffix}`;
  }

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('documents.title')}</h1>
        {canManage ? (
          <Button href={newDocumentHref()} renderIcon={DocumentAdd} size="md">
            {t('documents.newDocument')}
          </Button>
        ) : null}
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
      {loading ? (
        <DataTableSkeleton
          aria-label={t('documents.loading')}
          columnCount={headers.length}
          rowCount={5}
          showHeader={false}
          showToolbar={false}
        />
      ) : null}
      {!loading && documents.length === 0 ? (
        <Tile>
          <p>{t(filtered ? 'documents.emptyFiltered' : 'documents.empty')}</p>
          {filtered ? (
            <Button kind="tertiary" onClick={clearFilters} type="button">
              {t('documents.clearFilters')}
            </Button>
          ) : null}
          {!filtered && canManage ? (
            <Button href={newDocumentHref()} kind="primary">
              {t('documents.newDocument')}
            </Button>
          ) : null}
        </Tile>
      ) : null}
      {!loading && documents.length > 0 ? (
        <DataTable headers={headers} rows={rows}>
          {({ getHeaderProps, getTableContainerProps, getTableProps }) => (
            <TableContainer
              className={styles.tableContainer!}
              description={t('documents.listDescription')}
              title={t('documents.listTitle')}
              {...getTableContainerProps()}
            >
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    labelText={t('documents.search')}
                    onChange={(event) => {
                      setSearchInput(event === '' ? '' : event.target.value);
                    }}
                    persistent
                    placeholder={t('documents.searchPlaceholder')}
                    value={searchInput}
                  />
                  <MultiSelect
                    className={styles.filter!}
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
                  <MultiSelect
                    className={styles.filter!}
                    id="documents-status"
                    items={documentStatusSchema.options}
                    itemToString={(item) =>
                      item === null ? '' : t(documentStatusLabelKeys[item])
                    }
                    label={t('documents.filterStatus')}
                    onChange={(change) => {
                      setStatuses(change.selectedItems ?? []);
                      setPage(1);
                    }}
                    selectedItems={statuses}
                    titleText={t('documents.filterStatus')}
                  />
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
                      partners.find((partner) => partner.id === partnerId) ??
                      null
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
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => {
                      const sortable = isSortable(header.key);
                      return (
                        <TableHeader
                          {...getHeaderProps({
                            header,
                            isSortable: sortable,
                            onClick: () => {
                              sortBy(header.key);
                            },
                          })}
                          isSortable={sortable}
                          isSortHeader={sort === header.key}
                          key={header.key}
                          sortDirection={order === 'asc' ? 'ASC' : 'DESC'}
                        >
                          {header.header}
                        </TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        {document.reference ?? t('documents.notAvailable')}
                      </TableCell>
                      <TableCell>{document.title}</TableCell>
                      <TableCell>
                        <Tag size="sm" type="outline">
                          {t(documentKindLabelKeys[document.kind])}
                        </Tag>
                      </TableCell>
                      <TableCell>{document.documentDate}</TableCell>
                      <TableCell>
                        {document.partnerName ?? t('documents.notAvailable')}
                      </TableCell>
                      <TableCell className={styles.amount!}>
                        {document.totalAmount === null
                          ? t('documents.notAvailable')
                          : formatAmount(
                              document.totalAmount,
                              document.currencyCode,
                            )}
                      </TableCell>
                      <TableCell>{document.currencyCode}</TableCell>
                      <TableCell>
                        <Tag
                          size="sm"
                          type={documentStatusTagTypes[document.status]}
                        >
                          {t(documentStatusLabelKeys[document.status])}
                        </Tag>
                      </TableCell>
                      <TableCell>
                        {document.isBalanced === null ? (
                          t('documents.notAvailable')
                        ) : (
                          <Tag
                            size="sm"
                            type={document.isBalanced ? 'green' : 'red'}
                          >
                            {t(
                              document.isBalanced
                                ? 'documents.balancedYes'
                                : 'documents.balancedNo',
                            )}
                          </Tag>
                        )}
                      </TableCell>
                      <TableCell className={styles.amount!}>
                        {document.openIssueCount}
                      </TableCell>
                      <TableCell>
                        <OverflowMenu
                          flipped
                          iconDescription={t('documents.viewNamed', {
                            title: document.title,
                          })}
                          size="sm"
                        >
                          <OverflowMenuItem
                            href={documentHref(document.id)}
                            itemText={t('documents.view')}
                          />
                        </OverflowMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      ) : null}
      {list !== undefined && list.total > 0 ? (
        <Pagination
          onChange={(change) => {
            setPage(change.page);
            setPageSize(change.pageSize);
          }}
          page={page}
          pageSize={pageSize}
          pageSizes={pageSizes}
          totalItems={list.total}
        />
      ) : null}
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
