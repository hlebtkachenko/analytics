'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  Form,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  Tag,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import { sendWithoutContent } from '../../../../lib/documents/client';
import {
  documentKindSchema,
  isInvoiceKind,
} from '../../../../lib/documents/contract.ts';
import { documentKindLabelKeys } from '../../../../lib/documents/labels.ts';
import {
  inboxRoutingTargetPath,
  inboxRoutingTargetsPath,
  inboxSettingsPath,
  saveInboxRoutingTarget,
  updateInboxSettings,
} from '../../../../lib/inbox/client';
import {
  inboxRoutingAutoPolicySchema,
  inboxRoutingDestinationSchema,
  inboxRoutingTargetListResponseSchema,
  inboxSettingsSchema,
  putInboxRoutingTargetRequestSchema,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxRoutingAutoPolicy,
  InboxRoutingDestination,
  InboxRoutingTarget,
  InboxSettings,
} from '../../../../lib/inbox/contract.ts';
import {
  inboxRoutingAutoLabelKeys,
  inboxRoutingDestinationLabelKeys,
  inboxRoutingDestinationNoneLabelKey,
} from '../../../../lib/inbox/labels.ts';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type Loaded = Readonly<{
  settings: InboxSettings;
  targets: InboxRoutingTarget[];
}>;
type LoadResult = Readonly<{ key: string; value?: Loaded }>;

// The modal edits strings only; the contract parses them back on save.
type TargetForm = Readonly<{
  assigneeId: string;
  auto: InboxRoutingAutoPolicy;
  // Blank means the platform default names no destination yet; the PUT body still requires a choice.
  destination: InboxRoutingDestination | '';
  detectedType: string;
  documentKind: string;
  legalEntityId: string;
  requiredFields: string;
  threshold: string;
}>;

const BYTES_PER_MEGABYTE = 1_000_000;

function megabytes(bytes: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(
    bytes / BYTES_PER_MEGABYTE,
  );
}

function formFromTarget(target: InboxRoutingTarget): TargetForm {
  return {
    assigneeId: target.defaultAssigneeId ?? '',
    auto: target.auto,
    destination: target.destination ?? '',
    detectedType: target.detectedType,
    documentKind: target.documentKind ?? '',
    legalEntityId: target.defaultLegalEntityId ?? '',
    requiredFields: target.requiredFields.join(', '),
    threshold:
      target.autoThreshold === null ? '' : String(target.autoThreshold),
  };
}

// Blank strings become nulls and the comma list becomes an array; the schema decides whether that is a target.
function bodyFromForm(form: TargetForm): unknown {
  const threshold = form.threshold.trim();
  return {
    auto: form.auto,
    autoThreshold: threshold.length === 0 ? null : Number(threshold),
    defaultAssigneeId:
      form.assigneeId.trim().length === 0 ? null : form.assigneeId.trim(),
    defaultLegalEntityId:
      form.legalEntityId.length === 0 ? null : form.legalEntityId,
    destination: form.destination,
    documentKind:
      form.destination === 'documents' && form.documentKind.length > 0
        ? form.documentKind
        : null,
    partnerPolicy: 'match_only',
    requiredFields: form.requiredFields
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0),
  };
}

function isInvoiceTarget(target: InboxRoutingTarget): boolean {
  return target.documentKind !== null && isInvoiceKind(target.documentKind);
}

