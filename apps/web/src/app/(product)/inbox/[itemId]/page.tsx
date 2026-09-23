'use client';

import {
  Button,
  Column,
  ComboBox,
  ContainedList,
  ContainedListItem,
  Grid,
  InlineNotification,
  Link,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
} from '@bap/design-system/react';
import type { Route } from 'next';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import OriginalPreview from '../../../../components/documents/original-preview';
import PartnerPicker from '../../../../components/documents/partner-picker';
import ParsedInvoiceSummary, {
  parsedInvoiceOf,
} from '../../../../components/inbox/parsed-invoice-summary';
import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import { StatusIndicator } from '../../../../components/status-indicator';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentsPath,
  optional,
  partnersPath,
  sendJson,
  withOrganization,
} from '../../../../lib/documents/client';
import {
  createDocumentBodySchema,
  documentKindSchema,
  documentListResponseSchema,
  invoiceLineCategorySchema,
  isInvoiceKind,
  partnerSchema,
} from '../../../../lib/documents/contract.ts';
import type {
  DocumentKind,
  DocumentSummary,
  InvoiceLineCategory,
  Partner,
} from '../../../../lib/documents/contract.ts';
import {
  documentKindLabelKeys,
  invoiceLineCategoryLabelKeys,
} from '../../../../lib/documents/labels.ts';
import {
  attachInboxItem,
  inboxBlobDownloadPath,
  inboxItemActionPath,
  inboxItemPath,
  inboxItemsPath,
  routeInboxItemToDocument,
} from '../../../../lib/inbox/client';
import type { InboxItemAction } from '../../../../lib/inbox/client';
import {
  inboxDiscardReasonSchema,
  inboxItemDetailSchema,
  inboxItemListResponseSchema,
  isBlobQuarantined,
  isBlobScanPending,
  routeInboxItemToDocumentRequestSchema,
} from '../../../../lib/inbox/contract.ts';
import type {
  InboxCorrectionField,
  InboxDiscardReason,
  InboxItemDetail,
  InboxItemFile,
  InboxRouteConflict,
  RouteInboxItemToDocumentRequest,
} from '../../../../lib/inbox/contract.ts';
import {
  inboxCorrectionFieldLabelKeys,
  inboxCorrectionSourceLabelKeys,
  inboxDiscardReasonLabelKeys,
  inboxEventKindLabelKeys,
  inboxEventReasonLabelKeys,
  inboxIssueCodeLabelKeys,
  inboxListStatusLabelKeys,
  inboxRoutingDestinationLabelKeys,
  inboxRoutingDestinationNoneLabelKey,
  inboxStatusSeverity,
  inboxTabQuery,
  isInboxTab,
} from '../../../../lib/inbox/labels.ts';
import {
  providerReadFile,
  sectionStatus,
} from '../../../../lib/inbox/section-status.ts';
import type { SectionStatus } from '../../../../lib/inbox/section-status.ts';
import { useMembers } from '../../../../lib/inbox/use-members';
import { formatDateTime } from '../../../../lib/format.ts';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';
type DetailResult = Readonly<{ key: string; value?: InboxItemDetail }>;
type OverflowModal = 'assign' | 'attach' | 'discard' | 'snooze';

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

