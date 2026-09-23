'use client';

import {
  Button,
  ComboBox,
  Form,
  Heading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../../components/page-container';
import { useToast } from '../../../../../components/shell/toast';
import { getJson } from '../../../../../lib/datasets/client';
import {
  employeeDocumentPath,
  employeeDocumentsPath,
  employeePath,
  hrReferencesPath,
  sendHrJson,
} from '../../../../../lib/hr/client';
import {
  createEmployeeDocumentSchema,
  documentCategoryListSchema,
  employeeDetailSchema,
  employeeDocumentListSchema,
  employeeDocumentSchema,
  employeeDocumentApprovalSchema,
  identifierSchema,
  updateEmployeeDocumentSchema,
} from '../../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from '../employee-tabs';

const pageValue = (value: string | null, fallback: number, max?: number) => {
  const number = Number(value);
  return Number.isInteger(number) &&
    number >= 1 &&
    (max === undefined || number <= max)
    ? number
    : fallback;
};

export default function EmployeeDocumentsPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const org = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    org.organizationId,
  );
  const category = identifierSchema.safeParse(params.get('categoryId'));
  const approval = employeeDocumentApprovalSchema.safeParse(
    params.get('approvalStatus'),
  );
  const currentOnly = params.get('currentOnly') === 'false' ? 'false' : 'true';
  const page = pageValue(params.get('page'), 1);
  const pageSize = pageValue(params.get('pageSize'), 25, 100);
  const [documents, setDocuments] =
    useState<typeof employeeDocumentListSchema._output>();
  const [employee, setEmployee] =
    useState<typeof employeeDetailSchema._output>();
  const [categories, setCategories] = useState<
    (typeof documentCategoryListSchema._output)['documentCategories']
  >([]);
  const [predecessors, setPredecessors] = useState<
    (typeof employeeDocumentSchema._output)[]
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [selected, setSelected] = useState<
    typeof employeeDocumentSchema._output | null
  >(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [predecessorId, setPredecessorId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [mutationError, setMutationError] = useState<
    'conflict' | 'general' | null
  >(null);

  const replace = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates))
      if (value === null) next.delete(key);
      else next.set(key, value);
    router.replace(`${pathname}?${next}` as never);
  };
  const load = useCallback(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const query = new URLSearchParams({
      currentOnly,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (category.success) query.set('categoryId', category.data);
    if (approval.success) query.set('approvalStatus', approval.data);
    void Promise.all([
      getJson(
        employeeDocumentsPath(org.organizationId, employeeId, query),
        new AbortController().signal,
      ).then((value) => employeeDocumentListSchema.parse(value)),
      getJson(
        employeePath(org.organizationId, employeeId),
        new AbortController().signal,
      ).then((value) => employeeDetailSchema.parse(value)),
    ])
      .then(([nextDocuments, nextEmployee]) => {
        setDocuments(nextDocuments);
        setEmployee(nextEmployee);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    approval.data,
    approval.success,
    category.data,
    category.success,
    currentOnly,
    employeeId,
    org.organizationId,
    page,
    pageSize,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!org.organizationId || !access?.capabilities.readHr || !employee)
      return;
    const query = new URLSearchParams({
      legalEntityId: employee.legalEntityId,
      active: 'true',
      page: '1',
      pageSize: '100',
    });
    if (categoryQuery.trim())
      query.set('q', categoryQuery.trim().slice(0, 100));
    void getJson(
      hrReferencesPath(org.organizationId, 'document-categories', query),
      new AbortController().signal,
    )
      .then((value) => {
        const parsed = documentCategoryListSchema.safeParse(value);
        if (parsed.success) return parsed.data.documentCategories;
        const rows = (value as { documentCategories?: unknown[] })
          .documentCategories;
        if (!Array.isArray(rows)) throw new Error('Invalid categories.');
        return rows.flatMap((row) => {
          if (
            typeof row === 'object' &&
            row !== null &&
            'confidentiality' in row &&
            row.confidentiality !== 'operational'
          )
            return [];
          return [
            documentCategoryListSchema.shape.documentCategories.element.parse(
              row,
            ),
          ];
        });
      })
      .then(setCategories)
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    categoryQuery,
    employee,
    org.organizationId,
  ]);
  useEffect(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const query = new URLSearchParams({
      currentOnly: 'true',
      page: '1',
      pageSize: '100',
    });
    if (category.success) query.set('categoryId', category.data);
    void getJson(
      employeeDocumentsPath(org.organizationId, employeeId, query),
      new AbortController().signal,
    )
      .then((value) => employeeDocumentListSchema.parse(value).items)
      .then(setPredecessors)
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    category.data,
    category.success,
    employeeId,
    org.organizationId,
  ]);
  const open = (item: typeof employeeDocumentSchema._output | null) => {
    setSelected(item);
    setLinkOpen(item === null);
    setCategoryId(item?.categoryId ?? null);
    setRelationshipId(item?.relationshipId ?? null);
    setPredecessorId(item?.supersedesDocumentId ?? null);
    setDocumentId('');
    setMutationError(null);
  };
  const save = async (decision?: 'approved' | 'rejected') => {
    if (!org.organizationId) return;
    if (
      selected &&
      !decision &&
      categoryId === selected.categoryId &&
      relationshipId === selected.relationshipId &&
      predecessorId === selected.supersedesDocumentId
    ) {
      setMutationError(null);
      return;
    }
    try {
      const body = decision
        ? updateEmployeeDocumentSchema.parse({ approvalDecision: decision })
        : selected
          ? updateEmployeeDocumentSchema.parse({
              ...(categoryId !== selected.categoryId
                ? { categoryId: categoryId ?? undefined }
                : {}),
              ...(relationshipId !== selected.relationshipId
                ? { relationshipId }
                : {}),
              ...(predecessorId !== selected.supersedesDocumentId
                ? { supersedesDocumentId: predecessorId }
                : {}),
            })
          : createEmployeeDocumentSchema.parse({
              documentId,
              categoryId,
              relationshipId,
              supersedesDocumentId: predecessorId,
            });
      await sendHrJson(
        selected
          ? employeeDocumentPath(
              org.organizationId,
              employeeId,
              selected.documentId,
            )
          : employeeDocumentsPath(org.organizationId, employeeId),
        selected ? 'PATCH' : 'POST',
        body,
        employeeDocumentSchema,
      );
      setSelected(null);
      setLinkOpen(false);
      setDocumentId('');
      setMutationError(null);
      notify({ kind: 'success', title: t('employees.documentsSaved') });
      load();
    } catch (error) {
      setMutationError(
        error instanceof Error && 'status' in error && error.status === 409
          ? 'conflict'
          : 'general',
      );
    }
  };
  if (org.state === 'error' || accessState === 'error' || state === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.documentsError')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (access !== undefined && !access.capabilities.readHr)
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.denied')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (
    org.state === 'loading' ||
    accessState === 'loading' ||
    access === undefined ||
    state === 'loading' ||
    !documents ||
    !employee
  )
    return (
      <PageContainer>
        <p>{t('employees.loading')}</p>
      </PageContainer>
    );
  const manage = access.capabilities.manageHr;
  const categoryItems = categories.map((item) => ({
    id: item.id,
    label: `${item.code} ${item.name}`,
  }));
  const predecessorItems = predecessors
    .filter((item) => item.documentId !== selected?.documentId)
    .map((item) => ({ id: item.documentId, label: item.title }));
  const supersededIds = new Set(
    documents.items.flatMap((item) =>
      item.supersedesDocumentId ? [item.supersedesDocumentId] : [],
    ),
  );
  return (
    <PageContainer>
      <Stack gap={6}>
        <EmployeeTabs />
        <Heading>{t('employees.documents')}</Heading>
        <Stack gap={3} orientation="horizontal">
          <Select
            id="document-category-filter"
            labelText={t('employees.documentCategory')}
            value={category.success ? category.data : ''}
            onChange={(event) =>
              replace({ categoryId: event.target.value || null, page: '1' })
            }
          >
            <SelectItem value="" text={t('employees.allCategories')} />
            {categories.map((item) => (
              <SelectItem
                key={item.id}
                value={item.id}
                text={`${item.code} ${item.name}`}
              />
            ))}
          </Select>
          <Select
            id="document-approval-filter"
            labelText={t('employees.approvalStatus')}
            value={approval.success ? approval.data : ''}
            onChange={(event) =>
              replace({ approvalStatus: event.target.value || null, page: '1' })
            }
          >
            <SelectItem value="" text={t('employees.allApprovals')} />
            {['pending', 'approved', 'rejected', 'not_required'].map((item) => (
              <SelectItem
                key={item}
                value={item}
                text={t(`employees.${item}`)}
              />
            ))}
          </Select>
          <Select
            id="document-current-filter"
            labelText={t('employees.currentState')}
            value={currentOnly}
            onChange={(event) =>
              replace({ currentOnly: event.target.value, page: '1' })
            }
          >
            <SelectItem value="true" text={t('employees.currentOnly')} />
            <SelectItem value="false" text={t('employees.allDocuments')} />
          </Select>
        </Stack>
        {manage && (
          <Button onClick={() => open(null)}>
            {t('employees.linkDocument')}
          </Button>
        )}
        <DataGrid
          columns={[
            { key: 'title', header: 'Title' },
            { key: 'date', header: t('employees.documentDate') },
            { key: 'category', header: t('employees.documentCategory') },
            {
              key: 'relationship',
              header: t('employees.documentRelationship'),
            },
            { key: 'approval', header: t('employees.approvalStatus') },
            { key: 'current', header: t('employees.currentState') },
          ]}
          rows={documents.items.map((item) => ({
            id: item.documentId,
            title: item.title,
            date: item.documentDate,
            category:
              categories.find((value) => value.id === item.categoryId)?.name ??
              '',
            relationship:
              employee.relationships.find(
                (value) => value.id === item.relationshipId,
              )?.position ?? '',
            approval: t(`employees.${item.approvalStatus}`),
            current:
              currentOnly === 'true' || !supersededIds.has(item.documentId)
                ? t('employees.current')
                : t('employees.superseded'),
          }))}
          state={documents.items.length ? 'ready' : 'empty'}
          emptyLabel={t('employees.documentsEmpty')}
          pagination
          paginationMode="server"
          page={documents.page}
          pageSize={documents.pageSize}
          totalItems={documents.total}
          onPageChange={(next, size) =>
            replace({ page: String(next), pageSize: String(size) })
          }
          onRowClick={(row: { id: string }) => {
            const item = documents.items.find(
              (value) => value.documentId === row.id,
            );
            if (manage && item) open(item);
          }}
        />
        <Modal
          key={`${selected?.documentId ?? 'new'}-${linkOpen}`}
          open={linkOpen || selected !== null}
          modalHeading={
            selected
              ? t('employees.editDocument')
              : t('employees.linkDocumentTitle')
          }
          primaryButtonText={t('employees.save')}
          secondaryButtonText={t('common.cancel')}
          onRequestClose={() => {
            setLinkOpen(false);
            setSelected(null);
            setDocumentId('');
          }}
          onRequestSubmit={() => void save()}
        >
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Stack gap={3}>
              {mutationError && (
                <InlineNotification
                  kind="error"
                  title={t(
                    mutationError === 'conflict'
                      ? 'employees.documentsConflict'
                      : 'employees.documentsMutationError',
                  )}
                  hideCloseButton
                />
              )}
              {!selected && (
                <TextInput
                  id="employee-document-id"
                  labelText={t('employees.documentId')}
                  value={documentId}
                  onChange={(event) => setDocumentId(event.target.value)}
                  required
                />
              )}
              <ComboBox
                id="employee-document-category"
                items={categoryItems}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={
                  categoryItems.find((item) => item.id === categoryId) ?? null
                }
                onChange={(change) =>
                  setCategoryId(change.selectedItem?.id ?? null)
                }
                onInputChange={setCategoryQuery}
                onToggle={(open) => {
                  if (open) setCategoryQuery('');
                }}
                titleText={t('employees.documentCategory')}
              />
              <Select
                id="employee-document-relationship"
                labelText={t('employees.documentRelationship')}
                value={relationshipId ?? ''}
                onChange={(event) =>
                  setRelationshipId(event.target.value || null)
                }
              >
                <SelectItem value="" text="" />
                {employee.relationships.map((item) => (
                  <SelectItem
                    key={item.id}
                    value={item.id}
                    text={item.position}
                  />
                ))}
              </Select>
              <Select
                id="employee-document-predecessor"
                labelText={t('employees.documentPredecessor')}
                value={predecessorId ?? ''}
                onChange={(event) =>
                  setPredecessorId(event.target.value || null)
                }
              >
                <SelectItem value="" text="" />
                {predecessorItems.map((item) => (
                  <SelectItem key={item.id} value={item.id} text={item.label} />
                ))}
              </Select>
              {selected?.approvalStatus === 'pending' && (
                <Stack gap={3} orientation="horizontal">
                  <Button
                    kind="secondary"
                    onClick={() => void save('approved')}
                  >
                    {t('employees.approve')}
                  </Button>
                  <Button kind="danger" onClick={() => void save('rejected')}>
                    {t('employees.reject')}
                  </Button>
                </Stack>
              )}
            </Stack>
          </Form>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
