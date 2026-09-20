'use client';

import {
  Button,
  ComboBox,
  Form,
  InlineNotification,
  Link,
  Modal,
  Select,
  SelectItem,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentsPath,
  sendJson,
  withOrganization,
} from '../../../../lib/documents/client';
import {
  createDocumentRequestSchema,
  documentKindSchema,
  documentListResponseSchema,
} from '../../../../lib/documents/contract.ts';
import type {
  DocumentKind,
  DocumentSummary,
} from '../../../../lib/documents/contract.ts';
import { documentKindLabelKeys } from '../../../../lib/documents/labels.ts';
import {
  inboxBlobDownloadPath,
  inboxBlobInlinePath,
  inboxItemActionPath,
  inboxItemPath,
  routeInboxItemToDocument,
} from '../../../../lib/inbox/client';
import type { InboxItemAction } from '../../../../lib/inbox/client';
import {
  inboxDiscardReasonSchema,
  inboxItemDetailSchema,
  isBlobQuarantined,
  isInlineMediaType,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxCorrectionField,
  InboxDiscardReason,
  InboxItemDetail,
  InboxRouteConflict,
  RouteInboxItemToDocumentRequest,
  UpdateInboxHintsRequest,
} from '../../../../lib/inbox/contract.ts';
import {
  inboxCorrectionFieldLabelKeys,
  inboxCorrectionSourceLabelKeys,
  inboxDecidedByLabelKeys,
  inboxDiscardReasonLabelKeys,
  inboxRoutingDestinationLabelKeys,
  inboxRoutingDestinationNoneLabelKey,
  inboxStatusLabelKeys,
  inboxStatusTagTypes,
} from '../../../../lib/inbox/labels.ts';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';
type DetailResult = Readonly<{ key: string; value?: InboxItemDetail }>;

// The draft fields the person can still change; everything else in the draft passes through untouched.
type DraftFields = Readonly<{
  currencyCode: string;
  documentDate: string;
  kind: DocumentKind;
  legalEntityId: string;
  partnerId: string;
  reference: string;
  title: string;
}>;

// The draft field each correction column records; the API compares the same seven.
const correctionFields: Readonly<
  Record<keyof DraftFields, InboxCorrectionField>
> = {
  currencyCode: 'currency_code',
  documentDate: 'document_date',
  kind: 'kind',
  legalEntityId: 'legal_entity_id',
  partnerId: 'partner_id',
  reference: 'reference',
  title: 'title',
};
const draftFieldKeys = Object.keys(correctionFields) as (keyof DraftFields)[];

function draftString(draft: Record<string, unknown>, key: string): string {
  const value = draft[key];
  return typeof value === 'string' ? value : '';
}

function asKind(value: string): DocumentKind {
  const parsed = documentKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'other';
}

// The draft kind: the extraction's, else the kind hint, else the effective routing target's, else other.
function draftKind(detail: InboxItemDetail): DocumentKind {
  const draft = detail.extraction?.draft ?? {};
  const parsedDraft = documentKindSchema.safeParse(draft['kind']);
  if (parsedDraft.success) {
    return parsedDraft.data;
  }
  const parsedHint = documentKindSchema.safeParse(detail.item.hintKind);
  if (parsedHint.success) {
    return parsedHint.data;
  }
  return detail.routingTarget.documentKind ?? 'other';
}

function asDiscardReason(value: string): InboxDiscardReason {
  const parsed = inboxDiscardReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : 'irrelevant';
}

// The lowercased `@domain` suffix of a sender, full address or `Name <address>`; null without an `@`.
function senderDomain(sender: string | null): string | null {
  if (sender === null) {
    return null;
  }
  const at = sender.lastIndexOf('@');
  if (at === -1) {
    return null;
  }
  const domain = sender.slice(at + 1).replace(/>+$/, '');
  return domain.length === 0 ? null : `@${domain.toLowerCase()}`;
}

// A blank field is an absent field; the contract trims whatever is actually sent.
function optional(value: string): string | undefined {
  return value.trim().length === 0 ? undefined : value;
}

