'use client';

import {
  Accordion,
  AccordionItem,
  Button,
  ContainedList,
  ContainedListItem,
  InlineNotification,
  Modal,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getJson, isAbortError } from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';
import { sendWithoutContent } from '../../../../lib/documents/client';
import { documentKindSchema } from '../../../../lib/documents/contract.ts';
import { documentKindLabelKeys } from '../../../../lib/documents/labels.ts';
import {
  inboxRoutingTargetPath,
  inboxRoutingTargetsPath,
  saveInboxRoutingTarget,
} from '../../../../lib/inbox/client';
import {
  INBOX_DETECTED_TYPES,
  inboxRoutingAutoPolicySchema,
  inboxRoutingDestinationSchema,
  inboxRoutingTargetListResponseSchema,
  putInboxRoutingTargetRequestSchema,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxRoutingAutoPolicy,
  InboxRoutingDestination,
  InboxRoutingTarget,
} from '../../../../lib/inbox/contract.ts';
import {
  inboxRoutingAutoLabelKeys,
  inboxRoutingDestinationLabelKeys,
  inboxRoutingDestinationNoneLabelKey,
} from '../../../../lib/inbox/labels.ts';
import {
  routingSubject,
  routingTargetSentence,
} from '../../../../lib/inbox/routing-sentence.ts';
import type { OrganizationAccessRead } from '../../../../lib/organizations/use-organization-access';
import styles from './routing-defaults.module.scss';

type LoadResult = Readonly<{ key: string; value?: InboxRoutingTarget[] }>;

// The default edit form: confidence is a whole percent, the required fields a comma list.
type TargetForm = Readonly<{
  auto: InboxRoutingAutoPolicy;
  confidence: string;
  destination: InboxRoutingDestination | '';
  detectedType: string;
  documentKind: string;
  legalEntityId: string;
  requiredFields: string;
}>;

function targetFormFrom(target: InboxRoutingTarget): TargetForm {
  return {
    auto: target.auto,
    confidence:
      target.autoThreshold === null
        ? ''
        : String(Math.round(target.autoThreshold * 100)),
    destination: target.destination ?? '',
    detectedType: target.detectedType,
    documentKind: target.documentKind ?? '',
    legalEntityId: target.defaultLegalEntityId ?? '',
    requiredFields: target.requiredFields.join(', '),
  };
}

// A whole number from 0 to 100 becomes a fraction; anything else is no threshold, which the contract refuses.
function thresholdFrom(confidence: string): number | null {
  const trimmed = confidence.trim();
  return /^\d{1,3}$/.test(trimmed) && Number(trimmed) <= 100
    ? Number(trimmed) / 100
    : null;
}

// The target the form describes; the stored assignee, and the stored threshold outside above threshold, pass through unchanged.
function targetFromForm(
  form: TargetForm,
  stored: InboxRoutingTarget,
): InboxRoutingTarget {
  const kind = documentKindSchema.safeParse(form.documentKind);
  return {
    ...stored,
    auto: form.auto,
    autoThreshold:
      form.auto === 'above_threshold'
        ? thresholdFrom(form.confidence)
        : stored.autoThreshold,
    defaultLegalEntityId:
      form.legalEntityId.length === 0 ? null : form.legalEntityId,
    destination: form.destination === '' ? null : form.destination,
    documentKind:
      form.destination === 'documents' && kind.success ? kind.data : null,
    requiredFields: form.requiredFields
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0),
  };
}

// Stored detected-type order, a foreign token last.
function typeOrder(target: InboxRoutingTarget): number {
  const index = (INBOX_DETECTED_TYPES as readonly string[]).indexOf(
    target.detectedType,
  );
  return index === -1 ? INBOX_DETECTED_TYPES.length : index;
}

type RoutingDefaultsProperties = Readonly<{
  accessState: OrganizationAccessRead['state'];
  canManageOrganization: boolean;
  // Undefined until the entity list has loaded, or when it failed.
  entityList: LegalEntity[] | undefined;
  organizationId: string;
}>;

