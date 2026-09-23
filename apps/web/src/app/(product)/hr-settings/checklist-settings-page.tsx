'use client';
import {
  Button,
  ComboBox,
  Heading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../components/shell/toast';
import { getJson } from '../../../lib/datasets/client';
import {
  checklistTemplateItemPath,
  checklistTemplateItemsPath,
  checklistTemplatePath,
  checklistTemplatesPath,
  hrReferencesPath,
  HrRequestError,
  sendHrJson,
} from '../../../lib/hr/client';
import {
  checklistKindSchema,
  checklistTemplateListSchema,
  checklistTemplateSchema,
  createChecklistTemplateItemSchema,
  createChecklistTemplateSchema,
  documentCategoryListSchema,
  identifierSchema,
  updateChecklistTemplateItemSchema,
  updateChecklistTemplateSchema,
} from '../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { SettingsNavigation } from './settings-navigation';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
const page = (v: string | null, d: number, max = 100) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : d;
};
type Template = typeof checklistTemplateSchema._output;
export default function ChecklistSettingsPage() {
  const { t } = useTranslation();
  const org = useOrganizationSelection();
  const entities = useLegalEntities(org.organizationId);
  const { access, state: accessState } = useOrganizationAccess(
    org.organizationId,
  );
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { notify } = useToast();
  const legalEntity = identifierSchema.safeParse(params.get('legalEntityId'));
  const kind = checklistKindSchema.safeParse(params.get('kind'));
  const active =
    params.get('active') === 'true' || params.get('active') === 'false'
      ? params.get('active')!
      : '';
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  const currentPage = page(params.get('page'), 1);
  const pageSize = page(params.get('pageSize'), 25);
  const [data, setData] =
    useState<typeof checklistTemplateListSchema._output>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<Template | null>(null);
  const selectedId = identifierSchema.safeParse(params.get('selected'));
  const [modal, setModal] = useState<'template' | 'item' | null>(null);
  const [editingItem, setEditingItem] = useState<
    Template['items'][number] | null
  >(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [formKind, setFormKind] = useState('onboarding');
  const [position, setPosition] = useState('1');
  const [offset, setOffset] = useState('0');
  const [documentCategoryId, setDocumentCategoryId] = useState<string | null>(
    null,
  );
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categories, setCategories] = useState<
    (typeof documentCategoryListSchema._output)['documentCategories']
  >([]);
  const [error, setError] = useState<'conflict' | 'general' | null>(null);
  const replace = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.set('page', '1');
    router.replace(`${pathname}?${next}` as never);
  };
  const load = useCallback(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const query = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(pageSize),
    });
    if (legalEntity.success) query.set('legalEntityId', legalEntity.data);
    if (kind.success) query.set('kind', kind.data);
    if (active) query.set('active', active);
    if (q) query.set('q', q);
    void getJson(
      checklistTemplatesPath(org.organizationId, query),
      new AbortController().signal,
    )
      .then((v) => checklistTemplateListSchema.parse(v))
      .then((v) => {
        setData(v);
        setSelected(
          v.items.find(
            (x) => x.id === (selectedId.success ? selectedId.data : ''),
          ) ?? null,
        );
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    active,
    currentPage,
    kind.data,
    kind.success,
    legalEntity.data,
    legalEntity.success,
    org.organizationId,
    pageSize,
    q,
    selectedId.data,
    selectedId.success,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!modal || modal !== 'item' || !org.organizationId || !selected) return;
    const query = new URLSearchParams({
      legalEntityId: selected.legalEntityId,
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
      .then(
        (value) => documentCategoryListSchema.parse(value).documentCategories,
      )
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [categoryQuery, modal, org.organizationId, selected]);
  const openTemplate = (template: Template | null) => {
    setSelected(template);
    setName(template?.name ?? '');
    setCode(template?.code ?? '');
    setFormKind(template?.kind ?? 'onboarding');
    setError(null);
    setModal('template');
  };
  const openItem = (item: Template['items'][number] | null) => {
    setEditingItem(item);
    setName(item?.title ?? '');
    setPosition(String(item?.position ?? (selected?.items.length ?? 0) + 1));
    setOffset(String(item?.defaultDueOffsetDays ?? 0));
    setDocumentCategoryId(item?.documentCategoryId ?? null);
    setCategoryQuery('');
    setError(null);
    setModal('item');
  };
  const save = async () => {
    if (!org.organizationId || !modal) return;
    if (modal === 'template' && selected && name === selected.name) return;
    if (
      modal === 'item' &&
      editingItem &&
      Number(position) === editingItem.position &&
      name === editingItem.title &&
      Number(offset) === editingItem.defaultDueOffsetDays &&
      documentCategoryId === editingItem.documentCategoryId
    )
      return;
    try {
      if (modal === 'template') {
        const body = selected
          ? updateChecklistTemplateSchema.parse({ name })
          : createChecklistTemplateSchema.parse({
              legalEntityId: legalEntity.success ? legalEntity.data : '',
              kind: formKind,
              code,
              name,
            });
        await sendHrJson(
          selected
            ? checklistTemplatePath(org.organizationId, selected.id)
            : checklistTemplatesPath(org.organizationId),
          selected ? 'PATCH' : 'POST',
          body,
          checklistTemplateSchema,
        );
      } else if (selected) {
        const body = editingItem
          ? updateChecklistTemplateItemSchema.parse({
              ...(Number(position) !== editingItem.position
                ? { position: Number(position) }
                : {}),
              ...(name !== editingItem.title ? { title: name } : {}),
              ...(Number(offset) !== editingItem.defaultDueOffsetDays
                ? { defaultDueOffsetDays: Number(offset) }
                : {}),
              ...(documentCategoryId !== editingItem.documentCategoryId
                ? { documentCategoryId }
                : {}),
            })
          : createChecklistTemplateItemSchema.parse({
              position: Number(position),
              title: name,
              defaultDueOffsetDays: Number(offset),
              documentCategoryId,
            });
        await sendHrJson(
          editingItem
            ? checklistTemplateItemPath(
                org.organizationId,
                selected.id,
                editingItem.id,
              )
            : checklistTemplateItemsPath(org.organizationId, selected.id),
          editingItem ? 'PATCH' : 'POST',
          body,
          checklistTemplateSchema.shape.items.element,
        );
      }
      setModal(null);
      notify({ kind: 'success', title: t('checklists.save') });
      load();
    } catch (e) {
      setError(
        e instanceof HrRequestError && e.status === 409
          ? 'conflict'
          : 'general',
      );
    }
  };
  if (accessState === 'loading' || org.state === 'loading')
    return (
      <InlineNotification
        kind="info"
        hideCloseButton
        title={t('checklists.loading')}
      />
    );
  if (accessState === 'error' || org.state === 'error' || state === 'error')
    return (
      <InlineNotification
        kind="error"
        hideCloseButton
        title={t('checklists.error')}
      />
    );
  if (!access?.capabilities.readHr)
    return (
      <InlineNotification
        kind="error"
        hideCloseButton
        title={t('checklists.denied')}
      />
    );
  const rows = data?.items ?? [];
  return (
    <Stack gap={6}>
      <SettingsNavigation />
      <Heading>{t('checklists.checklistTemplates')}</Heading>
      <Stack gap={4}>
        <Select
          id="entity"
          labelText={t('checklists.legalEntity')}
          value={legalEntity.success ? legalEntity.data : ''}
          onChange={(e) => replace({ legalEntityId: e.target.value || null })}
        >
          <SelectItem value="" text={t('checklists.allEntities')} />
          {entities.map((e) => (
            <SelectItem key={e.id} value={e.id} text={e.name} />
          ))}
        </Select>
        <Select
          id="kind"
          labelText={t('checklists.kind')}
          value={kind.success ? kind.data : ''}
          onChange={(e) => replace({ kind: e.target.value || null })}
        >
          <SelectItem value="" text={t('checklists.allKinds')} />
          {checklistKindSchema.options.map((v) => (
            <SelectItem key={v} value={v} text={v} />
          ))}
        </Select>
        <Select
          id="active"
          labelText={t('checklists.status')}
          value={active}
          onChange={(e) => replace({ active: e.target.value || null })}
        >
          <SelectItem value="" text={t('checklists.all')} />
          <SelectItem value="true" text={t('checklists.active')} />
          <SelectItem value="false" text={t('checklists.retired')} />
        </Select>
        {access.capabilities.manageHr && legalEntity.success ? (
          <Button onClick={() => openTemplate(null)}>
            {t('checklists.createTemplate')}
          </Button>
        ) : null}
      </Stack>
      <DataGrid
        columns={[
          { key: 'code', header: t('checklists.code') },
          { key: 'name', header: t('checklists.name') },
          { key: 'kind', header: t('checklists.kind') },
          { key: 'active', header: t('checklists.status') },
        ]}
        rows={rows.map((x) => ({
          id: x.id,
          code: x.code,
          kind: x.kind,
          name: x.name,
          active: x.active ? t('checklists.active') : t('checklists.retired'),
        }))}
        search
        searchValue={q}
        onSearch={(v) => replace({ q: v || null })}
        pagination
        paginationMode="server"
        page={currentPage}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={(p, s) =>
          replace({ page: String(p), pageSize: String(s) })
        }
        state={
          state === 'loading' ? 'loading' : rows.length ? 'ready' : 'empty'
        }
        {...(access.capabilities.manageHr
          ? {
              onRowClick: (row: { id: string }) =>
                replace({ selected: row.id }),
            }
          : {})}
      />
      {selected ? (
        <>
          <Heading>{t('checklists.templateItem')}</Heading>
          {access.capabilities.manageHr ? (
            <>
              <Button onClick={() => openTemplate(selected)}>
                {t('checklists.edit')}
              </Button>
              <Button onClick={() => openItem(null)}>
                {t('checklists.createItem')}
              </Button>
            </>
          ) : null}
          <DataGrid
            columns={[
              { key: 'position', header: t('checklists.position') },
              { key: 'title', header: t('checklists.title') },
              {
                key: 'defaultDueOffsetDays',
                header: t('checklists.dueOffset'),
              },
              { key: 'active', header: t('checklists.status') },
            ]}
            rows={selected.items.map((x) => ({
              ...x,
              active: x.active
                ? t('checklists.active')
                : t('checklists.retired'),
            }))}
            state={selected.items.length ? 'ready' : 'empty'}
            {...(access.capabilities.manageHr
              ? {
                  onRowClick: (row: { id: string }) =>
                    openItem(
                      selected.items.find((x) => x.id === row.id) ?? null,
                    ),
                }
              : {})}
          />
        </>
      ) : null}
      <Modal
        open={modal !== null}
        modalHeading={
          modal === 'template'
            ? t('checklists.template')
            : t('checklists.templateItem')
        }
        primaryButtonText={t('checklists.save')}
        secondaryButtonText={t('checklists.cancel')}
        onRequestClose={() => setModal(null)}
        onSecondarySubmit={() => setModal(null)}
        onRequestSubmit={() => void save()}
      >
        <Stack gap={4}>
          {error ? (
            <InlineNotification
              kind="error"
              hideCloseButton
              title={
                error === 'conflict'
                  ? t('checklists.conflict')
                  : t('checklists.pageError')
              }
            />
          ) : null}
          {modal === 'template' && !selected ? (
            <>
              <TextInput
                id="code"
                labelText={t('checklists.code')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Select
                id="template-kind"
                labelText={t('checklists.kind')}
                value={formKind}
                onChange={(e) => setFormKind(e.target.value)}
              >
                {checklistKindSchema.options.map((v) => (
                  <SelectItem key={v} value={v} text={v} />
                ))}
              </Select>
            </>
          ) : null}
          <TextInput
            id="name"
            labelText={
              modal === 'template'
                ? t('checklists.name')
                : t('checklists.title')
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {modal === 'item' ? (
            <>
              <TextInput
                id="position"
                labelText={t('checklists.position')}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
              <TextInput
                id="offset"
                labelText={t('checklists.dueOffset')}
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
              <ComboBox
                id="document-category"
                titleText={t('checklists.documentCategory')}
                placeholder={t('checklists.searchCategories')}
                items={[
                  { id: '', label: t('checklists.noCategory') },
                  ...categories.map((category) => ({
                    id: category.id,
                    label: `${category.code} ${category.name}`,
                  })),
                ]}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={
                  [
                    { id: '', label: t('checklists.noCategory') },
                    ...categories.map((category) => ({
                      id: category.id,
                      label: `${category.code} ${category.name}`,
                    })),
                  ].find(
                    (category) => category.id === (documentCategoryId ?? ''),
                  ) ?? null
                }
                onChange={(change) =>
                  setDocumentCategoryId(change.selectedItem?.id || null)
                }
                onInputChange={setCategoryQuery}
              />
            </>
          ) : null}
          {modal === 'template' && selected?.active ? (
            <Button
              kind="danger--tertiary"
              onClick={() => {
                void sendHrJson(
                  checklistTemplatePath(org.organizationId, selected.id),
                  'PATCH',
                  updateChecklistTemplateSchema.parse({ active: false }),
                  checklistTemplateSchema,
                )
                  .then(() => {
                    setModal(null);
                    notify({ kind: 'success', title: t('checklists.save') });
                    load();
                  })
                  .catch(() => setError('general'));
              }}
            >
              {t('checklists.retireTemplate')}
            </Button>
          ) : null}
          {modal === 'item' && editingItem?.active ? (
            <Button
              kind="danger--tertiary"
              onClick={() => {
                if (!selected) return;
                void sendHrJson(
                  checklistTemplateItemPath(
                    org.organizationId,
                    selected.id,
                    editingItem.id,
                  ),
                  'PATCH',
                  updateChecklistTemplateItemSchema.parse({ active: false }),
                  checklistTemplateSchema.shape.items.element,
                )
                  .then(() => {
                    setModal(null);
                    notify({ kind: 'success', title: t('checklists.save') });
                    load();
                  })
                  .catch(() => setError('general'));
              }}
            >
              {t('checklists.retireItem')}
            </Button>
          ) : null}
        </Stack>
      </Modal>
    </Stack>
  );
}
