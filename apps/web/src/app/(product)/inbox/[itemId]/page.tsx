'use client';

import {
  Button,
  Form,
  InlineNotification,
  Link,
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
import { sendJson, withOrganization } from '../../../../lib/documents/client';
import {
  createDocumentRequestSchema,
  documentKindSchema,
} from '../../../../lib/documents/contract.ts';
import type { DocumentKind } from '../../../../lib/documents/contract.ts';
import { documentKindLabelKeys } from '../../../../lib/documents/labels.ts';
import {
  inboxBlobDownloadPath,
  inboxBlobInlinePath,
  inboxItemActionPath,
  inboxItemPath,
} from '../../../../lib/inbox/client';
import type { InboxItemAction } from '../../../../lib/inbox/client';
import {
  inboxDiscardReasonSchema,
  inboxItemDetailSchema,
  isBlobQuarantined,
  isInlineMediaType,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxDiscardReason,
  InboxItemDetail,
  UpdateInboxHintsRequest,
} from '../../../../lib/inbox/contract.ts';
import {
  inboxDecidedByLabelKeys,
  inboxDiscardReasonLabelKeys,
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

function draftString(draft: Record<string, unknown>, key: string): string {
  const value = draft[key];
  return typeof value === 'string' ? value : '';
}

function asKind(value: string): DocumentKind {
  const parsed = documentKindSchema.safeParse(value);
  return parsed.success ? parsed.data : 'other';
}

function asDiscardReason(value: string): InboxDiscardReason {
  const parsed = inboxDiscardReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : 'irrelevant';
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
  const kind = draft['kind'];
  const parsedKind = documentKindSchema.safeParse(kind);
  const entity =
    draftString(draft, 'legalEntityId') ||
    detail.item.hintLegalEntityId ||
    detail.item.legalEntityId ||
    fallbackEntityId;
  return {
    currencyCode: draftString(draft, 'currencyCode') || 'CZK',
    documentDate: draftString(draft, 'documentDate'),
    kind: parsedKind.success
      ? parsedKind.data
      : asKind(detail.item.hintKind ?? ''),
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
  const [discardReason, setDiscardReason] =
    useState<InboxDiscardReason>('irrelevant');
  const [assigneeId, setAssigneeId] = useState('');
  const [snoozedUntil, setSnoozedUntil] = useState('');

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

  const fields =
    draft ??
    (detail === undefined
      ? undefined
      : draftFields(detail, legalEntities[0]?.id ?? ''));

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
    await write('route/document', {
      document: parsed.data,
      fileBlobIds: detail.files.map((file) => file.blobId),
    });
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
              <Link
                href={withOrganization(
                  `/documents/${encodeURIComponent(item.documentId)}`,
                  organization.slug,
                )}
              >
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
                <div className={styles.actions!}>
                  <Button disabled={busy} type="submit">
                    {t('inbox.routeToDocument')}
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
    </PageContainer>
  );
}
