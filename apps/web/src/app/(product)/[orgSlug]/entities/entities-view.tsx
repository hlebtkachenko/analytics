'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow, RowAction } from '@bap/design-system/blocks';
import {
  Button,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useToast } from '../../../../components/shell/toast';
import {
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
  legalEntityPath,
  mutateJson,
} from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';

type EntityKind = 'company' | 'sole_trader';

type EntitiesViewProperties = Readonly<{
  canCreate: boolean;
  canDelete: boolean;
  canUpdate: boolean;
  initialEntities: readonly LegalEntity[];
  loadError: boolean;
  organizationId: string;
  workspaceName: string;
}>;

// The draft the modal validates before any request; the BFF and API validate again.
const draftSchema = z.object({
  kind: z.enum(['company', 'sole_trader']),
  name: z.string().trim().min(1).max(200),
  registrationNumber: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+$/),
  ]),
});

// A select value comes from the two-option list, so an unknown value falls back.
function asKind(value: string): EntityKind {
  return value === 'sole_trader' ? 'sole_trader' : 'company';
}

// The created column shows a plain calendar date, consistent with the workspace list.
function isoDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default function EntitiesView({
  canCreate,
  canDelete,
  canUpdate,
  initialEntities,
  loadError,
  organizationId,
  workspaceName,
}: EntitiesViewProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [entities, setEntities] = useState<readonly LegalEntity[]>(
    () => initialEntities,
  );
  const [listFailed, setListFailed] = useState(loadError);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LegalEntity | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind>('company');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [nameInUse, setNameInUse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LegalEntity | null>(null);

  const kindLabels: Readonly<Record<EntityKind, string>> = {
    company: t('entities.kinds.company'),
    sole_trader: t('entities.kinds.soleTrader'),
  };

  const columns: readonly GridColumn[] = [
    { header: t('entities.list.columnName'), key: 'name', sortable: true },
    { header: t('entities.list.columnKind'), key: 'kind', sortable: true },
    {
      header: t('entities.list.columnRegistration'),
      key: 'registrationNumber',
      sortable: true,
    },
    {
      header: t('entities.list.columnCreated'),
      key: 'created',
      sortable: true,
    },
  ];

  const rows: readonly GridRow[] = entities.map((entity) => ({
    created: isoDate(entity.createdAt),
    id: entity.id,
    kind: kindLabels[entity.kind],
    name: entity.name,
    registrationNumber: entity.registrationNumber ?? '—',
  }));

  const toolbarActions = canCreate
    ? [
        {
          id: 'create-entity',
          label: t('entities.list.addAction'),
          onClick: () => {
            openCreate();
          },
        },
      ]
    : undefined;

  function rowActions(): readonly RowAction[] {
    const actions: RowAction[] = [];
    if (canUpdate) {
      actions.push({
        id: 'edit',
        label: t('entities.actions.edit'),
        onClick: (target) => {
          openEdit(String(target.id));
        },
      });
    }
    if (canDelete) {
      actions.push({
        id: 'delete',
        isDelete: true,
        label: t('entities.actions.delete'),
        onClick: (target) => {
          openDelete(String(target.id));
        },
      });
    }
    return actions;
  }

  function openCreate(): void {
    setEditing(null);
    setName('');
    setKind('company');
    setRegistrationNumber('');
    setNameInUse(false);
    setFormOpen(true);
  }

  function openEdit(id: string): void {
    const entity = entities.find((candidate) => candidate.id === id);
    if (entity === undefined) {
      return;
    }
    setEditing(entity);
    setName(entity.name);
    setKind(entity.kind);
    setRegistrationNumber(entity.registrationNumber ?? '');
    setNameInUse(false);
    setFormOpen(true);
  }

  function openDelete(id: string): void {
    const entity = entities.find((candidate) => candidate.id === id);
    if (entity !== undefined) {
      setDeleteTarget(entity);
    }
  }

  async function reload(): Promise<void> {
    try {
      const payload = await getJson(
        legalEntitiesPath(organizationId),
        new AbortController().signal,
      );
      setEntities(legalEntityListSchema.parse(payload).legalEntities);
      setListFailed(false);
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        setListFailed(true);
      }
    }
  }

  async function submitForm(): Promise<void> {
    const parsed = draftSchema.safeParse({
      kind,
      name,
      registrationNumber: registrationNumber.trim(),
    });
    if (!parsed.success) {
      notify({ kind: 'error', title: t('entities.toast.failure') });
      return;
    }

    const registration =
      parsed.data.registrationNumber.length > 0
        ? parsed.data.registrationNumber
        : undefined;
    const current = editing;
    const body =
      current === null
        ? {
            kind: parsed.data.kind,
            name: parsed.data.name,
            ...(registration === undefined
              ? {}
              : { registrationNumber: registration }),
          }
        : {
            kind: parsed.data.kind,
            name: parsed.data.name,
            registrationNumber: registration ?? null,
          };

    setSubmitting(true);
    setNameInUse(false);
    const result =
      current === null
        ? await mutateJson(legalEntitiesPath(organizationId), {
            body,
            method: 'POST',
          })
        : await mutateJson(legalEntityPath(organizationId, current.id), {
            body,
            method: 'PATCH',
          });
    setSubmitting(false);

    if (result.ok) {
      setFormOpen(false);
      notify({
        kind: 'success',
        title: t(
          current === null
            ? 'entities.toast.createSuccess'
            : 'entities.toast.updateSuccess',
        ),
      });
      await reload();
      return;
    }

    // A duplicate name is the one failure the form keeps distinct and inline.
    if (result.status === 409) {
      setNameInUse(true);
      return;
    }

    notify({ kind: 'error', title: t('entities.toast.failure') });
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await mutateJson(
      legalEntityPath(organizationId, target.id),
      {
        method: 'DELETE',
      },
    );
    setSubmitting(false);
    setDeleteTarget(null);

    if (result.ok) {
      notify({ kind: 'success', title: t('entities.toast.deleteSuccess') });
      await reload();
      return;
    }

    notify({ kind: 'error', title: t('entities.toast.failure') });
  }

  return (
    <>
      <h1>{t('entities.list.title', { name: workspaceName })}</h1>
      {listFailed ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          role="alert"
          title={t('entities.list.loadError')}
        />
      ) : entities.length === 0 ? (
        <Tile>
          <p>
            {canCreate
              ? t('entities.list.emptyCreatable')
              : t('entities.list.empty')}
          </p>
          {canCreate ? (
            <Button
              onClick={() => {
                openCreate();
              }}
              type="button"
            >
              {t('entities.list.addAction')}
            </Button>
          ) : null}
        </Tile>
      ) : (
        <DataGrid
          columns={columns}
          initialSort={[{ direction: 'ASC', key: 'name' }]}
          rows={rows}
          search
          size="sm"
          sortable
          {...(canUpdate || canDelete ? { rowActions } : {})}
          {...(toolbarActions === undefined ? {} : { toolbarActions })}
        />
      )}
      <Modal
        danger={false}
        modalHeading={t(
          editing === null
            ? 'entities.form.createTitle'
            : 'entities.form.editTitle',
        )}
        onRequestClose={() => {
          setFormOpen(false);
        }}
        onRequestSubmit={() => {
          void submitForm();
        }}
        open={formOpen}
        primaryButtonDisabled={submitting || name.trim().length === 0}
        primaryButtonText={t('entities.form.submit')}
        secondaryButtonText={t('entities.form.cancel')}
      >
        <Stack gap={5}>
          <TextInput
            id="entity-name"
            invalid={nameInUse}
            invalidText={t('entities.form.nameInUse')}
            labelText={t('entities.form.nameLabel')}
            onChange={(event) => {
              setName(event.target.value);
              setNameInUse(false);
            }}
            value={name}
          />
          <Select
            id="entity-kind"
            labelText={t('entities.form.kindLabel')}
            onChange={(event) => {
              setKind(asKind(event.target.value));
            }}
            value={kind}
          >
            <SelectItem text={kindLabels.company} value="company" />
            <SelectItem text={kindLabels.sole_trader} value="sole_trader" />
          </Select>
          <TextInput
            id="entity-registration"
            labelText={t('entities.form.registrationLabel')}
            onChange={(event) => {
              setRegistrationNumber(event.target.value);
            }}
            value={registrationNumber}
          />
        </Stack>
      </Modal>
      {deleteTarget !== null ? (
        <Modal
          danger
          modalHeading={t('entities.delete.title', { name: deleteTarget.name })}
          onRequestClose={() => {
            setDeleteTarget(null);
          }}
          onRequestSubmit={() => {
            void confirmDelete();
          }}
          open
          primaryButtonDisabled={submitting}
          primaryButtonText={t('entities.delete.confirm')}
          secondaryButtonText={t('entities.delete.cancel')}
        >
          <p>{t('entities.delete.body')}</p>
        </Modal>
      ) : null}
    </>
  );
}
