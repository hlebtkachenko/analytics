'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  InlineNotification,
  Modal,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Stack,
  TextInput,
  Toggle,
} from '@bap/design-system/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { StatusIndicator } from '../../../../components/status-indicator';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import { sendJson, sendWithoutContent } from '../../../../lib/documents/client';
import {
  documentKindSchema,
  isInvoiceKind,
} from '../../../../lib/documents/contract.ts';
import { documentKindLabelKeys } from '../../../../lib/documents/labels.ts';
import {
  createInboxRule,
  inboxChannelsPath,
  inboxRuleAdoptPath,
  inboxRulePath,
  inboxRulesPath,
  saveInboxRuleOrder,
  updateInboxRule,
} from '../../../../lib/inbox/client';
import type { RuleWriteOutcome } from '../../../../lib/inbox/client';
import {
  createInboxRuleRequestSchema,
  inboxChannelListResponseSchema,
  inboxDiscardReasonSchema,
  inboxRuleListResponseSchema,
  inboxRuleSchema,
  updateInboxRuleRequestSchema,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxChannel,
  InboxRule,
  InboxRuleRefusalCode,
} from '../../../../lib/inbox/contract.ts';
import { inboxDiscardReasonLabelKeys } from '../../../../lib/inbox/labels.ts';
import { useLegalEntityList } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';
import RoutingDefaults from './routing-defaults';

type Loaded = Readonly<{ channels: InboxChannel[]; rules: InboxRule[] }>;
type LoadResult = Readonly<{ key: string; value?: Loaded }>;

// The modal edits strings only; the contract parses them back on save.
type RuleForm = Readonly<{
  assigneeId: string;
  autoRoute: boolean;
  channelId: string;
  detectedType: string;
  discardReason: string;
  documentKind: string;
  keyword: string;
  legalEntityId: string;
  name: string;
  partnerId: string;
  applyToExisting: boolean;
  // Undefined on a create; the edited rule's id otherwise.
  ruleId?: string;
  senderPattern: string;
}>;

const emptyForm: RuleForm = {
  assigneeId: '',
  autoRoute: false,
  channelId: '',
  detectedType: '',
  discardReason: '',
  documentKind: '',
  keyword: '',
  legalEntityId: '',
  name: '',
  partnerId: '',
  applyToExisting: false,
  senderPattern: '',
};

// The item page hands over what the person decided as query parameters; only the named ones are read.
const prefillKeys = [
  'sender',
  'channelId',
  'detectedType',
  'legalEntityId',
  'kind',
  'partnerId',
  'assigneeId',
  'discardReason',
] as const;

function formFromQuery(query: URLSearchParams): RuleForm | undefined {
  if (!prefillKeys.some((key) => query.has(key))) {
    return undefined;
  }
  const read = (key: (typeof prefillKeys)[number]) => query.get(key) ?? '';
  return {
    ...emptyForm,
    assigneeId: read('assigneeId'),
    channelId: read('channelId'),
    detectedType: read('detectedType'),
    discardReason: read('discardReason'),
    documentKind: read('kind'),
    legalEntityId: read('legalEntityId'),
    partnerId: read('partnerId'),
    senderPattern: read('sender'),
  };
}

function formFromRule(rule: InboxRule): RuleForm {
  return {
    assigneeId: rule.setAssigneeId ?? '',
    autoRoute: rule.autoRoute,
    channelId: rule.channelId ?? '',
    detectedType: rule.detectedType ?? '',
    discardReason: rule.discardReason ?? '',
    documentKind: rule.setDocumentKind ?? '',
    keyword: rule.keyword ?? '',
    legalEntityId: rule.setLegalEntityId ?? '',
    name: rule.name,
    partnerId: rule.setPartnerId ?? '',
    applyToExisting: false,
    ruleId: rule.id,
    senderPattern: rule.senderPattern ?? '',
  };
}

