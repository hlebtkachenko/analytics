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
  Toggle,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../components/shell/toast';
import { getJson } from '../../../lib/datasets/client';
import {
  hrReferencePath,
  hrReferencesPath,
  HrRequestError,
  sendHrJson,
} from '../../../lib/hr/client';
import { SettingsNavigation } from './settings-navigation';
import {
  costCentreListSchema,
  costCentreSchema,
  departmentListSchema,
  departmentSchema,
  documentCategoryListSchema,
  documentCategorySchema,
  positionListSchema,
  positionSchema,
  workplaceListSchema,
  workplaceSchema,
  hrReferenceIdSchema,
} from '../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';

type Collection =
  | 'departments'
  | 'positions'
  | 'cost-centres'
  | 'workplaces'
  | 'document-categories';
type Item = {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  active: boolean;
  parentId?: string | null;
  addressLabel?: string | null;
  retentionKey?: string;
  requiresApproval?: boolean;
};
const schemas = {
  departments: departmentListSchema,
  positions: positionListSchema,
  'cost-centres': costCentreListSchema,
  workplaces: workplaceListSchema,
  'document-categories': documentCategoryListSchema,
} as const;
const keys = {
  departments: 'departments',
  positions: 'positions',
  'cost-centres': 'costCentres',
  workplaces: 'workplaces',
  'document-categories': 'documentCategories',
} as const;
const itemSchemas = {
  departments: departmentSchema,
  positions: positionSchema,
  'cost-centres': costCentreSchema,
  workplaces: workplaceSchema,
  'document-categories': documentCategorySchema,
} as const;