// A blank hint clears the stored one, which is what null means on the wire.
function nullable(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

function draftFields(
  detail: InboxItemDetail,
  fallbackEntityId: string,
): DraftFields {
  const draft = detail.extraction?.draft ?? {};
  const entity =
    draftString(draft, 'legalEntityId') ||
    detail.item.hintLegalEntityId ||
    detail.item.legalEntityId ||
    fallbackEntityId;
  return {
    currencyCode: draftString(draft, 'currencyCode') || 'CZK',
    documentDate: draftString(draft, 'documentDate'),
    kind: draftKind(detail),
    legalEntityId: entity,
    partnerId:
      draftString(draft, 'partnerId') || (detail.item.hintPartnerId ?? ''),
    reference: draftString(draft, 'reference'),
    title: draftString(draft, 'title'),
  };
}

export default function InboxItemPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const parameters = useParams<{ itemId: string }>();
  const itemId = parameters.itemId;
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access } = useOrganizationAccess(organizationId);
  const canManage = access?.capabilities.manageDocuments ?? false;
  const legalEntities = useLegalEntities(organizationId);
  const [result, setResult] = useState<DetailResult>();
  const [refreshCount, setRefreshCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [hintText, setHintText] = useState('');
  const [hintKind, setHintKind] = useState('');
  const [hintLegalEntityId, setHintLegalEntityId] = useState('');
  const [hintPartnerId, setHintPartnerId] = useState('');
  const [hintLinkDocumentId, setHintLinkDocumentId] = useState('');
  const [draft, setDraft] = useState<DraftFields>();
  const [reasons, setReasons] = useState<
    Partial<Record<InboxCorrectionField, string>>
  >({});
  const [discardReason, setDiscardReason] =
    useState<InboxDiscardReason>('irrelevant');
  const [assigneeId, setAssigneeId] = useState('');
  const [snoozedUntil, setSnoozedUntil] = useState('');
  // The route the API refused with a named conflict, kept so a choice can resend it with one more field.
  const [pendingRoute, setPendingRoute] =
    useState<RouteInboxItemToDocumentRequest>();
  const [conflict, setConflict] = useState<InboxRouteConflict>();
  const [attachQuery, setAttachQuery] = useState('');
  const [attachTargetId, setAttachTargetId] = useState('');
  const [attachCandidates, setAttachCandidates] = useState<DocumentSummary[]>(
    [],
  );

  // The result carries the read it answered, so a reload never shows another item.
  const detailKey = `${organizationId}:${itemId}:${String(refreshCount)}`;
  const detail = result?.key === detailKey ? result.value : undefined;
  const state: LoadState =
    result?.key !== detailKey
      ? 'loading'
      : result.value === undefined
        ? 'error'
        : 'idle';

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(inboxItemPath(organizationId, itemId), controller.signal)
      .then((payload) => inboxItemDetailSchema.parse(payload))
      .then((payload) => {
        setResult({ key: detailKey, value: payload });
        setHintText(payload.item.hintText ?? '');
        setHintKind(payload.item.hintKind ?? '');
        setHintLegalEntityId(payload.item.hintLegalEntityId ?? '');
        setHintPartnerId(payload.item.hintPartnerId ?? '');
        setHintLinkDocumentId(payload.item.hintLinkDocumentId ?? '');
        setAssigneeId(payload.item.assigneeId ?? '');
        setSnoozedUntil(payload.item.snoozedUntil?.slice(0, 16) ?? '');
        setDraft(undefined);
        setReasons({});
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: detailKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [detailKey, itemId, organizationId]);

  // The documents list BFF with a search term, the same picker the document page uses for a link.
  useEffect(() => {
    if (organizationId.length === 0 || attachQuery.trim().length === 0) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      page: '1',
      pageSize: '25',
      q: attachQuery.trim(),
    });
    void getJson(documentsPath(organizationId, query), controller.signal)
      .then((payload) => documentListResponseSchema.parse(payload))
      .then((payload) => {
        setAttachCandidates(payload.documents);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setAttachCandidates([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [attachQuery, organizationId]);

  const suggested =
    detail === undefined
      ? undefined
      : draftFields(detail, legalEntities[0]?.id ?? '');
  const fields = draft ?? suggested;
  // A field the person changed away from the suggestion gets an optional one-line reason.
  const changedFields =
    fields === undefined || suggested === undefined
      ? []
      : draftFieldKeys.filter((key) => fields[key] !== suggested[key]);

  function updateDraft(patch: Partial<DraftFields>): void {
    if (fields !== undefined) {
      setDraft({ ...fields, ...patch });
    }
  }

  // Every action answers with the refreshed detail, so the page rereads it rather than trusting the answer.
  async function write(
    action: InboxItemAction,
    body?: unknown,
    method: 'PATCH' | 'POST' = 'POST',
  ): Promise<boolean> {
    setBusy(true);
    setWriteFailed(false);
    try {
      await sendJson(
        {
          ...(body === undefined ? {} : { body }),
          method,
          path: inboxItemActionPath(organizationId, itemId, action),
        },
        inboxItemDetailSchema,
      );
      setRefreshCount((count) => count + 1);
      return true;
    } catch {
      setWriteFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveHints(): Promise<void> {
    const body: UpdateInboxHintsRequest = {
      hintKind: nullable(hintKind),
      hintLegalEntityId: nullable(hintLegalEntityId),
      hintLinkDocumentId: nullable(hintLinkDocumentId),
      hintPartnerId: nullable(hintPartnerId),
      hintText: nullable(hintText),
    };
    if (await write('hints', body, 'PATCH')) {
      notify({ kind: 'success', title: t('inbox.hintsSaved') });
    }
  }

  async function routeToDocument(): Promise<void> {
    if (detail === undefined || fields === undefined) {
      return;
    }
    const passthrough = detail.extraction?.draft ?? {};
    const parsed = createDocumentRequestSchema.safeParse({
      ...passthrough,
      currencyCode: fields.currencyCode,
      documentDate: fields.documentDate,
      kind: fields.kind,
      legalEntityId: fields.legalEntityId,
      partnerId: optional(fields.partnerId),
      reference: optional(fields.reference),
      title: fields.title,
    });
    if (!parsed.success) {
      setDraftInvalid(true);
      return;
    }
    setDraftInvalid(false);
    const correctionReasons: Partial<Record<InboxCorrectionField, string>> = {};
    for (const key of changedFields) {
      const reason = reasons[correctionFields[key]]?.trim() ?? '';
      if (reason.length > 0) {
        correctionReasons[correctionFields[key]] = reason;
      }
    }
    await submitRoute({
      ...(Object.keys(correctionReasons).length === 0
        ? {}
        : { correctionReasons }),
      document: parsed.data,
      fileBlobIds: detail.files.map((file) => file.blobId),
    });
  }

  // A 409 names a conflict the person resolves here; every other answer is a route or a failure.
  async function submitRoute(
    body: RouteInboxItemToDocumentRequest,
  ): Promise<void> {
    setBusy(true);
    setWriteFailed(false);
    setConflict(undefined);
    const outcome = await routeInboxItemToDocument(
      organizationId,
      itemId,
      body,
    );
    setBusy(false);
    if (outcome.kind === 'routed') {
      setPendingRoute(undefined);
      setRefreshCount((count) => count + 1);
    } else if (outcome.kind === 'conflict') {
      setPendingRoute(body);
      setConflict(outcome.conflict);
    } else {
      setWriteFailed(true);
    }
  }

  async function attachToDocument(documentId: string): Promise<void> {
    setConflict(undefined);
    if (await write('attach', { documentId })) {
      notify({ kind: 'success', title: t('inbox.attached') });
    }
  }

  function documentHref(id: string): string {
    return withOrganization(
      `/documents/${encodeURIComponent(id)}`,
      organization.slug,
    );
  }

  // The rule page reads these to prefill its create modal from what the person just decided.
  function createRuleHref(): string {
    if (detail === undefined) {
      return '/inbox/rules';
    }
    const decided = detail.item;
    const query = new URLSearchParams();
    const set = (key: string, value: string | null | undefined) => {
      if (value !== null && value !== undefined && value.length > 0) {
        query.set(key, value);
      }
    };
    set('channelId', decided.channelId);
    set('detectedType', decided.detectedType);
    set('sender', senderDomain(decided.sender));
    if (decided.status === 'discarded') {
      const discardedEvent = [...detail.events]
        .reverse()
        .find((event) => event.kind === 'discarded');
      const parsedReason = inboxDiscardReasonSchema.safeParse(
        discardedEvent?.reason,
      );
      set('discardReason', parsedReason.success ? parsedReason.data : null);
    } else {
      set('legalEntityId', decided.legalEntityId);
      set('kind', draftKind(detail));
      set('partnerId', decided.partnerId);
      set('assigneeId', decided.assigneeId);
    }
    const slug = organization.slug;
    if (slug.length > 0) {
      query.set('organization', slug);
    }
    return `/inbox/rules?${query.toString()}`;
  }

  function itemHref(id: string): string {
    return withOrganization(
      `/inbox/${encodeURIComponent(id)}`,
      organization.slug,
    );
  }

  const item = detail?.item;
  const extraction = detail?.extraction ?? null;
  const open =
    item !== undefined &&
    item.status !== 'routed' &&
    item.status !== 'discarded';
  const previewFile = detail?.files.find((file) =>
    isInlineMediaType(file.mediaType),
  );

  return (
    <PageContainer>
      <Link href={withOrganization('/inbox', organization.slug)}>
        {t('inbox.backToInbox')}
      </Link>
      <h1>{t('inbox.detail')}</h1>
      {state === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inbox.itemError')}
        />
      ) : null}
      {writeFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inbox.writeFailed')}
        />
      ) : null}
      {item === undefined || detail === undefined ? null : (
        <Stack gap={6}>
          <div className={styles.summary!}>
            <Tag size="sm" type={inboxStatusTagTypes[item.status]}>
              {t(inboxStatusLabelKeys[item.status])}
            </Tag>
            <span>{item.receivedAt}</span>
            {item.duplicateOfItemId === null ? null : (
              <Link href={itemHref(item.duplicateOfItemId)}>
                {t('inbox.duplicateOf')}
              </Link>
            )}
            {item.documentId === null ? null : (
              <Link href={documentHref(item.documentId)}>
                {t('inbox.openDocument')}
              </Link>
            )}
          </div>

          <section aria-label={t('inbox.preview')}>
            <h2>{t('inbox.preview')}</h2>
            {previewFile === undefined ? (
              <p>{t('inbox.noPreview')}</p>
            ) : isBlobQuarantined(previewFile) ? (
              <InlineNotification
                hideCloseButton
                kind="warning"
                lowContrast
                subtitle={t('inbox.quarantinedHelp')}
                title={t('inbox.quarantined')}
              />
            ) : (
              <iframe
                className={styles.preview!}
                // A sandboxed frame disables plugins, and Chromium's PDF viewer is one, so only images are sandboxed.
                {...(previewFile.mediaType === 'application/pdf'
                  ? {}
                  : { sandbox: '' })}
                src={inboxBlobInlinePath(organizationId, previewFile.blobId)}
                title={t('inbox.previewFrame')}
              />
            )}
          </section>

          <section aria-label={t('inbox.files')}>
            <StructuredListWrapper aria-label={t('inbox.files')}>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>
                    {t('inbox.columnFileName')}
                  </StructuredListCell>
                  <StructuredListCell head>
                    {t('inbox.download')}
                  </StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {detail.files.map((file) => {
                  const name = file.originalFilename ?? file.sha256;
                  return (
                    <StructuredListRow key={file.blobId}>
                      <StructuredListCell>
                        {name} ({file.mediaType}, {String(file.byteSize)} B)
                      </StructuredListCell>
                      <StructuredListCell>
                        {isBlobQuarantined(file) ? (
                          <Tag size="sm" type="red">
                            {t('inbox.quarantined')}
                          </Tag>
                        ) : (
                          <Link
                            href={inboxBlobDownloadPath(
                              organizationId,
                              file.blobId,
                            )}
                          >
                            {t('inbox.downloadNamed', { name })}
                          </Link>
                        )}
                      </StructuredListCell>
                    </StructuredListRow>
                  );
                })}
              </StructuredListBody>
            </StructuredListWrapper>
          </section>

          <section aria-label={t('inbox.explanation')}>
            <h2>{t('inbox.explanation')}</h2>
            <p>
              {t('inbox.routingTarget')}:{' '}
              {t(
                detail.routingTarget.destination === null
                  ? inboxRoutingDestinationNoneLabelKey
                  : inboxRoutingDestinationLabelKeys[
                      detail.routingTarget.destination
                    ],
              )}
              {detail.routingTarget.documentKind === null
                ? ''
                : `, ${t(documentKindLabelKeys[detail.routingTarget.documentKind])}`}{' '}
              (
              {t(
                detail.routingTarget.source === 'organization'
                  ? 'inbox.routingTargetOrganization'
                  : 'inbox.routingTargetPlatform',
              )}
              )
            </p>
            {extraction === null ? (
              <p>{t('inbox.explanationEmpty')}</p>
            ) : (
              <Stack gap={4}>
                <p>
                  {t('inbox.decidedBy')}:{' '}
                  {item.decidedByKind === null
                    ? t('inbox.notAvailable')
                    : t(inboxDecidedByLabelKeys[item.decidedByKind]!)}
                  {'. '}
                  {t('inbox.confidence')}:{' '}
                  {String(Math.round(extraction.confidence * 100))} %{'. '}
                  {t('inbox.detectedType')}:{' '}
                  {extraction.detectedType ?? t('inbox.notAvailable')}
                </p>
                {extraction.reasons.length > 0 ? (
                  <ul aria-label={t('inbox.reasons')}>
                    {extraction.reasons.map((reason, index) => (
                      <li key={`${reason.step}-${String(index)}`}>
                        {t('inbox.reasonSentence', {
                          evidence: reason.evidence,
                          step: reason.step,
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {extraction.issues.map((issue, index) => (
                  <InlineNotification
                    hideCloseButton
                    key={`${issue.code}-${String(index)}`}
                    kind="warning"
                    lowContrast
                    subtitle={issue.message}
                    title={issue.code}
                  />
                ))}
              </Stack>
            )}
            {detail.corrections.length === 0 ? null : (
              <Stack gap={3}>
                <h3>{t('inbox.corrections')}</h3>
                <ul aria-label={t('inbox.corrections')}>
                  {detail.corrections.map((correction, index) => (
                    <li key={`${correction.field}-${String(index)}`}>
                      {t('inbox.correctionLine', {
                        field: t(
                          inboxCorrectionFieldLabelKeys[correction.field],
                        ),
                        final:
                          correction.finalValue ?? t('inbox.correctionNone'),
                        source: t(
                          inboxCorrectionSourceLabelKeys[correction.source],
                        ),
                        suggested:
                          correction.suggestedValue ??
                          t('inbox.correctionNone'),
                      })}
                      {correction.reason === null
                        ? ''
                        : ` ${correction.reason}`}
                    </li>
                  ))}
                </ul>
              </Stack>
            )}
          </section>

          {canManage ? (
            <Form
              aria-label={t('inbox.hintsTitle')}
              onSubmit={(event) => {
                event.preventDefault();
                void saveHints();
              }}
            >
              <Stack gap={5}>
                <h2>{t('inbox.hintsTitle')}</h2>
                <TextArea
                  id="inbox-hint-text"
                  labelText={t('inbox.hintText')}
                  onChange={(event) => {
                    setHintText(event.target.value);
                  }}
                  value={hintText}
                />
                <Select
                  id="inbox-hint-entity"
                  labelText={t('inbox.entity')}
                  onChange={(event) => {
                    setHintLegalEntityId(event.target.value);
                  }}
                  value={hintLegalEntityId}
                >
                  <SelectItem text={t('inbox.entityNone')} value="" />
                  {legalEntities.map((entity) => (
                    <SelectItem
                      key={entity.id}
                      text={entity.name}
                      value={entity.id}
                    />
                  ))}
                </Select>
                <TextInput
                  id="inbox-hint-kind"
                  labelText={t('inbox.hintKind')}
                  onChange={(event) => {
                    setHintKind(event.target.value);
                  }}
                  value={hintKind}
                />
                <TextInput
                  id="inbox-hint-partner"
                  labelText={t('inbox.hintPartnerId')}
                  onChange={(event) => {
                    setHintPartnerId(event.target.value);
                  }}
                  value={hintPartnerId}
                />
                <TextInput
                  id="inbox-hint-link"
                  labelText={t('inbox.hintLinkDocumentId')}
                  onChange={(event) => {
                    setHintLinkDocumentId(event.target.value);
                  }}
                  value={hintLinkDocumentId}
                />
                <div className={styles.actions!}>
                  <Button disabled={busy} kind="secondary" type="submit">
                    {t('inbox.saveHints')}
                  </Button>
                  <Button
                    disabled={busy || !open}
                    onClick={() => {
                      void write('process');
                    }}
                    type="button"
                  >
                    {t('inbox.process')}
                  </Button>
                </div>
              </Stack>
            </Form>
          ) : null}

          {canManage && open && fields !== undefined ? (
            <Form
              aria-label={t('inbox.draftTitle')}
              onSubmit={(event) => {
                event.preventDefault();
                void routeToDocument();
              }}
            >
              <Stack gap={5}>
                <h2>{t('inbox.draftTitle')}</h2>
                {draftInvalid ? (
                  <InlineNotification
                    kind="error"
                    lowContrast
                    role="alert"
                    title={t('inbox.draftInvalid')}
                  />
                ) : null}
                {conflict?.code === 'reference_conflict' &&
                pendingRoute !== undefined ? (
                  <Stack gap={3}>
                    <InlineNotification
                      hideCloseButton
                      kind="warning"
                      lowContrast
                      role="alert"
                      subtitle={t('inbox.referenceConflictHelp')}
                      title={t('inbox.referenceConflict')}
                    />
                    <div className={styles.actions!}>
                      <Link href={documentHref(conflict.documentId)}>
                        {t('inbox.openDocument')}
                      </Link>
                      <Button
                        disabled={busy}
                        kind="secondary"
                        onClick={() => {
                          void submitRoute({
                            ...pendingRoute,
                            supersedesDocumentId: conflict.documentId,
                          });
                        }}
                        type="button"
                      >
                        {t('inbox.registerNewVersion')}
                      </Button>
                    </div>
                  </Stack>
                ) : null}
                <Select
                  id="inbox-draft-entity"
                  labelText={t('inbox.draftEntity')}
                  onChange={(event) => {
                    updateDraft({ legalEntityId: event.target.value });
                  }}
                  value={fields.legalEntityId}
                >
                  {legalEntities.map((entity) => (
                    <SelectItem
                      key={entity.id}
                      text={entity.name}
                      value={entity.id}
                    />
                  ))}
                </Select>
                <Select
                  id="inbox-draft-kind"
                  labelText={t('inbox.draftKind')}
                  onChange={(event) => {
                    updateDraft({ kind: asKind(event.target.value) });
                  }}
                  value={fields.kind}
                >
                  {documentKindSchema.options.map((kind) => (
                    <SelectItem
                      key={kind}
                      text={t(documentKindLabelKeys[kind])}
                      value={kind}
                    />
                  ))}
                </Select>
                <TextInput
                  id="inbox-draft-title"
                  labelText={t('inbox.draftTitleField')}
                  onChange={(event) => {
                    updateDraft({ title: event.target.value });
                  }}
                  value={fields.title}
                />
                <TextInput
                  id="inbox-draft-date"
                  labelText={t('inbox.draftDate')}
                  onChange={(event) => {
                    updateDraft({ documentDate: event.target.value });
                  }}
                  placeholder="yyyy-mm-dd"
                  value={fields.documentDate}
                />
                <TextInput
                  id="inbox-draft-currency"
                  labelText={t('inbox.draftCurrency')}
                  onChange={(event) => {
                    updateDraft({ currencyCode: event.target.value });
                  }}
                  value={fields.currencyCode}
                />
                <TextInput
                  id="inbox-draft-reference"
                  labelText={t('inbox.draftReference')}
                  onChange={(event) => {
                    updateDraft({ reference: event.target.value });
                  }}
                  value={fields.reference}
                />
                <TextInput
                  id="inbox-draft-partner"
                  labelText={t('inbox.draftPartner')}
                  onChange={(event) => {
                    updateDraft({ partnerId: event.target.value });
                  }}
                  value={fields.partnerId}
                />
                {changedFields.map((key) => {
                  const field = correctionFields[key];
                  const label = t(inboxCorrectionFieldLabelKeys[field]);
                  return (
                    <TextInput
                      helperText={t('inbox.correctionReasonHelp')}
                      id={`inbox-draft-reason-${field}`}
                      key={field}
                      labelText={t('inbox.correctionReason', { field: label })}
                      maxLength={500}
                      onChange={(event) => {
                        setReasons({ ...reasons, [field]: event.target.value });
                      }}
                      value={reasons[field] ?? ''}
                    />
                  );
                })}
                <div className={styles.actions!}>
                  <Button disabled={busy} type="submit">
                    {t('inbox.routeToDocument')}
                  </Button>
                </div>
              </Stack>
            </Form>
          ) : null}

          {canManage && open ? (
            <Form
              aria-label={t('inbox.attachTitle')}
              onSubmit={(event) => {
                event.preventDefault();
                void attachToDocument(attachTargetId);
              }}
            >
              <Stack gap={5}>
                <h2>{t('inbox.attachTitle')}</h2>
                <p>{t('inbox.attachHelp')}</p>
                <ComboBox
                  id="inbox-attach-target"
                  items={attachCandidates}
                  itemToString={(candidate) =>
                    candidate === null ? '' : candidate.title
                  }
                  onChange={(change) => {
                    setAttachTargetId(change.selectedItem?.id ?? '');
                  }}
                  onInputChange={(value) => {
                    setAttachQuery(value);
                  }}
                  selectedItem={
                    attachCandidates.find(
                      (candidate) => candidate.id === attachTargetId,
                    ) ?? null
                  }
                  titleText={t('inbox.attachTarget')}
                />
                <div className={styles.actions!}>
                  <Button
                    disabled={busy || attachTargetId.length === 0}
                    kind="secondary"
                    type="submit"
                  >
                    {t('inbox.attach')}
                  </Button>
                </div>
              </Stack>
            </Form>
          ) : null}

          {canManage ? (
            <Tile>
              <Stack gap={5}>
                <div className={styles.actions!}>
                  {item.status === 'routed' ? (
                    <Button
                      disabled={busy}
                      kind="danger--tertiary"
                      onClick={() => {
                        void write('route/undo');
                      }}
                      type="button"
                    >
                      {t('inbox.undoRoute')}
                    </Button>
                  ) : null}
                  {item.status === 'discarded' ? (
                    <Button
                      disabled={busy}
                      kind="secondary"
                      onClick={() => {
                        void write('restore');
                      }}
                      type="button"
                    >
                      {t('inbox.restore')}
                    </Button>
                  ) : null}
                  {open ? null : (
                    <Button
                      href={createRuleHref()}
                      kind="tertiary"
                      title={t('inbox.createRuleHelp')}
                    >
                      {t('inbox.createRule')}
                    </Button>
                  )}
                </div>
                {open ? (
                  <div className={styles.actions!}>
                    <Select
                      id="inbox-discard-reason"
                      labelText={t('inbox.discardReason')}
                      onChange={(event) => {
                        setDiscardReason(asDiscardReason(event.target.value));
                      }}
                      value={discardReason}
                    >
                      {inboxDiscardReasonSchema.options.map((reason) => (
                        <SelectItem
                          key={reason}
                          text={t(inboxDiscardReasonLabelKeys[reason])}
                          value={reason}
                        />
                      ))}
                    </Select>
                    <Button
                      disabled={busy}
                      kind="danger--tertiary"
                      onClick={() => {
                        void write('discard', { reason: discardReason });
                      }}
                      type="button"
                    >
                      {t('inbox.discard')}
                    </Button>
                  </div>
                ) : null}
                <div className={styles.actions!}>
                  <TextInput
                    id="inbox-assignee"
                    labelText={t('inbox.assignee')}
                    onChange={(event) => {
                      setAssigneeId(event.target.value);
                    }}
                    placeholder={t('inbox.assigneePlaceholder')}
                    value={assigneeId}
                  />
                  <Button
                    disabled={busy}
                    kind="tertiary"
                    onClick={() => {
                      void write('assign', {
                        assigneeId: nullable(assigneeId),
                      });
                    }}
                    type="button"
                  >
                    {t('inbox.assign')}
                  </Button>
                </div>
                <div className={styles.actions!}>
                  <TextInput
                    id="inbox-snooze"
                    labelText={t('inbox.snoozedUntil')}
                    onChange={(event) => {
                      setSnoozedUntil(event.target.value);
                    }}
                    type="datetime-local"
                    value={snoozedUntil}
                  />
                  <Button
                    disabled={busy || snoozedUntil.length === 0}
                    kind="tertiary"
                    onClick={() => {
                      void write('snooze', {
                        snoozedUntil: new Date(snoozedUntil).toISOString(),
                      });
                    }}
                    type="button"
                  >
                    {t('inbox.snooze')}
                  </Button>
                  <Button
                    disabled={busy || item.snoozedUntil === null}
                    kind="ghost"
                    onClick={() => {
                      void write('snooze', { snoozedUntil: null });
                    }}
                    type="button"
                  >
                    {t('inbox.snoozeClear')}
                  </Button>
                </div>
              </Stack>
            </Tile>
          ) : null}

          <section aria-label={t('inbox.events')}>
            <h2>{t('inbox.events')}</h2>
            <ul>
              {detail.events.map((event) => (
                <li key={event.id}>
                  {event.createdAt}: {event.kind}
                  {event.reason === null ? '' : ` (${event.reason})`}
                </li>
              ))}
            </ul>
          </section>
        </Stack>
      )}
      {conflict?.code === 'duplicate_probable' && pendingRoute !== undefined ? (
        <Modal
          modalHeading={t('inbox.duplicateProbable')}
          onRequestClose={() => {
            setConflict(undefined);
          }}
          open
          passiveModal
        >
          <Stack gap={5}>
            <p>{t('inbox.duplicateProbableHelp')}</p>
            <ul aria-label={t('inbox.duplicateCandidates')}>
              {conflict.candidates.map((candidate) => (
                <li className={styles.actions!} key={candidate.documentId}>
                  <Link href={documentHref(candidate.documentId)}>
                    {candidate.reference ?? candidate.documentId}
                  </Link>
                  <span>
                    {candidate.documentDate}
                    {candidate.totalAmount === null
                      ? ''
                      : `, ${candidate.totalAmount}`}
                  </span>
                  <Button
                    disabled={busy}
                    kind="tertiary"
                    onClick={() => {
                      void attachToDocument(candidate.documentId);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inbox.attachToCandidate')}
                  </Button>
                </li>
              ))}
            </ul>
            <div className={styles.actions!}>
              <Button
                disabled={busy}
                kind="danger--tertiary"
                onClick={() => {
                  setConflict(undefined);
                  void write('discard', { reason: 'duplicate' });
                }}
                type="button"
              >
                {t('inbox.discardAsDuplicate')}
              </Button>
              <Button
                disabled={busy}
                kind="secondary"
                onClick={() => {
                  // Any listed candidate satisfies the acknowledgement; the first stands for the answer.
                  void submitRoute({
                    ...pendingRoute,
                    acknowledgeDuplicateOf: conflict.candidates[0]!.documentId,
                  });
                }}
                type="button"
              >
                {t('inbox.routeAnyway')}
              </Button>
            </div>
          </Stack>
        </Modal>
      ) : null}
    </PageContainer>
  );
}