function nullable(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

// Blank strings become nulls; the schema decides whether that is a rule.
function bodyFromForm(form: RuleForm): Record<string, unknown> {
  return {
    autoRoute: form.autoRoute,
    channelId: nullable(form.channelId),
    detectedType: nullable(form.detectedType),
    discardReason: nullable(form.discardReason),
    keyword: nullable(form.keyword),
    name: form.name,
    senderPattern: nullable(form.senderPattern),
    setAssigneeId: nullable(form.assigneeId),
    setDocumentKind: nullable(form.documentKind),
    setLegalEntityId: nullable(form.legalEntityId),
    setPartnerId: nullable(form.partnerId),
  };
}

export default function InboxRulesPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const entityList = useLegalEntityList(organizationId);
  const legalEntities = entityList ?? [];
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<LoadResult>();
  const [form, setForm] = useState<RuleForm | undefined>(() =>
    formFromQuery(searchParams),
  );
  const [formInvalid, setFormInvalid] = useState(false);
  const [refusal, setRefusal] = useState<InboxRuleRefusalCode>();
  const [writeFailed, setWriteFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadKey = `${organizationId}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void Promise.all([
      getJson(inboxRulesPath(organizationId), controller.signal).then(
        (payload) => inboxRuleListResponseSchema.parse(payload),
      ),
      // The channel list is owner-only; a refusal leaves the select with the stored id alone.
      getJson(inboxChannelsPath(organizationId), controller.signal)
        .then((payload) => inboxChannelListResponseSchema.parse(payload))
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            throw error;
          }
          return { channels: [] };
        }),
    ])
      .then(([list, channelList]) => {
        setResult({
          key: loadKey,
          value: { channels: channelList.channels, rules: list.rules },
        });
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
  const canManage = access?.capabilities.manageDocuments ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || result?.key !== loadKey));
  const failed =
    organization.state === 'error' ||
    (result?.key === loadKey && result.value === undefined);
  const rules = loaded?.rules ?? [];
  const channels = loaded?.channels ?? [];
  const entityNames = new Map(
    legalEntities.map((entity) => [entity.id, entity.name]),
  );
  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.name]),
  );
  function settle(outcome: RuleWriteOutcome): boolean {
    if (outcome.kind === 'refused') {
      setRefusal(outcome.code);
      return false;
    }
    if (outcome.kind === 'failed') {
      setWriteFailed(true);
      return false;
    }
    return true;
  }

  async function saveForm() {
    if (form === undefined) {
      return;
    }
    const body = bodyFromForm(form);
    const parsed =
      form.ruleId === undefined
        ? createInboxRuleRequestSchema.safeParse({
            ...body,
            applyToExisting: form.applyToExisting,
          })
        : updateInboxRuleRequestSchema.safeParse(body);
    setFormInvalid(!parsed.success);
    if (!parsed.success) {
      return;
    }
    setWriteFailed(false);
    setRefusal(undefined);
    setBusy(true);
    const outcome =
      form.ruleId === undefined
        ? await createInboxRule(
            organizationId,
            createInboxRuleRequestSchema.parse(parsed.data),
          )
        : await updateInboxRule(
            organizationId,
            form.ruleId,
            updateInboxRuleRequestSchema.parse(parsed.data),
          );
    setBusy(false);
    if (settle(outcome)) {
      setForm(undefined);
      refresh();
    }
  }

  async function setEnabled(rule: InboxRule, enabled: boolean) {
    setWriteFailed(false);
    setRefusal(undefined);
    setBusy(true);
    const outcome = await updateInboxRule(organizationId, rule.id, { enabled });
    setBusy(false);
    if (settle(outcome)) {
      refresh();
    }
  }

  async function remove(rule: InboxRule) {
    setWriteFailed(false);
    setBusy(true);
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: inboxRulePath(organizationId, rule.id),
      });
      refresh();
    } catch {
      setWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function adopt(rule: InboxRule) {
    setWriteFailed(false);
    setBusy(true);
    try {
      await sendJson(
        { method: 'POST', path: inboxRuleAdoptPath(organizationId, rule.id) },
        inboxRuleSchema,
      );
      refresh();
    } catch {
      setWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // A move swaps the rule with its neighbour and puts the whole order, so the deferred unique sees one statement.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rules.length) {
      return;
    }
    const ruleIds = rules.map((rule) => rule.id);
    [ruleIds[index], ruleIds[target]] = [ruleIds[target]!, ruleIds[index]!];
    setWriteFailed(false);
    setBusy(true);
    try {
      await saveInboxRuleOrder(organizationId, { ruleIds });
      refresh();
    } catch {
      setWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function conditionsSummary(rule: InboxRule): string {
    const parts: string[] = [];
    if (rule.channelId !== null) {
      parts.push(
        t('inboxRules.conditionChannel', {
          value: channelNames.get(rule.channelId) ?? rule.channelId,
        }),
      );
    }
    if (rule.senderPattern !== null) {
      parts.push(
        t('inboxRules.conditionSender', { value: rule.senderPattern }),
      );
    }
    if (rule.keyword !== null) {
      parts.push(t('inboxRules.conditionKeyword', { value: rule.keyword }));
    }
    if (rule.detectedType !== null) {
      parts.push(t('inboxRules.conditionType', { value: rule.detectedType }));
    }
    return parts.join(', ');
  }

  function actionsSummary(rule: InboxRule): string {
    if (rule.discardReason !== null) {
      return t('inboxRules.actionDiscard', {
        value: t(inboxDiscardReasonLabelKeys[rule.discardReason]),
      });
    }
    const parts: string[] = [];
    if (rule.setLegalEntityId !== null) {
      parts.push(
        t('inboxRules.actionEntity', {
          value:
            entityNames.get(rule.setLegalEntityId) ?? rule.setLegalEntityId,
        }),
      );
    }
    if (rule.setDocumentKind !== null) {
      parts.push(
        t('inboxRules.actionKind', {
          value: t(documentKindLabelKeys[rule.setDocumentKind]),
        }),
      );
    }
    if (rule.setPartnerId !== null) {
      parts.push(t('inboxRules.actionPartner', { value: rule.setPartnerId }));
    }
    if (rule.setAssigneeId !== null) {
      parts.push(t('inboxRules.actionAssignee', { value: rule.setAssigneeId }));
    }
    if (rule.autoRoute) {
      parts.push(t('inboxRules.actionAutoRoute'));
    }
    return parts.join(', ');
  }

  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const indexById = new Map(rules.map((rule, index) => [rule.id, index]));

  const columns: readonly GridColumn[] = [
    { align: 'end', header: t('inboxRules.columnPriority'), key: 'priority' },
    {
      header: t('inboxRules.columnName'),
      key: 'name',
      renderCell: (row) => {
        const rule = ruleById.get(row.id);
        return (
          <span className={styles.name!}>
            {rule?.name}
            {rule?.paused ? (
              <StatusIndicator
                label={t('inboxRules.paused')}
                severity="warning"
                title={t('inboxRules.pausedHelp')}
              />
            ) : null}
          </span>
        );
      },
    },
    { header: t('inboxRules.columnConditions'), key: 'conditions' },
    { header: t('inboxRules.columnActions'), key: 'actions' },
    { header: t('inboxRules.columnAuto'), key: 'auto' },
    { header: t('inboxRules.columnEnabled'), key: 'enabled' },
    ...(canManage
      ? [
          {
            header: '',
            key: 'controls',
            renderCell: (row: GridRow) => {
              const rule = ruleById.get(row.id);
              const index = indexById.get(row.id);
              if (rule === undefined || index === undefined) {
                return null;
              }
              return (
                <div className={styles.controls!}>
                  <Button
                    disabled={busy || index === 0}
                    kind="ghost"
                    onClick={() => {
                      void move(index, -1);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxRules.moveUp', { name: rule.name })}
                  </Button>
                  <Button
                    disabled={busy || index === rules.length - 1}
                    kind="ghost"
                    onClick={() => {
                      void move(index, 1);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxRules.moveDown', { name: rule.name })}
                  </Button>
                  <Button
                    disabled={busy}
                    kind="ghost"
                    onClick={() => {
                      void setEnabled(rule, !rule.enabled);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t(
                      rule.enabled ? 'inboxRules.disable' : 'inboxRules.enable',
                      {
                        name: rule.name,
                      },
                    )}
                  </Button>
                  <Button
                    disabled={busy}
                    kind="ghost"
                    onClick={() => {
                      setFormInvalid(false);
                      setRefusal(undefined);
                      setForm(formFromRule(rule));
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxRules.edit', { name: rule.name })}
                  </Button>
                  {rule.paused ? (
                    <Button
                      disabled={busy}
                      kind="tertiary"
                      onClick={() => {
                        void adopt(rule);
                      }}
                      size="sm"
                      type="button"
                    >
                      {t('inboxRules.adopt', { name: rule.name })}
                    </Button>
                  ) : null}
                  <Button
                    disabled={busy}
                    kind="danger--ghost"
                    onClick={() => {
                      void remove(rule);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxRules.delete', { name: rule.name })}
                  </Button>
                </div>
              );
            },
          } satisfies GridColumn,
        ]
      : []),
  ];

  // Cells stay primitive so the grid can sort them; tags and buttons come from renderCell.
  const rows: readonly GridRow[] = rules.map((rule) => ({
    actions: actionsSummary(rule),
    auto: t(rule.autoRoute ? 'inboxRules.yes' : 'inboxRules.no'),
    conditions: conditionsSummary(rule),
    controls: rule.id,
    enabled: t(rule.enabled ? 'inboxRules.enabledYes' : 'inboxRules.enabledNo'),
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
  }));

  const invoiceKind =
    form !== undefined &&
    form.documentKind.length > 0 &&
    isInvoiceKind(form.documentKind);

  return (
    <PageContainer>
      <div className={styles.headingRow!}>
        <h1>{t('inboxRules.title')}</h1>
        {canManage ? (
          <Button
            disabled={busy}
            kind="primary"
            onClick={() => {
              setFormInvalid(false);
              setRefusal(undefined);
              setForm(emptyForm);
            }}
            size="md"
            type="button"
          >
            {t('inboxRules.create')}
          </Button>
        ) : null}
      </div>
      {accessState === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxRules.accessError')}
        />
      ) : null}
      {accessState === 'idle' && !canManage ? (
        <InlineNotification
          kind="info"
          lowContrast
          title={t('inboxRules.denied')}
        />
      ) : null}
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxRules.error')}
        />
      ) : null}
      {writeFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxRules.writeFailed')}
        />
      ) : null}
      {refusal === undefined || form !== undefined ? null : (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t(
            refusal === 'rule_limit'
              ? 'inboxRules.refusedRuleLimit'
              : 'inboxRules.refusedNotAvailable',
          )}
        />
      )}
      {organization.organizations.length > 0 ? (
        <Select
          id="inbox-rules-organization"
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
      <DataGrid
        columns={columns}
        description={t('inboxRules.listDescription')}
        emptyLabel={t('inboxRules.empty')}
        errorLabel={t('inboxRules.error')}
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
        title={t('inboxRules.listTitle')}
      />
      <RoutingDefaults
        accessState={accessState}
        canManageOrganization={access?.capabilities.manageOrganization ?? false}
        entityList={entityList}
        organizationId={organizationId}
      />
      {form === undefined ? null : (
        <Modal
          modalHeading={
            form.ruleId === undefined
              ? t('inboxRules.createTitle')
              : t('inboxRules.editTitle', { name: form.name })
          }
          onRequestClose={() => {
            setForm(undefined);
          }}
          onRequestSubmit={() => {
            void saveForm();
          }}
          open
          primaryButtonDisabled={busy}
          primaryButtonText={t('inboxRules.save')}
          secondaryButtonText={t('inboxRules.cancel')}
        >
          <Stack gap={5}>
            {formInvalid ? (
              <InlineNotification
                kind="error"
                lowContrast
                role="alert"
                title={t('inboxRules.ruleInvalid')}
              />
            ) : null}
            {refusal === undefined ? null : (
              <InlineNotification
                kind="error"
                lowContrast
                role="alert"
                title={t(
                  refusal === 'rule_limit'
                    ? 'inboxRules.refusedRuleLimit'
                    : 'inboxRules.refusedNotAvailable',
                )}
              />
            )}
            <TextInput
              id="inbox-rule-name"
              labelText={t('inboxRules.name')}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
              value={form.name}
            />
            <h3>{t('inboxRules.conditionsTitle')}</h3>
            <Select
              id="inbox-rule-channel"
              labelText={t('inboxRules.channel')}
              onChange={(event) => {
                setForm({ ...form, channelId: event.target.value });
              }}
              value={form.channelId}
            >
              <SelectItem text={t('inboxRules.channelAny')} value="" />
              {form.channelId.length > 0 &&
              !channelNames.has(form.channelId) ? (
                <SelectItem text={form.channelId} value={form.channelId} />
              ) : null}
              {channels.map((channel) => (
                <SelectItem
                  key={channel.id}
                  text={channel.name}
                  value={channel.id}
                />
              ))}
            </Select>
            <TextInput
              helperText={t('inboxRules.senderPatternHelp')}
              id="inbox-rule-sender"
              labelText={t('inboxRules.senderPattern')}
              onChange={(event) => {
                setForm({ ...form, senderPattern: event.target.value });
              }}
              value={form.senderPattern}
            />
            <TextInput
              helperText={t('inboxRules.keywordHelp')}
              id="inbox-rule-keyword"
              labelText={t('inboxRules.keyword')}
              onChange={(event) => {
                setForm({ ...form, keyword: event.target.value });
              }}
              value={form.keyword}
            />
            <TextInput
              id="inbox-rule-type"
              labelText={t('inboxRules.detectedType')}
              onChange={(event) => {
                setForm({ ...form, detectedType: event.target.value });
              }}
              placeholder={t('inboxRules.detectedTypeAny')}
              value={form.detectedType}
            />
            <h3>{t('inboxRules.actionsTitle')}</h3>
            <Select
              id="inbox-rule-entity"
              labelText={t('inboxRules.entity')}
              onChange={(event) => {
                setForm({ ...form, legalEntityId: event.target.value });
              }}
              value={form.legalEntityId}
            >
              <SelectItem text={t('inboxRules.entityNone')} value="" />
              {form.legalEntityId.length > 0 &&
              !entityNames.has(form.legalEntityId) ? (
                <SelectItem
                  text={form.legalEntityId}
                  value={form.legalEntityId}
                />
              ) : null}
              {legalEntities.map((entity) => (
                <SelectItem
                  key={entity.id}
                  text={entity.name}
                  value={entity.id}
                />
              ))}
            </Select>
            <Select
              id="inbox-rule-kind"
              labelText={t('inboxRules.documentKind')}
              onChange={(event) => {
                setForm({ ...form, documentKind: event.target.value });
              }}
              value={form.documentKind}
            >
              <SelectItem text={t('inboxRules.documentKindNone')} value="" />
              {documentKindSchema.options.map((kind) => (
                <SelectItem
                  key={kind}
                  text={t(documentKindLabelKeys[kind])}
                  value={kind}
                />
              ))}
            </Select>
            <TextInput
              id="inbox-rule-partner"
              labelText={t('inboxRules.partnerId')}
              onChange={(event) => {
                setForm({ ...form, partnerId: event.target.value });
              }}
              value={form.partnerId}
            />
            <TextInput
              id="inbox-rule-assignee"
              labelText={t('inboxRules.assignee')}
              onChange={(event) => {
                setForm({ ...form, assigneeId: event.target.value });
              }}
              placeholder={t('inboxRules.assigneeNone')}
              value={form.assigneeId}
            />
            <Select
              id="inbox-rule-discard"
              labelText={t('inboxRules.discardReason')}
              onChange={(event) => {
                setForm({ ...form, discardReason: event.target.value });
              }}
              value={form.discardReason}
            >
              <SelectItem text={t('inboxRules.discardReasonNone')} value="" />
              {inboxDiscardReasonSchema.options.map((reason) => (
                <SelectItem
                  key={reason}
                  text={t(inboxDiscardReasonLabelKeys[reason])}
                  value={reason}
                />
              ))}
            </Select>
            <Toggle
              id="inbox-rule-auto"
              labelA={t('inboxRules.no')}
              labelB={t('inboxRules.yes')}
              labelText={t('inboxRules.autoRoute')}
              onToggle={(checked: boolean) => {
                setForm({ ...form, autoRoute: checked });
              }}
              toggled={form.autoRoute}
            />
            <p>
              {invoiceKind
                ? t('inboxRules.autoRouteInvoiceNote')
                : t('inboxRules.autoRouteHelp')}
            </p>
            {form.ruleId === undefined ? (
              <RadioButtonGroup
                legendText={t('inboxRules.scope')}
                name="inbox-rule-scope"
                onChange={(value: string | number | undefined) => {
                  setForm({ ...form, applyToExisting: value === 'rerun' });
                }}
                orientation="vertical"
                valueSelected={form.applyToExisting ? 'rerun' : 'future'}
              >
                <RadioButton
                  id="inbox-rule-scope-future"
                  labelText={t('inboxRules.scopeFuture')}
                  value="future"
                />
                <RadioButton
                  id="inbox-rule-scope-rerun"
                  labelText={t('inboxRules.scopeRerun')}
                  value="rerun"
                />
              </RadioButtonGroup>
            ) : null}
          </Stack>
        </Modal>
      )}
    </PageContainer>
  );
}