export default function ReferencePage({
  collection,
  structure,
}: {
  collection: Collection;
  structure: boolean;
}) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const entities = useLegalEntities(organization.organizationId);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const entityResult = hrReferenceIdSchema.safeParse(
    params.get('legalEntityId'),
  );
  const entity = entityResult.success ? entityResult.data : '';
  const rawQuery = params.get('q') ?? '';
  const q = rawQuery.trim().slice(0, 100);
  const activeValue = params.get('active');
  const active =
    activeValue === 'true' || activeValue === 'false' ? activeValue : '';
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPageSize = Number(params.get('pageSize'));
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? rawPageSize
      : 25;
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modal, setModal] = useState<Item | 'new' | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [addressLabel, setAddressLabel] = useState('');
  const [retentionKey, setRetentionKey] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [mutationError, setMutationError] = useState<
    'conflict' | 'general' | null
  >(null);
  const [parents, setParents] = useState<Item[]>([]);
  const [parentQuery, setParentQuery] = useState('');
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    router.replace(`${pathname}?${next}` as never);
  };
  const query = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (entity) next.set('legalEntityId', entity);
    if (q) next.set('q', q);
    if (active) next.set('active', active);
    return next;
  }, [active, entity, page, pageSize, q]);
  const load = () => {
    if (!organization.organizationId || !access?.capabilities.readHr) return;
    void getJson(
      hrReferencesPath(organization.organizationId, collection, query),
      new AbortController().signal,
    )
      .then((x) => schemas[collection].parse(x))
      .then((x) => {
        const data = x as Record<string, unknown>;
        setItems(data[keys[collection]] as Item[]);
        setTotal(data.total as number);
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(() => {
    if (
      accessState !== 'idle' ||
      !organization.organizationId ||
      !access?.capabilities.readHr
    )
      return;
    void getJson(
      hrReferencesPath(organization.organizationId, collection, query),
      new AbortController().signal,
    )
      .then((x) => schemas[collection].parse(x))
      .then((x) => {
        const data = x as Record<string, unknown>;
        setItems(data[keys[collection]] as Item[]);
        setTotal(data.total as number);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    accessState,
    collection,
    organization.organizationId,
    query,
  ]);
  useEffect(() => {
    if (
      modal === null ||
      collection !== 'departments' ||
      !entity ||
      !organization.organizationId ||
      accessState !== 'idle' ||
      !access?.capabilities.readHr
    )
      return;
    const parentParameters = new URLSearchParams({
      legalEntityId: entity,
      active: 'true',
      page: '1',
      pageSize: '100',
    });
    if (parentQuery.trim())
      parentParameters.set('q', parentQuery.trim().slice(0, 100));
    void getJson(
      hrReferencesPath(
        organization.organizationId,
        'departments',
        parentParameters,
      ),
      new AbortController().signal,
    )
      .then((x) => departmentListSchema.parse(x))
      .then((x) => setParents(x.departments))
      .catch(() => setParents([]));
  }, [
    access?.capabilities.readHr,
    accessState,
    collection,
    entity,
    modal,
    organization.organizationId,
    parentQuery,
  ]);
  const open = (value: Item | 'new') => {
    setModal(value);
    setMutationError(null);
    setParentQuery('');
    setCode(value === 'new' ? '' : value.code);
    setName(value === 'new' ? '' : value.name);
    setParentId(value === 'new' ? '' : (value.parentId ?? ''));
    setAddressLabel(value === 'new' ? '' : (value.addressLabel ?? ''));
    setRetentionKey(value === 'new' ? '' : (value.retentionKey ?? ''));
    setRequiresApproval(
      value === 'new' ? false : (value.requiresApproval ?? false),
    );
  };
  const submit = async () => {
    if (!organization.organizationId || modal === null) return;
    if (
      modal === 'new' &&
      (!entity ||
        !code.trim() ||
        !name.trim() ||
        (collection === 'document-categories' && !retentionKey.trim()))
    ) {
      setMutationError('general');
      return;
    }
    const base = modal === 'new' ? { legalEntityId: entity, code, name } : {};
    const mutable =
      modal === 'new'
        ? base
        : {
            ...(name !== modal.name ? { name } : {}),
            ...(collection === 'departments' &&
            parentId !== (modal.parentId ?? '')
              ? { parentId: parentId || null }
              : {}),
            ...(collection === 'workplaces' &&
            addressLabel !== (modal.addressLabel ?? '')
              ? { addressLabel: addressLabel || null }
              : {}),
            ...(collection === 'document-categories' &&
            retentionKey !== modal.retentionKey
              ? { retentionKey }
              : {}),
            ...(collection === 'document-categories' &&
            requiresApproval !== modal.requiresApproval
              ? { requiresApproval }
              : {}),
          };
    const body = {
      ...mutable,
      ...(modal === 'new' && collection === 'departments'
        ? { parentId: parentId || null }
        : {}),
      ...(modal === 'new' && collection === 'workplaces'
        ? { addressLabel: addressLabel || null }
        : {}),
      ...(modal === 'new' && collection === 'document-categories'
        ? {
            confidentiality: 'operational' as const,
            retentionKey,
            requiresApproval,
          }
        : {}),
    };
    if (modal !== 'new' && Object.keys(body).length === 0) return;
    try {
      await sendHrJson(
        modal === 'new'
          ? hrReferencesPath(organization.organizationId, collection)
          : hrReferencePath(organization.organizationId, collection, modal.id),
        modal === 'new' ? 'POST' : 'PATCH',
        body,
        itemSchemas[collection],
      );
      setModal(null);
      notify({ kind: 'success', title: t('hrSettings.saved') });
      load();
    } catch (error) {
      setMutationError(
        error instanceof HrRequestError && error.status === 409
          ? 'conflict'
          : 'general',
      );
    }
  };
  const rows = items.map((item) => ({
    ...item,
    active: item.active ? t('hrSettings.active') : t('hrSettings.retired'),
    special:
      collection === 'departments'
        ? (item.parentId ?? '')
        : collection === 'workplaces'
          ? (item.addressLabel ?? '')
          : collection === 'document-categories'
            ? `${item.retentionKey} ${item.requiresApproval ? t('hrSettings.yes') : t('hrSettings.no')}`
            : '',
  }));
  if (accessState === 'loading' || organization.state === 'loading')
    return (
      <>
        <InlineNotification
          kind="info"
          hideCloseButton
          title={t('hrSettings.loading')}
        />
      </>
    );
  if (accessState === 'error' || organization.state === 'error')
    return (
      <InlineNotification
        kind="error"
        hideCloseButton
        title={t('hrSettings.accessError')}
      />
    );
  if (!access?.capabilities.readHr)
    return (
      <>
        <InlineNotification
          kind="error"
          hideCloseButton
          title={t('hrSettings.denied')}
        />
      </>
    );
  return (
    <Stack gap={6}>
      <SettingsNavigation />
      <div>
        <Heading>
          {t(
            structure
              ? 'hrSettings.structureTitle'
              : 'hrSettings.documentsTitle',
          )}
        </Heading>
        {access.capabilities.manageHr && entity ? (
          <Button onClick={() => open('new')}>{t('hrSettings.create')}</Button>
        ) : null}
      </div>
      <Stack gap={5}>
        <Select
          id="hr-kind"
          labelText={t('hrSettings.kind')}
          value={collection}
          onChange={(event) => update('kind', event.target.value)}
          disabled={!structure}
        >
          {structure ? (
            <>
              <SelectItem
                value="departments"
                text={t('hrSettings.departments')}
              />
              <SelectItem value="positions" text={t('hrSettings.positions')} />
              <SelectItem
                value="cost-centres"
                text={t('hrSettings.costCentres')}
              />
              <SelectItem
                value="workplaces"
                text={t('hrSettings.workplaces')}
              />
            </>
          ) : (
            <SelectItem
              value="document-categories"
              text={t('hrSettings.documentCategories')}
            />
          )}
        </Select>
        <Select
          id="hr-entity"
          labelText={t('hrSettings.legalEntity')}
          value={entity}
          onChange={(event) => update('legalEntityId', event.target.value)}
        >
          <SelectItem value="" text={t('hrSettings.allEntities')} />
          {entities.map((value) => (
            <SelectItem key={value.id} value={value.id} text={value.name} />
          ))}
        </Select>
        <Select
          id="hr-active"
          labelText={t('hrSettings.activeFilter')}
          value={active}
          onChange={(event) => update('active', event.target.value)}
        >
          <SelectItem value="" text={t('hrSettings.all')} />
          <SelectItem value="true" text={t('hrSettings.active')} />
          <SelectItem value="false" text={t('hrSettings.retired')} />
        </Select>
      </Stack>
      <DataGrid
        columns={[
          { key: 'code', header: t('hrSettings.code') },
          { key: 'name', header: t('hrSettings.name') },
          ...(collection === 'positions' || collection === 'cost-centres'
            ? []
            : [{ key: 'special', header: t('hrSettings.details') }]),
          { key: 'active', header: t('hrSettings.status') },
        ]}
        rows={rows}
        search
        searchValue={q}
        onSearch={(value) => update('q', value)}
        pagination
        paginationMode="server"
        page={page}
        pageSize={pageSize}
        totalItems={total}
        onPageChange={(next, size) => {
          const value = new URLSearchParams(params.toString());
          value.set('page', String(next));
          value.set('pageSize', String(size));
          router.replace(`${pathname}?${value}` as never);
        }}
        state={
          state === 'error'
            ? 'error'
            : state === 'loading'
              ? 'loading'
              : rows.length === 0
                ? 'empty'
                : 'ready'
        }
        emptyLabel={t('hrSettings.empty')}
        errorLabel={t('hrSettings.error')}
        {...(access.capabilities.manageHr
          ? {
              onRowClick: (row: { id: string }) => {
                const selected = items.find((item) => item.id === row.id);
                if (selected) open(selected);
              },
            }
          : {})}
      />
      <Modal
        open={modal !== null}
        modalHeading={t(
          modal === 'new' ? 'hrSettings.create' : 'hrSettings.edit',
        )}
        primaryButtonText={t('hrSettings.save')}
        secondaryButtonText={t('hrSettings.cancel')}
        onRequestClose={() => setModal(null)}
        onRequestSubmit={() => void submit()}
      >
        <Stack gap={5}>
          {mutationError ? (
            <InlineNotification
              kind="error"
              hideCloseButton
              title={t(
                mutationError === 'conflict'
                  ? 'hrSettings.conflict'
                  : 'hrSettings.saveFailed',
              )}
            />
          ) : null}
          {modal !== 'new' ? (
            <p>
              {t('hrSettings.code')}: {code}
            </p>
          ) : (
            <>
              <TextInput
                id="hr-code"
                labelText={t('hrSettings.code')}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <TextInput
                id="hr-name"
                labelText={t('hrSettings.name')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </>
          )}
          {modal !== 'new' ? (
            <TextInput
              id="hr-name"
              labelText={t('hrSettings.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}
          {collection === 'departments' ? (
            <ComboBox
              id="hr-parent"
              items={[
                { id: '', label: t('hrSettings.noParent') },
                ...parents
                  .filter(
                    (value) =>
                      value.id !==
                      (modal === null || modal === 'new' ? '' : modal.id),
                  )
                  .map((value) => ({
                    id: value.id,
                    label: `${value.code} ${value.name}`,
                  })),
              ]}
              itemToString={(item) => item?.label ?? ''}
              onChange={(change) => setParentId(change.selectedItem?.id ?? '')}
              onInputChange={setParentQuery}
              selectedItem={
                [
                  { id: '', label: t('hrSettings.noParent') },
                  ...parents.map((value) => ({
                    id: value.id,
                    label: `${value.code} ${value.name}`,
                  })),
                ].find((value) => value.id === parentId) ?? null
              }
              titleText={t('hrSettings.parent')}
              placeholder={t('hrSettings.parentSearch')}
            />
          ) : null}
          {collection === 'workplaces' ? (
            <TextInput
              id="hr-address"
              labelText={t('hrSettings.addressLabel')}
              value={addressLabel}
              onChange={(event) => setAddressLabel(event.target.value)}
            />
          ) : null}
          {collection === 'document-categories' ? (
            <>
              <TextInput
                id="hr-retention"
                labelText={t('hrSettings.retentionKey')}
                value={retentionKey}
                onChange={(event) => setRetentionKey(event.target.value)}
              />
              <Toggle
                id="hr-approval"
                labelText={t('hrSettings.requiresApproval')}
                toggled={requiresApproval}
                onToggle={setRequiresApproval}
              />
            </>
          ) : null}
          {modal !== null && modal !== 'new' && modal.active ? (
            <Button
              kind="danger--tertiary"
              onClick={() => {
                void sendHrJson(
                  hrReferencePath(
                    organization.organizationId,
                    collection,
                    modal.id,
                  ),
                  'PATCH',
                  { active: false },
                  itemSchemas[collection],
                )
                  .then(() => {
                    setModal(null);
                    notify({ kind: 'success', title: t('hrSettings.saved') });
                    load();
                  })
                  .catch((error) =>
                    setMutationError(
                      error instanceof HrRequestError && error.status === 409
                        ? 'conflict'
                        : 'general',
                    ),
                  );
              }}
            >
              {t('hrSettings.retire')}
            </Button>
          ) : null}
        </Stack>
      </Modal>
    </Stack>
  );
}