// The routing default per detected type: everyone with the rules page reads it, only an owner changes it.
export default function RoutingDefaults({
  accessState,
  canManageOrganization,
  entityList,
  organizationId,
}: RoutingDefaultsProperties) {
  const { i18n, t } = useTranslation();
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<LoadResult>();
  const [targetForm, setTargetForm] = useState<TargetForm>();
  const [targetFormInvalid, setTargetFormInvalid] = useState(false);
  const [targetWriteFailed, setTargetWriteFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadKey = `${organizationId}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(inboxRoutingTargetsPath(organizationId), controller.signal)
      .then((payload) => inboxRoutingTargetListResponseSchema.parse(payload))
      .then((list) => {
        setResult({ key: loadKey, value: list.targets });
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

  function refresh() {
    setRefreshCount((count) => count + 1);
  }

  const loaded = result?.key === loadKey ? result.value : undefined;
  const failed = result?.key === loadKey && result.value === undefined;
  const legalEntities = entityList ?? [];
  const targets = (loaded ?? []).toSorted(
    (a, b) => typeOrder(a) - typeOrder(b),
  );
  const changedTargets = targets.filter(
    (target) => target.source === 'organization',
  );
  const platformTargets = targets.filter(
    (target) => target.source === 'platform',
  );
  const sentenceContext = {
    entityNames:
      entityList === undefined
        ? undefined
        : new Map(entityList.map((entity) => [entity.id, entity.name])),
    locale: i18n.language,
  };
  const editedTarget =
    targetForm === undefined
      ? undefined
      : targets.find(
          (target) => target.detectedType === targetForm.detectedType,
        );

  async function saveTarget() {
    if (targetForm === undefined || editedTarget === undefined) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- source is dropped because the strict body refuses it
    const { detectedType, source, ...fields } = targetFromForm(
      targetForm,
      editedTarget,
    );
    const parsed = putInboxRoutingTargetRequestSchema.safeParse(fields);
    setTargetFormInvalid(!parsed.success);
    if (!parsed.success) {
      return;
    }
    setTargetWriteFailed(false);
    setBusy(true);
    try {
      await saveInboxRoutingTarget(organizationId, detectedType, parsed.data);
      setTargetForm(undefined);
      refresh();
    } catch {
      setTargetWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function resetTarget(detectedType: string) {
    setTargetWriteFailed(false);
    setBusy(true);
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: inboxRoutingTargetPath(organizationId, detectedType),
      });
      refresh();
    } catch {
      setTargetWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function targetItem(target: InboxRoutingTarget) {
    const subject = routingSubject(target.detectedType, 'mid', t);
    const actions = canManageOrganization ? (
      <div className={styles.actions!}>
        <Button
          aria-label={t('inboxRules.defaults.changeNamed', { subject })}
          disabled={busy}
          kind="ghost"
          onClick={() => {
            setTargetFormInvalid(false);
            setTargetWriteFailed(false);
            setTargetForm(targetFormFrom(target));
          }}
          size="sm"
          type="button"
        >
          {t('inboxRules.defaults.change')}
        </Button>
        {target.source === 'organization' ? (
          <Button
            aria-label={t('inboxRules.defaults.resetNamed', { subject })}
            disabled={busy}
            kind="danger--ghost"
            onClick={() => {
              void resetTarget(target.detectedType);
            }}
            size="sm"
            type="button"
          >
            {t('inboxRules.defaults.reset')}
          </Button>
        ) : null}
      </div>
    ) : null;
    return (
      <ContainedListItem
        key={target.detectedType}
        {...(actions === null ? {} : { action: actions })}
      >
        {routingTargetSentence(target, sentenceContext, t)}
      </ContainedListItem>
    );
  }

  const writeFailedNotification = targetWriteFailed ? (
    <InlineNotification
      kind="error"
      lowContrast
      role="alert"
      title={t('inboxRules.defaults.writeFailed')}
    />
  ) : null;

  return (
    <section
      aria-labelledby="inbox-defaults-heading"
      className={styles.defaults!}
    >
      <h2 className={styles.heading!} id="inbox-defaults-heading">
        {t('inboxRules.defaults.title')}
      </h2>
      <p>{t('inboxRules.defaults.lead')}</p>
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxRules.defaults.error')}
        />
      ) : null}
      {/* An open modal shows a failed save inside itself. */}
      {targetForm === undefined ? writeFailedNotification : null}
      {loaded === undefined ? null : (
        <>
          {accessState === 'idle' && !canManageOrganization ? (
            <p>{t('inboxRules.defaults.ownerOnly')}</p>
          ) : null}
          <ContainedList
            kind="on-page"
            label={t('inboxRules.defaults.changedTitle')}
          >
            {changedTargets.length === 0 ? (
              <ContainedListItem>
                {t('inboxRules.defaults.changedEmpty')}
              </ContainedListItem>
            ) : (
              changedTargets.map((target) => targetItem(target))
            )}
          </ContainedList>
          <Accordion>
            <AccordionItem
              title={t('inboxRules.defaults.platformTitle', {
                total: platformTargets.length,
              })}
            >
              <ContainedList
                kind="on-page"
                label={t('inboxRules.defaults.platformListTitle')}
              >
                {platformTargets.map((target) => targetItem(target))}
              </ContainedList>
            </AccordionItem>
          </Accordion>
        </>
      )}
      {targetForm === undefined || editedTarget === undefined ? null : (
        <Modal
          modalHeading={t('inboxRules.defaults.editTitle')}
          onRequestClose={() => {
            setTargetForm(undefined);
          }}
          onRequestSubmit={() => {
            void saveTarget();
          }}
          open
          primaryButtonDisabled={busy}
          primaryButtonText={t('inboxRules.save')}
          secondaryButtonText={t('inboxRules.cancel')}
        >
          <Stack gap={5}>
            <p aria-live="polite">
              {routingTargetSentence(
                targetFromForm(targetForm, editedTarget),
                sentenceContext,
                t,
              )}
            </p>
            {targetFormInvalid ? (
              <InlineNotification
                kind="error"
                lowContrast
                role="alert"
                title={t('inboxRules.defaults.invalid')}
              />
            ) : null}
            {writeFailedNotification}
            <Select
              id="inbox-default-destination"
              labelText={t('inboxRules.defaults.destination')}
              onChange={(event) => {
                const destination = inboxRoutingDestinationSchema.safeParse(
                  event.target.value,
                );
                setTargetForm({
                  ...targetForm,
                  destination: destination.success ? destination.data : '',
                });
              }}
              value={targetForm.destination}
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
              disabled={targetForm.destination !== 'documents'}
              id="inbox-default-kind"
              labelText={t('inboxRules.defaults.kind')}
              onChange={(event) => {
                setTargetForm({
                  ...targetForm,
                  documentKind: event.target.value,
                });
              }}
              value={targetForm.documentKind}
            >
              <SelectItem text={t('inboxRules.defaults.kindNone')} value="" />
              {documentKindSchema.options.map((kind) => (
                <SelectItem
                  key={kind}
                  text={t(documentKindLabelKeys[kind])}
                  value={kind}
                />
              ))}
            </Select>
            <Select
              id="inbox-default-entity"
              labelText={t('inboxRules.defaults.entity')}
              onChange={(event) => {
                setTargetForm({
                  ...targetForm,
                  legalEntityId: event.target.value,
                });
              }}
              value={targetForm.legalEntityId}
            >
              <SelectItem text={t('inboxRules.defaults.entityNone')} value="" />
              {legalEntities.map((entity) => (
                <SelectItem
                  key={entity.id}
                  text={entity.name}
                  value={entity.id}
                />
              ))}
            </Select>
            <RadioButtonGroup
              legendText={t('inboxRules.defaults.confirmation')}
              name="inbox-default-auto"
              onChange={(value: string | number | undefined) => {
                const auto = inboxRoutingAutoPolicySchema.safeParse(value);
                if (auto.success) {
                  setTargetForm({ ...targetForm, auto: auto.data });
                }
              }}
              orientation="vertical"
              valueSelected={targetForm.auto}
            >
              {inboxRoutingAutoPolicySchema.options.map((auto) => (
                <RadioButton
                  id={`inbox-default-auto-${auto}`}
                  key={auto}
                  labelText={t(inboxRoutingAutoLabelKeys[auto])}
                  value={auto}
                />
              ))}
            </RadioButtonGroup>
            {targetForm.auto === 'above_threshold' ? (
              <TextInput
                helperText={t('inboxRules.defaults.confidenceHelp')}
                id="inbox-default-confidence"
                inputMode="numeric"
                labelText={t('inboxRules.defaults.confidence')}
                onChange={(event) => {
                  setTargetForm({
                    ...targetForm,
                    confidence: event.target.value,
                  });
                }}
                value={targetForm.confidence}
              />
            ) : null}
            <TextInput
              helperText={t('inboxRules.defaults.requiredFieldsHelp')}
              id="inbox-default-required-fields"
              labelText={t('inboxRules.defaults.requiredFields')}
              onChange={(event) => {
                setTargetForm({
                  ...targetForm,
                  requiredFields: event.target.value,
                });
              }}
              value={targetForm.requiredFields}
            />
          </Stack>
        </Modal>
      )}
    </section>
  );
}