// A blank value clears the stored one, which is what null means on the wire.
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
  const router = useRouter();
  const parameters = useParams<{ itemId: string }>();
  const itemId = parameters.itemId;
  const searchParams = useSearchParams();
  const tabParameter = searchParams.get('tab');
  const tab = isInboxTab(tabParameter) ? tabParameter : 'toReview';
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access } = useOrganizationAccess(organizationId);
  const canManage = access?.capabilities.manageDocuments ?? false;
  const legalEntities = useLegalEntities(organizationId);
  const members = useMembers(organizationId);
  const [result, setResult] = useState<DetailResult>();
  const [refreshCount, setRefreshCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [draft, setDraft] = useState<DraftFields>();
  // The category every parsed supply line takes; blank leaves it to the partner default.
  const [lineCategory, setLineCategory] = useState('');
  // The default line category of each partner the picker loaded, so the page knows what blank means.
  const [partnerCategories, setPartnerCategories] = useState<
    Readonly<Record<string, InvoiceLineCategory | null>>
  >({});
  const [reasons, setReasons] = useState<
    Partial<Record<InboxCorrectionField, string>>
  >({});
  const [openModal, setOpenModal] = useState<OverflowModal>();
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
  const [selectedBlobId, setSelectedBlobId] = useState('');
  const [neighbours, setNeighbours] = useState<
    Readonly<{ next?: string | undefined; previous?: string | undefined }>
  >({});

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
        setAssigneeId(payload.item.assigneeId ?? '');
        setSnoozedUntil(payload.item.snoozedUntil?.slice(0, 16) ?? '');
        setSelectedBlobId(payload.files[0]?.blobId ?? '');
        setDraft(undefined);
        setLineCategory('');
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

  // The neighbours in the tab the user came from, read once so Prev and Next can walk it.
  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    // The first page of the tab is read to find the neighbours.
    const query = inboxTabQuery(tab);
    query.set('page', '1');
    query.set('pageSize', '100');
    const controller = new AbortController();
    void getJson(inboxItemsPath(organizationId, query), controller.signal)
      .then((payload) => inboxItemListResponseSchema.parse(payload))
      .then((payload) => {
        const index = payload.items.findIndex((entry) => entry.id === itemId);
        if (index === -1) {
          setNeighbours({});
          return;
        }
        setNeighbours({
          next: payload.items[index + 1]?.id,
          previous: payload.items[index - 1]?.id,
        });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setNeighbours({});
        }
      });
    return () => {
      controller.abort();
    };
  }, [itemId, organizationId, tab]);

  // The documents list BFF with a search term, the same picker the attach modal uses for a link.
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

  const files = detail?.files ?? [];
  const selectedFile =
    files.find((file) => file.blobId === selectedBlobId) ?? files[0];

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

  const rememberPartners = useCallback((partners: readonly Partner[]) => {
    setPartnerCategories((current) => ({
      ...current,
      ...Object.fromEntries(
        partners.map((partner) => [partner.id, partner.defaultLineCategory]),
      ),
    }));
  }, []);

  const parsed = detail?.parsed ?? null;
  const parsedInvoice = parsedInvoiceOf(parsed);
  const invoice = fields !== undefined && isInvoiceKind(fields.kind);
  // The Inbox has no line editor, so an invoice kind files only with the parsed invoice content.
  const invoiceBlocked = invoice && parsedInvoice === undefined;
  const needsCategory =
    invoice &&
    parsedInvoice !== undefined &&
    parsedInvoice.lines.some((line) => line.lineKind === 'item');
  // Undefined while the partner is not loaded; null when it has no default.
  const partnerDefault =
    fields === undefined || fields.partnerId.length === 0
      ? null
      : partnerCategories[fields.partnerId];
  const categoryMissing =
    needsCategory && lineCategory.length === 0 && partnerDefault === null;

  async function savePartnerCategory(
    partnerId: string,
    value: string,
  ): Promise<void> {
    const category = invoiceLineCategorySchema.safeParse(value);
    setBusy(true);
    setWriteFailed(false);
    try {
      const partner = await sendJson(
        {
          body: {
            defaultLineCategory: category.success ? category.data : null,
          },
          method: 'PATCH',
          path: `${partnersPath(organizationId)}/${encodeURIComponent(partnerId)}`,
        },
        partnerSchema,
      );
      rememberPartners([partner]);
      notify({ kind: 'success', title: t('inbox.item.partnerCategorySaved') });
    } catch {
      setWriteFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Every action answers with the refreshed detail, so the page rereads it rather than trusting the answer.
  const write = useCallback(
    async (
      action: InboxItemAction,
      body?: unknown,
      method: 'PATCH' | 'POST' = 'POST',
    ): Promise<boolean> => {
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
        setOpenModal(undefined);
        setRefreshCount((count) => count + 1);
        return true;
      } catch {
        setWriteFailed(true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [itemId, organizationId],
  );

  async function routeToDocument(): Promise<void> {
    if (detail === undefined || fields === undefined) {
      return;
    }
    // A parsed row is named by id and the server copies its invoice, total and attributes, so the body never carries them.
    const serverOwned =
      detail.parsed === null ? [] : ['attributes', 'invoice', 'totalAmount'];
    // Only the keys the document request accepts pass through; a provider's own keys, such as a rule's matchedRuleIds, never do.
    const passthrough = Object.fromEntries(
      Object.entries(detail.extraction?.draft ?? {}).filter(
        ([key]) =>
          key in createDocumentBodySchema.shape && !serverOwned.includes(key),
      ),
    );
    const correctionReasons: Partial<Record<InboxCorrectionField, string>> = {};
    for (const key of changedFields) {
      const reason = reasons[correctionFields[key]]?.trim() ?? '';
      if (reason.length > 0) {
        correctionReasons[correctionFields[key]] = reason;
      }
    }
    const body = routeInboxItemToDocumentRequestSchema.safeParse({
      ...(Object.keys(correctionReasons).length === 0
        ? {}
        : { correctionReasons }),
      document: {
        ...passthrough,
        currencyCode: fields.currencyCode,
        documentDate: fields.documentDate,
        kind: fields.kind,
        legalEntityId: fields.legalEntityId,
        partnerId: optional(fields.partnerId),
        reference: optional(fields.reference),
        title: fields.title,
      },
      fileBlobIds: detail.files.map((file) => file.blobId),
      ...(needsCategory && lineCategory.length > 0 ? { lineCategory } : {}),
      ...(detail.parsed === null
        ? {}
        : { parsedExtractionId: detail.parsed.id }),
    });
    if (!body.success || categoryMissing) {
      setDraftInvalid(true);
      return;
    }
    setDraftInvalid(false);
    await submitRoute(body.data);
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
    setBusy(true);
    setWriteFailed(false);
    const outcome = await attachInboxItem(organizationId, itemId, documentId);
    setBusy(false);
    if (outcome.kind === 'attached') {
      setOpenModal(undefined);
      setRefreshCount((count) => count + 1);
      notify({ kind: 'success', title: t('inbox.attached') });
    } else if (outcome.kind === 'not_found') {
      notify({ kind: 'error', title: t('inbox.attachNotFound') });
    } else if (outcome.kind === 'conflict') {
      notify({
        kind: 'error',
        title: t(
          outcome.code === 'not_open'
            ? 'inbox.attachNotOpen'
            : 'inbox.attachAlreadyAttached',
        ),
      });
    } else {
      setWriteFailed(true);
    }
  }

  function documentHref(id: string): string {
    return withOrganization(
      `/documents/${encodeURIComponent(id)}`,
      organization.slug,
    );
  }

  function itemHref(id: string): string {
    const suffix =
      organization.slug.length > 0
        ? `&organization=${encodeURIComponent(organization.slug)}`
        : '';
    return `/inbox/${encodeURIComponent(id)}?tab=${tab}${suffix}`;
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

  const item = detail?.item;
  const open =
    item !== undefined &&
    item.status !== 'routed' &&
    item.status !== 'discarded';

  const entityName = (id: string | null): string | null =>
    id === null
      ? null
      : (legalEntities.find((entity) => entity.id === id)?.name ?? null);

  // The actor of an event or a decision, resolved to a name the reader knows; codes never reach the screen.
  const actorName = useCallback(
    (id: string | null): string => {
      if (id === null) {
        return t('inbox.activity.automation');
      }
      if (id.startsWith('channel_')) {
        return item?.origin === null || item?.origin === undefined
          ? t('inbox.activity.channel')
          : t('inbox.activity.channelOrigin', { origin: item.origin });
      }
      // While the list is loading or a load failed it is undefined, so a neutral name shows, never "former".
      if (members === undefined) {
        return t('inbox.activity.member');
      }
      const member = members.find((entry) => entry.id === id);
      return member?.name ?? t('inbox.activity.formerMember');
    },
    [item, members, t],
  );

  // Keyboard J and K walk the neighbours, but never while a field has focus or a modal is open.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'j' && event.key !== 'k') {
        return;
      }
      if (
        openModal !== undefined ||
        conflict !== undefined ||
        document.body.classList.contains('cds--body--with-modal-open')
      ) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      const target = event.key === 'j' ? neighbours.next : neighbours.previous;
      if (target !== undefined) {
        router.push(itemHref(target) as Route);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  // The one primary verb by status; an invoice without parsed content cannot be filed here, so its File button is disabled.
  function primaryButton(): ReactElement | null {
    if (item === undefined) {
      return null;
    }
    if (item.status === 'routed') {
      return item.documentId === null ? null : (
        <Button href={documentHref(item.documentId)}>
          {t('inbox.openDocument')}
        </Button>
      );
    }
    if (item.status === 'discarded') {
      return (
        <Button
          disabled={busy}
          onClick={() => {
            void write('restore');
          }}
        >
          {t('inbox.restore')}
        </Button>
      );
    }
    if (item.status === 'failed') {
      return (
        <Button
          disabled={busy}
          onClick={() => {
            void write('process');
          }}
        >
          {t('inbox.item.recheck')}
        </Button>
      );
    }
    if (item.status === 'received' || item.status === 'processing') {
      return (
        <Button
          disabled={busy || item.status === 'processing'}
          onClick={() => {
            void write('process');
          }}
        >
          {t('inbox.process')}
        </Button>
      );
    }
    return (
      <Button
        disabled={busy || invoiceBlocked}
        onClick={() => {
          void routeToDocument();
        }}
      >
        {t('inbox.item.fileAsDocument')}
      </Button>
    );
  }

  // The routing target as one sentence, the destination and kind by their labels, never their codes.
  function routingSentence(): string {
    if (detail === undefined) {
      return '';
    }
    const target = detail.routingTarget;
    const destination = t(
      target.destination === null
        ? inboxRoutingDestinationNoneLabelKey
        : inboxRoutingDestinationLabelKeys[target.destination],
    );
    const source = t(
      target.source === 'organization'
        ? 'inbox.routingTargetOrganization'
        : 'inbox.routingTargetPlatform',
    );
    if (target.documentKind === null) {
      return t('inbox.item.checkRouting', { destination, source });
    }
    return t('inbox.item.checkRoutingKind', {
      destination,
      kind: t(documentKindLabelKeys[target.documentKind]),
      source,
    });
  }

  // The sentence that files or discards the item, keyed on how the decision was made; a rule never names a person.
  function decidedSentence(): string {
    if (item === undefined) {
      return '';
    }
    if (item.status === 'discarded') {
      const discardedEvent = [...(detail?.events ?? [])]
        .reverse()
        .find((event) => event.kind === 'discarded');
      const actor = actorName(
        item.decidedByUserId ?? discardedEvent?.actorUserId ?? null,
      );
      const reason =
        discardedEvent?.reason === null || discardedEvent === undefined
          ? null
          : t(inboxEventReasonLabelKeys[discardedEvent.reason]!);
      return reason === null
        ? t('inbox.item.discardedReasonless', { actor })
        : t('inbox.item.discardedBy', { actor, reason });
    }
    const date = filedDate();
    if (item.decidedByKind === 'rule') {
      return t('inbox.item.filedByRule', {
        date,
        name: item.decidedByRuleName ?? t('inbox.activity.automation'),
      });
    }
    if (item.decidedByKind === 'user') {
      return t('inbox.item.filedByUser', {
        date,
        name: actorName(item.decidedByUserId),
      });
    }
    if (item.decidedByKind === 'target_default') {
      return t('inbox.item.filedByDefault', { date });
    }
    if (item.decidedByKind === 'hint') {
      return t('inbox.item.filedByChannel', { date });
    }
    return t('inbox.item.filedAutomatically', { date });
  }

  // A rule auto-filed the item and nothing read the file: spell out the honest derivation.
  function isAutoFiled(): boolean {
    return (
      item?.status === 'routed' &&
      item.decidedByKind === 'rule' &&
      !providerReadFile(detail?.extraction?.provider)
    );
  }

  function autoFiledLines(): string[] {
    if (item === undefined || fields === undefined) {
      return [decidedSentence()];
    }
    const lines: string[] = [
      t('inbox.item.derivedByRule', {
        entity: entityName(fields.legalEntityId) ?? t('inbox.entityNone'),
        kind: t(documentKindLabelKeys[fields.kind]),
        name: item.decidedByRuleName ?? t('inbox.activity.automation'),
      }),
    ];
    const filename = files[0]?.originalFilename;
    if (
      filename !== undefined &&
      filename !== null &&
      fields.title === filename
    ) {
      lines.push(t('inbox.item.derivedTitleFilename'));
    }
    if (fields.documentDate === item.receivedAt.slice(0, 10)) {
      lines.push(t('inbox.item.derivedDateReceived'));
    }
    lines.push(t('inbox.item.derivedNothingRead'));
    return lines;
  }

  // The local date and time the item was filed, from the routed event, else its arrival.
  function filedDate(): string {
    const routed = detail?.events.find((event) => event.kind === 'routed');
    const iso = routed?.createdAt ?? item?.receivedAt;
    return iso === undefined ? '' : formatDateTime(iso);
  }

  // What still needs a person, one plain sentence each; the panel switches voice on this list being empty.
  function problems(): string[] {
    if (detail === undefined || fields === undefined) {
      return [];
    }
    const list: string[] = [];
    if (fields.legalEntityId.length === 0) {
      list.push(t('inbox.item.missingEntity'));
    }
    // The Document section carries a Missing tag on an empty title or date, so the panel names them too.
    if (fields.title.trim().length === 0) {
      list.push(t('inbox.item.addTitle'));
    }
    if (fields.documentDate.trim().length === 0) {
      list.push(t('inbox.item.addDate'));
    }
    if (categoryMissing) {
      list.push(t('inbox.item.chooseLineCategory'));
    }
    if (item?.duplicateOfItemId != null) {
      list.push(t('inbox.item.issueDuplicateExact'));
    }
    for (const issue of detail.extraction?.issues ?? []) {
      if (issue.code === 'reference_conflict') {
        list.push(
          t('inbox.item.issueReferenceConflict', {
            reference: fields.reference.length === 0 ? '' : fields.reference,
          }),
        );
      } else if (issue.code === 'missing_required_field') {
        list.push(t('inbox.item.issueMissingField', { field: issue.message }));
      } else if (issue.code !== 'duplicate_exact') {
        list.push(t(inboxIssueCodeLabelKeys[issue.code]));
      }
    }
    return list;
  }

  // What already holds, listed only when nothing is missing; the passed checks read as sentences.
  function checks(): string[] {
    if (detail === undefined || fields === undefined) {
      return [];
    }
    const list = [routingSentence()];
    if (item?.duplicateOfItemId == null) {
      list.push(t('inbox.item.checkNoDuplicate'));
    }
    const name = entityName(fields.legalEntityId);
    if (name !== null) {
      list.push(t('inbox.item.checkEntity', { name }));
    }
    return list;
  }

  type Panel = Readonly<{
    lines: string[];
    link?: Readonly<{ href: string; text: string }>;
    tone: 'error' | 'info' | 'success' | 'warning';
    title: string;
  }>;

  // The filed panel points at the document by its title or reference, else a plain label.
  function documentLinkText(): string {
    if (fields === undefined) {
      return t('inbox.openDocument');
    }
    if (fields.title.trim().length > 0) {
      return fields.title;
    }
    if (fields.reference.trim().length > 0) {
      return fields.reference;
    }
    return t('inbox.openDocument');
  }

  function panel(): Panel {
    if (item?.status === 'routed') {
      return {
        lines: isAutoFiled() ? autoFiledLines() : [decidedSentence()],
        tone: 'success',
        title: t('inbox.item.filedTitle'),
        ...(item.documentId === null
          ? {}
          : {
              link: {
                href: documentHref(item.documentId),
                text: documentLinkText(),
              },
            }),
      };
    }
    if (item?.status === 'discarded') {
      return {
        lines: [decidedSentence()],
        tone: 'info',
        title: t('inbox.item.discardedTitle'),
      };
    }
    if (invoiceBlocked) {
      return {
        lines: [t('inbox.item.invoiceBody')],
        tone: 'info',
        title: t('inbox.item.invoiceTitle'),
      };
    }
    const open2 = problems();
    if (open2.length === 0) {
      return {
        lines: checks(),
        tone: 'success',
        title: t('inbox.item.readyTitle'),
      };
    }
    return {
      lines: open2,
      tone: 'warning',
      title: t('inbox.item.needsInputTitle'),
    };
  }

  // A provider read the file, a person confirmed the values, or only defaults filled them.
  const providerRead = providerReadFile(detail?.extraction?.provider);
  const humanConfirmed =
    (detail?.corrections.length ?? 0) > 0 ||
    item?.decidedByKind === 'user' ||
    (item?.humanTouched ?? false);
  const whereChanged =
    changedFields.includes('legalEntityId') || changedFields.includes('kind');
  const documentChanged = draftFieldKeys.some(
    (key) =>
      key !== 'legalEntityId' && key !== 'kind' && changedFields.includes(key),
  );

  const whereStatus: SectionStatus = sectionStatus({
    humanConfirmed: humanConfirmed || whereChanged,
    providerRead,
    requiredFilled: fields !== undefined && fields.legalEntityId.length > 0,
  });
  const documentStatus: SectionStatus = sectionStatus({
    humanConfirmed: humanConfirmed || documentChanged,
    providerRead,
    requiredFilled:
      fields !== undefined &&
      fields.title.trim().length > 0 &&
      fields.documentDate.trim().length > 0,
  });

  function sectionTag(status: SectionStatus): ReactElement {
    if (status === 'complete') {
      return (
        <Tag size="sm" type="green">
          {t('inbox.item.tagComplete')}
        </Tag>
      );
    }
    return (
      <Tag size="sm" type="gray">
        {t(
          status === 'missing'
            ? 'inbox.item.tagMissing'
            : 'inbox.item.tagDefaults',
        )}
      </Tag>
    );
  }

  // A changed prefilled field reveals an optional one-line reason that travels as the correction reason.
  function reasonInput(key: keyof DraftFields): ReactElement | null {
    if (!changedFields.includes(key)) {
      return null;
    }
    const field = correctionFields[key];
    return (
      <TextInput
        helperText={t('inbox.correctionReasonHelp')}
        id={`inbox-reason-${field}`}
        labelText={t('inbox.correctionReason', {
          field: t(inboxCorrectionFieldLabelKeys[field]),
        })}
        maxLength={500}
        onChange={(event) => {
          setReasons({ ...reasons, [field]: event.target.value });
        }}
        value={reasons[field] ?? ''}
      />
    );
  }

  // The activity, corrections and events merged newest first, each a sentence with a resolved actor and time.
  type Entry = Readonly<{ id: string; text: string; time: string }>;
  function activityEntries(): Entry[] {
    if (detail === undefined) {
      return [];
    }
    const events: Entry[] = detail.events.map((event) => {
      let text: string;
      if (event.kind === 'rule_matched') {
        text = t('inbox.activity.ruleMatched', {
          rule: item?.decidedByRuleName ?? t('inbox.activity.automation'),
        });
      } else if (event.kind === 'routed') {
        text =
          item?.decidedByKind === 'rule'
            ? t('inbox.activity.routedByRule', {
                rule: item.decidedByRuleName ?? t('inbox.activity.automation'),
              })
            : t('inbox.activity.routedBy', {
                actor: actorName(event.actorUserId),
              });
      } else {
        text = t(inboxEventKindLabelKeys[event.kind]!, {
          actor: actorName(event.actorUserId),
        });
      }
      if (event.reason !== null) {
        text = `${text} (${t(inboxEventReasonLabelKeys[event.reason]!)})`;
      }
      return { id: event.id, text, time: formatDateTime(event.createdAt) };
    });
    const corrections: Entry[] = detail.corrections.map((correction) => ({
      id: correction.id,
      text: `${t('inbox.correctionLine', {
        field: t(inboxCorrectionFieldLabelKeys[correction.field]),
        final: correction.finalValue ?? t('inbox.correctionNone'),
        source: t(inboxCorrectionSourceLabelKeys[correction.source]),
        suggested: correction.suggestedValue ?? t('inbox.correctionNone'),
      })}${correction.reason === null ? '' : ` ${correction.reason}`}`,
      time: formatDateTime(correction.createdAt),
    }));
    return [...events, ...corrections].reverse();
  }

  function receivedLine(): string {
    if (item === undefined) {
      return '';
    }
    const date = formatDateTime(item.receivedAt);
    let source: string;
    if (item.channelKind === 'email') {
      source = t('inbox.item.sourceEmailFrom', {
        sender: item.sender ?? t('inbox.activity.channel'),
      });
    } else if (item.channelKind === 'upload') {
      const received = detail?.events.find(
        (event) => event.kind === 'received',
      );
      source = t('inbox.item.sourceUploadBy', {
        name: actorName(received?.actorUserId ?? null),
      });
    } else {
      source = t('inbox.item.sourceApi', {
        origin: item.origin ?? t('inbox.activity.channel'),
      });
    }
    return t('inbox.item.receivedLine', { date, source });
  }

  function title(): string {
    if (item === undefined) {
      return '';
    }
    const name = files[0]?.originalFilename;
    return name ?? item.sender ?? t('inbox.item.untitled');
  }

  function originalPane(): ReactElement {
    if (selectedFile === undefined) {
      return <p>{t('inbox.item.noOriginal')}</p>;
    }
    if (isBlobScanPending(selectedFile)) {
      return (
        <StatusIndicator label={t('inbox.scanPending')} severity="neutral" />
      );
    }
    if (isBlobQuarantined(selectedFile)) {
      return (
        <InlineNotification
          hideCloseButton
          kind="warning"
          lowContrast
          subtitle={t('inbox.quarantinedHelp')}
          title={t('inbox.quarantined')}
        />
      );
    }
    return (
      <OriginalPreview
        file={{
          blobId: selectedFile.blobId,
          byteSize: selectedFile.byteSize,
          mediaType: selectedFile.mediaType,
          name: selectedFile.originalFilename,
        }}
        frameTitle={t('inbox.previewFrame')}
        noPreviewLabel={t('inbox.noPreview')}
        organizationId={organizationId}
      />
    );
  }

  function fileRow(file: InboxItemFile): ReactElement {
    // A neutral label when the sender named no file; the content hash never reaches the UI.
    const name = file.originalFilename ?? t('inbox.item.unnamedFile');
    // Carbon forbids an interactive element inside a clickable list item, so the download link and the quarantine tag ride in the action slot.
    const action = isBlobScanPending(file) ? (
      <StatusIndicator label={t('inbox.scanPending')} severity="neutral" />
    ) : isBlobQuarantined(file) ? (
      <StatusIndicator label={t('inbox.quarantined')} severity="error" />
    ) : (
      // A short link keeps the action slot narrow; the full name is its accessible name.
      <Link
        aria-label={t('inbox.downloadNamed', { name })}
        href={inboxBlobDownloadPath(organizationId, file.blobId)}
      >
        {t('inbox.download')}
      </Link>
    );
    return (
      <ContainedListItem
        action={action}
        key={file.blobId}
        {...(isBlobQuarantined(file)
          ? {}
          : {
              onClick: () => {
                setSelectedBlobId(file.blobId);
              },
            })}
      >
        <span className={styles.fileName!} title={name}>
          {name}
        </span>
      </ContainedListItem>
    );
  }

  const current = panel();

  return (
    <PageContainer>
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
      {item === undefined || detail === undefined || fields === undefined ? (
        state === 'error' ? null : (
          <p>{t('inbox.loading')}</p>
        )
      ) : (
        <Grid className={styles.columns!}>
          <Column lg={9} md={4} sm={4}>
            <Stack className={styles.centrePane!} gap={5}>
              <div>
                <h1 className={styles.title!}>{title()}</h1>
                <p className={styles.received!}>{receivedLine()}</p>
                <div className={styles.summary!}>
                  <StatusIndicator
                    label={t(inboxListStatusLabelKeys[item.status])}
                    severity={inboxStatusSeverity[item.status]}
                  />
                  {item.sender === null ? null : (
                    <StatusIndicator
                      label={t(
                        item.senderAuthenticated
                          ? 'inbox.senderAuthenticated'
                          : 'inbox.senderUnverified',
                      )}
                      severity={
                        item.senderAuthenticated ? 'success' : 'neutral'
                      }
                    />
                  )}
                  {item.duplicateOfItemId === null ? null : (
                    <Link href={itemHref(item.duplicateOfItemId)}>
                      {t('inbox.duplicateOf')}
                    </Link>
                  )}
                </div>
                {item.hintText === null ? null : (
                  <p className={styles.note!}>
                    {t('inbox.item.noteLine', { text: item.hintText })}
                  </p>
                )}
              </div>

              <Tabs>
                <TabList aria-label={t('inbox.item.tabs')}>
                  <Tab>{t('inbox.item.overviewTab')}</Tab>
                  <Tab>
                    {t('inbox.item.activityTab', {
                      count: detail.events.length + detail.corrections.length,
                    })}
                  </Tab>
                </TabList>
                <TabPanels>
                  <TabPanel>
                    <Stack gap={6}>
                      <Stack gap={3}>
                        <InlineNotification
                          hideCloseButton
                          kind={current.tone}
                          lowContrast
                          title={current.title}
                        >
                          <ul aria-label={current.title}>
                            {current.lines.map((line, index) => (
                              <li key={`${String(index)}-${line}`}>{line}</li>
                            ))}
                          </ul>
                        </InlineNotification>
                        {current.link === undefined ? null : (
                          <Link href={current.link.href}>
                            {current.link.text}
                          </Link>
                        )}
                      </Stack>
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
                      {invoiceBlocked && open ? (
                        <div className={styles.actions!}>
                          <Button
                            kind="secondary"
                            onClick={() => {
                              setOpenModal('attach');
                            }}
                            type="button"
                          >
                            {t('inbox.attachTitle')}
                          </Button>
                        </div>
                      ) : null}
                      {draftInvalid ? (
                        <InlineNotification
                          kind="error"
                          lowContrast
                          role="alert"
                          title={t('inbox.draftInvalid')}
                        />
                      ) : null}

                      <section aria-labelledby="inbox-where-heading">
                        <Stack gap={4}>
                          <div className={styles.sectionHead!}>
                            <h2
                              className={styles.sectionHeading!}
                              id="inbox-where-heading"
                            >
                              {t('inbox.item.whereTitle')}
                            </h2>
                            {sectionTag(whereStatus)}
                          </div>
                          <Select
                            disabled={!canManage || !open}
                            id="inbox-where-entity"
                            labelText={t('inbox.draftEntity')}
                            onChange={(event) => {
                              updateDraft({
                                legalEntityId: event.target.value,
                              });
                            }}
                            // Keep Carbon from titling the control with its value as a native tooltip.
                            title={t('inbox.draftEntity')}
                            value={fields.legalEntityId}
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
                          {reasonInput('legalEntityId')}
                          <Select
                            disabled={!canManage || !open}
                            id="inbox-where-kind"
                            labelText={t('inbox.draftKind')}
                            onChange={(event) => {
                              updateDraft({ kind: asKind(event.target.value) });
                            }}
                            // Keep Carbon from titling the control with its value as a native tooltip.
                            title={t('inbox.draftKind')}
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
                          {reasonInput('kind')}
                        </Stack>
                      </section>

                      <section aria-labelledby="inbox-document-heading">
                        <Stack gap={4}>
                          <div className={styles.sectionHead!}>
                            <h2
                              className={styles.sectionHeading!}
                              id="inbox-document-heading"
                            >
                              {t('inbox.item.documentTitle')}
                            </h2>
                            {sectionTag(documentStatus)}
                          </div>
                          <TextInput
                            disabled={!canManage || !open}
                            id="inbox-document-title"
                            labelText={t('inbox.draftTitleField')}
                            onChange={(event) => {
                              updateDraft({ title: event.target.value });
                            }}
                            value={fields.title}
                          />
                          {reasonInput('title')}
                          <TextInput
                            disabled={!canManage || !open}
                            id="inbox-document-date"
                            labelText={t('inbox.draftDate')}
                            onChange={(event) => {
                              updateDraft({ documentDate: event.target.value });
                            }}
                            placeholder="yyyy-mm-dd"
                            value={fields.documentDate}
                          />
                          {reasonInput('documentDate')}
                          <TextInput
                            disabled={!canManage || !open}
                            id="inbox-document-reference"
                            labelText={t('inbox.draftReference')}
                            onChange={(event) => {
                              updateDraft({ reference: event.target.value });
                            }}
                            value={fields.reference}
                          />
                          {reasonInput('reference')}
                          <TextInput
                            disabled={!canManage || !open}
                            id="inbox-document-currency"
                            labelText={t('inbox.draftCurrency')}
                            onChange={(event) => {
                              updateDraft({ currencyCode: event.target.value });
                            }}
                            value={fields.currencyCode}
                          />
                          {reasonInput('currencyCode')}
                          <PartnerPicker
                            disabled={!canManage || !open}
                            idPrefix="inbox-document"
                            onPartnersLoaded={rememberPartners}
                            onSelect={(partnerId) => {
                              updateDraft({ partnerId });
                            }}
                            organizationId={organizationId}
                            selectedPartnerId={fields.partnerId}
                          />
                          {reasonInput('partnerId')}
                        </Stack>
                      </section>

                      {parsed === null ? null : (
                        <section aria-labelledby="inbox-parsed-heading">
                          <Stack gap={4}>
                            <h2
                              className={styles.sectionHeading!}
                              id="inbox-parsed-heading"
                            >
                              {t('inbox.item.parsedTitle')}
                            </h2>
                            <ParsedInvoiceSummary
                              currencyCode={fields.currencyCode}
                              parsed={parsed}
                            />
                            {needsCategory ? (
                              <Select
                                disabled={!canManage || !open}
                                helperText={t('inbox.item.lineCategoryHelp')}
                                id="inbox-parsed-line-category"
                                labelText={t('inbox.item.lineCategory')}
                                onChange={(event) => {
                                  setLineCategory(event.target.value);
                                }}
                                // Keep Carbon from titling the control with its value as a native tooltip.
                                title={t('inbox.item.lineCategory')}
                                value={lineCategory}
                              >
                                <SelectItem
                                  text={
                                    partnerDefault === null ||
                                    partnerDefault === undefined
                                      ? t('inbox.item.lineCategoryChoose')
                                      : t('inbox.item.lineCategoryPartner', {
                                          category: t(
                                            invoiceLineCategoryLabelKeys[
                                              partnerDefault
                                            ],
                                          ),
                                        })
                                  }
                                  value=""
                                />
                                {invoiceLineCategorySchema.options.map(
                                  (category) => (
                                    <SelectItem
                                      key={category}
                                      text={t(
                                        invoiceLineCategoryLabelKeys[category],
                                      )}
                                      value={category}
                                    />
                                  ),
                                )}
                              </Select>
                            ) : null}
                            {needsCategory &&
                            canManage &&
                            open &&
                            fields.partnerId.length > 0 &&
                            partnerDefault !== undefined ? (
                              <Select
                                disabled={busy}
                                helperText={t('inbox.item.partnerCategoryHelp')}
                                id="inbox-parsed-partner-category"
                                labelText={t('inbox.item.partnerCategory')}
                                onChange={(event) => {
                                  void savePartnerCategory(
                                    fields.partnerId,
                                    event.target.value,
                                  );
                                }}
                                // Keep Carbon from titling the control with its value as a native tooltip.
                                title={t('inbox.item.partnerCategory')}
                                value={partnerDefault ?? ''}
                              >
                                <SelectItem
                                  text={t('inbox.item.partnerCategoryNone')}
                                  value=""
                                />
                                {invoiceLineCategorySchema.options.map(
                                  (category) => (
                                    <SelectItem
                                      key={category}
                                      text={t(
                                        invoiceLineCategoryLabelKeys[category],
                                      )}
                                      value={category}
                                    />
                                  ),
                                )}
                              </Select>
                            ) : null}
                          </Stack>
                        </section>
                      )}
                    </Stack>
                  </TabPanel>
                  <TabPanel>
                    <ContainedList
                      kind="on-page"
                      label={t('inbox.item.activityLabel')}
                      size="sm"
                    >
                      {activityEntries().map((entry) => (
                        <ContainedListItem key={entry.id}>
                          {entry.text}{' '}
                          <span className={styles.eventTime!}>
                            {entry.time}
                          </span>
                        </ContainedListItem>
                      ))}
                    </ContainedList>
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Stack>

            {canManage ? (
              <div className={styles.bottomBar!}>
                <Button
                  disabled={neighbours.previous === undefined}
                  kind="ghost"
                  onClick={() => {
                    if (neighbours.previous !== undefined) {
                      router.push(itemHref(neighbours.previous) as Route);
                    }
                  }}
                  type="button"
                >
                  {t('inbox.item.previous')}
                </Button>
                <Button
                  disabled={neighbours.next === undefined}
                  kind="ghost"
                  onClick={() => {
                    if (neighbours.next !== undefined) {
                      router.push(itemHref(neighbours.next) as Route);
                    }
                  }}
                  type="button"
                >
                  {t('inbox.item.next')}
                </Button>
                <OverflowMenu
                  aria-label={t('inbox.item.moreActions')}
                  iconDescription={t('inbox.item.moreActions')}
                >
                  {open ? (
                    <OverflowMenuItem
                      itemText={t('inbox.discard')}
                      onClick={() => {
                        setOpenModal('discard');
                      }}
                    />
                  ) : null}
                  {open ? (
                    <OverflowMenuItem
                      itemText={t('inbox.snooze')}
                      onClick={() => {
                        setOpenModal('snooze');
                      }}
                    />
                  ) : null}
                  {open ? (
                    <OverflowMenuItem
                      itemText={t('inbox.assign')}
                      onClick={() => {
                        setOpenModal('assign');
                      }}
                    />
                  ) : null}
                  {open ? (
                    <OverflowMenuItem
                      itemText={t('inbox.item.attachAction')}
                      onClick={() => {
                        setOpenModal('attach');
                      }}
                    />
                  ) : null}
                  <OverflowMenuItem
                    href={createRuleHref()}
                    itemText={t('inbox.createRule')}
                  />
                  {item.status === 'failed' ? (
                    <OverflowMenuItem
                      itemText={t('inbox.item.resplit')}
                      onClick={() => {
                        void write('process');
                      }}
                    />
                  ) : null}
                  {open && item.status !== 'failed' ? (
                    <OverflowMenuItem
                      itemText={t('inbox.item.recheck')}
                      onClick={() => {
                        void write('process');
                      }}
                    />
                  ) : null}
                  {item.status === 'routed' ? (
                    <OverflowMenuItem
                      itemText={t('inbox.item.reopen')}
                      onClick={() => {
                        void write('route/undo');
                      }}
                    />
                  ) : null}
                  {item.status === 'discarded' ? (
                    <OverflowMenuItem
                      itemText={t('inbox.restore')}
                      onClick={() => {
                        void write('restore');
                      }}
                    />
                  ) : null}
                  {item.snoozedUntil === null ? null : (
                    <OverflowMenuItem
                      itemText={t('inbox.snoozeClear')}
                      onClick={() => {
                        void write('snooze', { snoozedUntil: null });
                      }}
                    />
                  )}
                </OverflowMenu>
                {primaryButton()}
              </div>
            ) : null}
          </Column>

          <Column lg={7} md={4} sm={4}>
            <Stack gap={5}>
              <h2 className={styles.sectionHeading!}>
                {t('inbox.item.original')}
              </h2>
              {originalPane()}
              <ContainedList kind="on-page" label={t('inbox.files')} size="sm">
                {files.map((file) => fileRow(file))}
              </ContainedList>
            </Stack>
          </Column>
        </Grid>
      )}

      {openModal === 'discard' ? (
        <Modal
          modalHeading={t('inbox.item.discardTitle')}
          onRequestClose={() => {
            setOpenModal(undefined);
          }}
          onRequestSubmit={() => {
            void write('discard', { reason: discardReason });
          }}
          open
          primaryButtonText={t('inbox.discard')}
          secondaryButtonText={t('inbox.cancel')}
        >
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
        </Modal>
      ) : null}

      {openModal === 'snooze' ? (
        <Modal
          modalHeading={t('inbox.item.snoozeTitle')}
          onRequestClose={() => {
            setOpenModal(undefined);
          }}
          onRequestSubmit={() => {
            if (snoozedUntil.length > 0) {
              void write('snooze', {
                snoozedUntil: new Date(snoozedUntil).toISOString(),
              });
            }
          }}
          open
          primaryButtonDisabled={snoozedUntil.length === 0}
          primaryButtonText={t('inbox.snooze')}
          secondaryButtonText={t('inbox.cancel')}
        >
          <TextInput
            id="inbox-snooze-until"
            labelText={t('inbox.snoozedUntil')}
            onChange={(event) => {
              setSnoozedUntil(event.target.value);
            }}
            type="datetime-local"
            value={snoozedUntil}
          />
        </Modal>
      ) : null}

      {openModal === 'assign' ? (
        <Modal
          modalHeading={t('inbox.item.assignTitle')}
          onRequestClose={() => {
            setOpenModal(undefined);
          }}
          onRequestSubmit={() => {
            void write('assign', { assigneeId: nullable(assigneeId) });
          }}
          open
          primaryButtonText={t('inbox.assign')}
          secondaryButtonText={t('inbox.cancel')}
        >
          <Select
            id="inbox-assignee"
            labelText={t('inbox.assignee')}
            onChange={(event) => {
              setAssigneeId(event.target.value);
            }}
            value={assigneeId}
          >
            <SelectItem text={t('inbox.assigneeNone')} value="" />
            {(members ?? []).map((member) => (
              <SelectItem
                key={member.id}
                text={member.name}
                value={member.id}
              />
            ))}
          </Select>
        </Modal>
      ) : null}

      {openModal === 'attach' ? (
        <Modal
          modalHeading={t('inbox.attachTitle')}
          onRequestClose={() => {
            setOpenModal(undefined);
          }}
          onRequestSubmit={() => {
            if (attachTargetId.length > 0) {
              void attachToDocument(attachTargetId);
            }
          }}
          open
          primaryButtonDisabled={attachTargetId.length === 0}
          primaryButtonText={t('inbox.attach')}
          secondaryButtonText={t('inbox.cancel')}
        >
          <Stack gap={5}>
            <p>{t('inbox.attachHelp')}</p>
            <ComboBox
              id="inbox-attach-target"
              items={attachCandidates}
              itemToString={(candidate) => candidate?.title ?? ''}
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
          </Stack>
        </Modal>
      ) : null}

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
                <li className={styles.actions!} key={candidate.id}>
                  <Link href={documentHref(candidate.id)}>
                    {candidate.reference ?? candidate.id}
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
                      void attachToDocument(candidate.id);
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
                    acknowledgeDuplicateOf: conflict.candidates[0]!.id,
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