export default function InboxSettingsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<LoadResult>();
  const [form, setForm] = useState<TargetForm>();
  const [formInvalid, setFormInvalid] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [quota, setQuota] = useState('');
  const [quotaInvalid, setQuotaInvalid] = useState(false);
  const [quotaAboveCap, setQuotaAboveCap] = useState(false);

  const loadKey = `${organizationId}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void Promise.all([
      getJson(inboxRoutingTargetsPath(organizationId), controller.signal).then(
        (payload) => inboxRoutingTargetListResponseSchema.parse(payload),
      ),
      getJson(inboxSettingsPath(organizationId), controller.signal).then(
        (payload) => inboxSettingsSchema.parse(payload),
      ),
    ])
      .then(([list, settings]) => {
        setResult({ key: loadKey, value: { settings, targets: list.targets } });
        setQuota(
          settings.blobQuotaBytes === null
            ? ''
            : String(settings.blobQuotaBytes / BYTES_PER_MEGABYTE),
        );
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: loadKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, loadKey]);

  const refresh = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  const loaded = result?.key === loadKey ? result.value : undefined;
  const canManage = access?.capabilities.manageOrganization ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || result?.key !== loadKey));
  const failed =
    organization.state === 'error' ||
    (result?.key === loadKey && result.value === undefined);
  const entityNames = new Map(
    legalEntities.map((entity) => [entity.id, entity.name]),
  );

  async function saveTarget() {
    if (form === undefined) {
      return;
    }
    const parsed = putInboxRoutingTargetRequestSchema.safeParse(
      bodyFromForm(form),
    );
    setFormInvalid(!parsed.success);
    if (!parsed.success) {
      return;
    }
    setWriteFailed(false);
    try {
      await saveInboxRoutingTarget(
        organizationId,
        form.detectedType,
        parsed.data,
      );
      setForm(undefined);
      refresh();
    } catch {
      setWriteFailed(true);
    }
  }

  async function resetTarget(detectedType: string) {
    setWriteFailed(false);
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: inboxRoutingTargetPath(organizationId, detectedType),
      });
      refresh();
    } catch {
      setWriteFailed(true);
    }
  }

  async function saveQuota(blobQuotaBytes: number | null) {
    setWriteFailed(false);
    setQuotaAboveCap(false);
    const outcome = await updateInboxSettings(organizationId, {
      blobQuotaBytes,
    });
    if (outcome.kind === 'above_cap') {
      setQuotaAboveCap(true);
    } else if (outcome.kind === 'failed') {
      setWriteFailed(true);
    } else {
      refresh();
    }
  }

  function submitQuota() {
    const trimmed = quota.trim();
    if (trimmed.length === 0) {
      setQuotaInvalid(false);
      void saveQuota(null);
      return;
    }
    const value = Number(trimmed);
    const valid = Number.isInteger(value) && value > 0;
    setQuotaInvalid(!valid);
    if (valid) {
      void saveQuota(value * BYTES_PER_MEGABYTE);
    }
  }

  const targets = loaded?.targets ?? [];
  const targetByType = new Map(
    targets.map((target) => [target.detectedType, target]),
  );

  const columns: readonly GridColumn[] = [
    { header: t('inboxSettings.columnType'), key: 'detectedType' },
    {
      header: t('inboxSettings.columnDestination'),
      key: 'destination',
      renderCell: (row) => {
        if (row['destination'] === null) {
          return t(inboxRoutingDestinationNoneLabelKey);
        }
        const destination = inboxRoutingDestinationSchema.safeParse(
          row['destination'],
        );
        return destination.success
          ? t(inboxRoutingDestinationLabelKeys[destination.data])
          : null;
      },
    },
    { header: t('inboxSettings.columnKind'), key: 'kind' },
    { header: t('inboxSettings.columnEntity'), key: 'legalEntity' },
    {
      header: t('inboxSettings.columnAuto'),
      key: 'auto',
      // A policy other than never is stored now and consumed by the rules stack that follows.
      renderCell: (row) => {
        const auto = inboxRoutingAutoPolicySchema.safeParse(row['auto']);
        if (!auto.success) {
          return null;
        }
        return (
          <span className={styles.auto!}>
            {t(inboxRoutingAutoLabelKeys[auto.data])}
            {auto.data === 'never' ? null : (
              <Tag size="sm" type="cool-gray">
                {t('inboxSettings.autoRulesNote')}
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      align: 'end',
      header: t('inboxSettings.columnThreshold'),
      key: 'threshold',
    },
    { header: t('inboxSettings.columnAssignee'), key: 'assignee' },
    {
      header: t('inboxSettings.columnSource'),
      key: 'source',
      renderCell: (row) => (
        <Tag
          size="sm"
          type={row['source'] === 'organization' ? 'blue' : 'gray'}
        >
          {t(
            row['source'] === 'organization'
              ? 'inboxSettings.sourceOrganization'
              : 'inboxSettings.sourcePlatform',
          )}
        </Tag>
      ),
    },
    ...(canManage
      ? [
          {
            header: '',
            key: 'actions',
            renderCell: (row: GridRow) => {
              const target = targetByType.get(row.id);
              if (target === undefined) {
                return null;
              }
              return (
                <div className={styles.actions!}>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      setFormInvalid(false);
                      setForm(formFromTarget(target));
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxSettings.edit', { type: target.detectedType })}
                  </Button>
                  {target.source === 'organization' ? (
                    <Button
                      kind="danger--ghost"
                      onClick={() => {
                        void resetTarget(target.detectedType);
                      }}
                      size="sm"
                      type="button"
                    >
                      {t('inboxSettings.reset', { type: target.detectedType })}
                    </Button>
                  ) : null}
                </div>
              );
            },
          } satisfies GridColumn,
        ]
      : []),
  ];

  // Cells stay primitive so the grid can sort them; tags and buttons come from renderCell.
  const rows: readonly GridRow[] = targets.map((target) => ({
    actions: target.detectedType,
    assignee: target.defaultAssigneeId ?? t('inboxSettings.assigneeNone'),
    auto: target.auto,
    destination: target.destination,
    detectedType: target.detectedType,
    id: target.detectedType,
    kind:
      target.documentKind === null
        ? t('inboxSettings.notAvailable')
        : t(documentKindLabelKeys[target.documentKind]),
    legalEntity:
      target.defaultLegalEntityId === null
        ? t('inboxSettings.entityNone')
        : (entityNames.get(target.defaultLegalEntityId) ??
          target.defaultLegalEntityId),
    source: target.source,
    threshold:
      target.autoThreshold === null
        ? t('inboxSettings.notAvailable')
        : String(target.autoThreshold),
  }));

  const editing =
    form === undefined ? undefined : targetByType.get(form.detectedType);
  const capMegabytes =
    loaded === undefined ? '' : megabytes(loaded.settings.platformQuotaBytes);

  return (
    <PageContainer>
      <h1>{t('inboxSettings.title')}</h1>
      {accessState === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxSettings.accessError')}
        />
      ) : null}
      {accessState === 'idle' && !canManage ? (
        <InlineNotification
          kind="info"
          lowContrast
          title={t('inboxSettings.denied')}
        />
      ) : null}
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxSettings.error')}
        />
      ) : null}
      {writeFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxSettings.writeFailed')}
        />
      ) : null}
      {organization.organizations.length > 0 ? (
        <Select
          id="inbox-settings-organization"
          labelText={t('access.organization')}
          onChange={(event) => {
            organization.select(event.target.value);
          }}
          value={organizationId}
        >
          {organization.organizations.map((item) => (
            <SelectItem key={item.id} text={item.name} value={item.id} />
          ))}
        </Select>
      ) : null}
      {loaded === undefined ? null : (
        <Tile>
          <Stack gap={5}>
            <h2 className={styles.sectionHeading!}>
              {t('inboxSettings.quotaTitle')}
            </h2>
            {quotaAboveCap ? (
              <InlineNotification
                kind="error"
                lowContrast
                role="alert"
                title={t('inboxSettings.quotaAboveCap', { cap: capMegabytes })}
              />
            ) : null}
            {canManage ? (
              <Form
                aria-label={t('inboxSettings.quotaTitle')}
                className={styles.quotaForm!}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitQuota();
                }}
              >
                <Stack gap={5}>
                  <TextInput
                    helperText={t('inboxSettings.quotaHelp', {
                      cap: capMegabytes,
                      used: megabytes(loaded.settings.usedBytes),
                    })}
                    id="inbox-settings-quota"
                    inputMode="numeric"
                    invalid={quotaInvalid}
                    invalidText={t('inboxSettings.quotaInvalid')}
                    labelText={t('inboxSettings.quotaLabel')}
                    onChange={(event) => {
                      setQuota(event.target.value);
                    }}
                    value={quota}
                  />
                  <div className={styles.actions!}>
                    <Button kind="primary" size="md" type="submit">
                      {t('inboxSettings.quotaSave')}
                    </Button>
                    <Button
                      disabled={loaded.settings.blobQuotaBytes === null}
                      kind="ghost"
                      onClick={() => {
                        setQuota('');
                        setQuotaInvalid(false);
                        void saveQuota(null);
                      }}
                      size="md"
                      type="button"
                    >
                      {t('inboxSettings.quotaUseDefault')}
                    </Button>
                  </div>
                </Stack>
              </Form>
            ) : (
              <p>
                {t('inboxSettings.quotaLabel')}:{' '}
                {loaded.settings.blobQuotaBytes === null
                  ? t('inboxSettings.sourcePlatform')
                  : megabytes(loaded.settings.blobQuotaBytes)}
                {'. '}
                {t('inboxSettings.quotaHelp', {
                  cap: capMegabytes,
                  used: megabytes(loaded.settings.usedBytes),
                })}
              </p>
            )}
          </Stack>
        </Tile>
      )}
      <DataGrid
        columns={columns}
        description={t('inboxSettings.listDescription')}
        emptyLabel={t('inboxSettings.notAvailable')}
        errorLabel={t('inboxSettings.error')}
        rows={rows}
        search
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
        title={t('inboxSettings.listTitle')}
      />
      {form === undefined || editing === undefined ? null : (
        <Modal
          modalHeading={t('inboxSettings.editTitle', {
            type: form.detectedType,
          })}
          onRequestClose={() => {
            setForm(undefined);
          }}
          onRequestSubmit={() => {
            void saveTarget();
          }}
          open
          primaryButtonText={t('inboxSettings.save')}
          secondaryButtonText={t('inboxSettings.cancel')}
        >
          <Stack gap={5}>
            {formInvalid ? (
              <InlineNotification
                kind="error"
                lowContrast
                role="alert"
                title={t('inboxSettings.targetInvalid')}
              />
            ) : null}
            <Select
              id="inbox-target-destination"
              labelText={t('inboxSettings.destination')}
              onChange={(event) => {
                const parsedDestination =
                  inboxRoutingDestinationSchema.safeParse(event.target.value);
                setForm({
                  ...form,
                  destination: parsedDestination.success
                    ? parsedDestination.data
                    : '',
                });
              }}
              value={form.destination}
            >
              <SelectItem
                text={t(inboxRoutingDestinationNoneLabelKey)}
                value=""
              />
              {inboxRoutingDestinationSchema.options.map((destination) => (
                <SelectItem
                  key={destination}
                  text={t(inboxRoutingDestinationLabelKeys[destination])}
                  value={destination}
                />
              ))}
            </Select>
            <Select
              disabled={form.destination !== 'documents'}
              id="inbox-target-kind"
              labelText={t('inboxSettings.kind')}
              onChange={(event) => {
                setForm({ ...form, documentKind: event.target.value });
              }}
              value={form.documentKind}
            >
              <SelectItem text={t('inboxSettings.notAvailable')} value="" />
              {documentKindSchema.options.map((kind) => (
                <SelectItem
                  key={kind}
                  text={t(documentKindLabelKeys[kind])}
                  value={kind}
                />
              ))}
            </Select>
            <Select
              id="inbox-target-entity"
              labelText={t('inboxSettings.columnEntity')}
              onChange={(event) => {
                setForm({ ...form, legalEntityId: event.target.value });
              }}
              value={form.legalEntityId}
            >
              <SelectItem text={t('inboxSettings.entityNone')} value="" />
              {legalEntities.map((entity) => (
                <SelectItem
                  key={entity.id}
                  text={entity.name}
                  value={entity.id}
                />
              ))}
            </Select>
            <Select
              helperText={
                isInvoiceTarget(editing)
                  ? t('inboxSettings.autoInvoiceHelp')
                  : t('inboxSettings.autoHelp')
              }
              id="inbox-target-auto"
              labelText={t('inboxSettings.columnAuto')}
              onChange={(event) => {
                setForm({
                  ...form,
                  auto: inboxRoutingAutoPolicySchema.parse(event.target.value),
                });
              }}
              value={form.auto}
            >
              {inboxRoutingAutoPolicySchema.options.map((auto) => (
                <SelectItem
                  key={auto}
                  text={t(inboxRoutingAutoLabelKeys[auto])}
                  value={auto}
                />
              ))}
            </Select>
            {form.auto === 'never' ? null : (
              <p>{t('inboxSettings.autoRulesNote')}</p>
            )}
            <TextInput
              id="inbox-target-threshold"
              inputMode="decimal"
              labelText={t('inboxSettings.threshold')}
              onChange={(event) => {
                setForm({ ...form, threshold: event.target.value });
              }}
              value={form.threshold}
            />
            <TextInput
              id="inbox-target-assignee"
              labelText={t('inboxSettings.assignee')}
              onChange={(event) => {
                setForm({ ...form, assigneeId: event.target.value });
              }}
              value={form.assigneeId}
            />
            <TextInput
              helperText={t('inboxSettings.requiredFieldsHelp')}
              id="inbox-target-required-fields"
              labelText={t('inboxSettings.requiredFields')}
              onChange={(event) => {
                setForm({ ...form, requiredFields: event.target.value });
              }}
              value={form.requiredFields}
            />
          </Stack>
        </Modal>
      )}
    </PageContainer>
  );
}
