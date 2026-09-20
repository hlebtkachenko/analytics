'use client';

import {
  Button,
  ComboBox,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@bap/design-system/react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  documentLinkPath,
  documentLinksPath,
  documentPath,
  documentsPath,
  formatAmount,
  sendJson,
  sendWithoutContent,
  withOrganization,
} from '../../../../lib/documents/client';
import {
  documentDetailSchema,
  documentLinkKindSchema,
  documentLinkSchema,
  documentListResponseSchema,
} from '../../../../lib/documents/contract.ts';
import type {
  DocumentDetail,
  DocumentLinkKind,
  DocumentStatus,
  DocumentSummary,
} from '../../../../lib/documents/contract.ts';
import {
  dataIssueLabelKeys,
  documentKindLabelKeys,
  documentLinkKindLabelKeys,
  documentStatusLabelKeys,
  documentStatusTagTypes,
  invoiceLineCategoryLabelKeys,
  invoiceLineKindLabelKeys,
  vatModeLabelKeys,
} from '../../../../lib/documents/labels.ts';
import { inboxBlobDownloadPath } from '../../../../lib/inbox/client';
import { inboxStatusLabelKeys } from '../../../../lib/inbox/labels.ts';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type LoadState = 'error' | 'idle' | 'loading';
type DetailResult = Readonly<{ key: string; value?: DocumentDetail }>;

const statusActions: readonly Readonly<{
  labelKey: string;
  status: DocumentStatus;
}>[] = [
  { labelKey: 'documents.markVerified', status: 'verified' },
  { labelKey: 'documents.markNeedsReview', status: 'needs_review' },
  { labelKey: 'documents.archive', status: 'archived' },
];

export default function DocumentDetailPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const parameters = useParams<{ documentId: string }>();
  const documentId = parameters.documentId;
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access } = useOrganizationAccess(organizationId);
  const canManage = access?.capabilities.manageDocuments ?? false;
  const [result, setResult] = useState<DetailResult>();
  const [statusFailed, setStatusFailed] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkKind, setLinkKind] = useState<DocumentLinkKind>('relates');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [candidates, setCandidates] = useState<DocumentSummary[]>([]);

  // The result carries the read it answered, so a reload never shows another document.
  const detailKey = `${organizationId}:${documentId}`;
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
    void getJson(documentPath(organizationId, documentId), controller.signal)
      .then((payload) => documentDetailSchema.parse(payload))
      .then((payload) => {
        setResult({ key: detailKey, value: payload });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: detailKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [detailKey, documentId, organizationId]);

  useEffect(() => {
    if (organizationId.length === 0 || linkQuery.trim().length === 0) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      page: '1',
      pageSize: '25',
      q: linkQuery.trim(),
    });
    void getJson(documentsPath(organizationId, query), controller.signal)
      .then((payload) => documentListResponseSchema.parse(payload))
      .then((payload) => {
        setCandidates(
          payload.documents.filter((summary) => summary.id !== documentId),
        );
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setCandidates([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [documentId, linkQuery, organizationId]);

  // The write answers with the whole document, so nothing has to be read back.
  async function changeStatus(status: DocumentStatus): Promise<void> {
    try {
      const updated = await sendJson(
        {
          body: { status },
          method: 'PATCH',
          path: documentPath(organizationId, documentId),
        },
        documentDetailSchema,
      );
      setStatusFailed(false);
      setResult({ key: detailKey, value: updated });
      notify({ kind: 'success', title: t('documents.statusUpdated') });
    } catch {
      setStatusFailed(true);
    }
  }

  // A link write answers with the one link it touched, so only the list changes.
  function replaceLinks(
    change: (links: DocumentDetail['links']) => DocumentDetail['links'],
  ): void {
    setResult((current) =>
      current?.value === undefined
        ? current
        : {
            key: current.key,
            value: { ...current.value, links: change(current.value.links) },
          },
    );
  }

  async function addLink(): Promise<void> {
    if (linkTargetId.length === 0) {
      return;
    }

    try {
      const link = await sendJson(
        {
          body: { kind: linkKind, toDocumentId: linkTargetId },
          method: 'POST',
          path: documentLinksPath(organizationId, documentId),
        },
        documentLinkSchema,
      );
      setLinkFailed(false);
      setLinkTargetId('');
      replaceLinks((links) => [...links, link]);
      notify({ kind: 'success', title: t('documents.linkAdded') });
    } catch {
      setLinkFailed(true);
    }
  }

  async function removeLink(linkId: string): Promise<void> {
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: documentLinkPath(organizationId, documentId, linkId),
      });
      setLinkFailed(false);
      replaceLinks((links) => links.filter((link) => link.id !== linkId));
      notify({ kind: 'success', title: t('documents.linkRemoved') });
    } catch {
      setLinkFailed(true);
    }
  }

  if (state === 'error') {
    return (
      <PageContainer>
        <h1>{t('documents.title')}</h1>
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.detailError')}
        />
        <Button href="/documents" kind="tertiary">
          {t('documents.back')}
        </Button>
      </PageContainer>
    );
  }

  if (detail === undefined) {
    return (
      <PageContainer>
        <h1>{t('documents.title')}</h1>
        <p>{t('documents.detailLoading')}</p>
      </PageContainer>
    );
  }

  const document = detail.document;
  const attributes = Object.entries(detail.attributes);
  const openIssues = detail.issues.filter((issue) => issue.resolvedAt === null);

  return (
    <PageContainer>
      <h1>{document.title}</h1>
      {statusFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.statusFailed')}
        />
      ) : null}
      {linkFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('documents.linkFailed')}
        />
      ) : null}
      <section aria-labelledby="document-overview-heading">
        <Stack gap={5}>
          <h2 id="document-overview-heading">{t('documents.overviewTitle')}</h2>
          <p>
            <Tag size="md" type={documentStatusTagTypes[document.status]}>
              {t(documentStatusLabelKeys[document.status])}
            </Tag>
            <Tag size="md" type="outline">
              {t(documentKindLabelKeys[document.kind])}
            </Tag>
          </p>
          <StructuredListWrapper
            aria-label={t('documents.overviewTitle')}
            isCondensed
          >
            <StructuredListBody>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.fieldReference')}
                </StructuredListCell>
                <StructuredListCell>
                  {document.reference ?? t('documents.notAvailable')}
                </StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.fieldDate')}
                </StructuredListCell>
                <StructuredListCell>{document.documentDate}</StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.fieldPartner')}
                </StructuredListCell>
                <StructuredListCell>
                  {document.partnerName ?? t('documents.notAvailable')}
                </StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.columnTotal')}
                </StructuredListCell>
                <StructuredListCell className={styles.amount!}>
                  {document.totalAmount === null
                    ? t('documents.notAvailable')
                    : formatAmount(document.totalAmount, document.currencyCode)}
                </StructuredListCell>
              </StructuredListRow>
            </StructuredListBody>
          </StructuredListWrapper>
          {canManage ? (
            <div className={styles.actions!}>
              {statusActions.map((action) => (
                <Button
                  disabled={document.status === action.status}
                  key={action.status}
                  kind="tertiary"
                  onClick={() => {
                    void changeStatus(action.status);
                  }}
                  size="md"
                  type="button"
                >
                  {t(action.labelKey)}
                </Button>
              ))}
            </div>
          ) : null}
        </Stack>
      </section>
      {openIssues.length > 0 ? (
        <section aria-labelledby="document-issues-heading">
          <Stack gap={5}>
            <h2 id="document-issues-heading">{t('documents.issuesTitle')}</h2>
            {openIssues.map((issue) => (
              <InlineNotification
                key={issue.id}
                kind={issue.severity === 'error' ? 'error' : 'warning'}
                lowContrast
                subtitle={issue.detail ?? ''}
                title={t(dataIssueLabelKeys[issue.code])}
              />
            ))}
          </Stack>
        </section>
      ) : null}
      {detail.invoice === null ? null : (
        <>
          <TableContainer
            className={styles.tableContainer!}
            title={t('documents.invoiceLines')}
          >
            <Table aria-label={t('documents.invoiceLines')} size="sm">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">
                    {t('documents.lineNumber')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineDescription')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineKind')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineCategory')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.linePeriod')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineTaxPointDate')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineActivity')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineBaseAmount')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineVatMode')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('documents.lineVatAmount')}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.invoice.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.lineNo}</TableCell>
                    <TableCell>{line.description}</TableCell>
                    <TableCell>
                      {t(invoiceLineKindLabelKeys[line.lineKind])}
                    </TableCell>
                    <TableCell>
                      {line.category === null
                        ? t('documents.notAvailable')
                        : t(invoiceLineCategoryLabelKeys[line.category])}
                    </TableCell>
                    <TableCell>
                      {line.periodStart === null && line.periodEnd === null
                        ? t('documents.notAvailable')
                        : t('documents.linePeriodRange', {
                            end: line.periodEnd ?? t('documents.notAvailable'),
                            start:
                              line.periodStart ?? t('documents.notAvailable'),
                          })}
                    </TableCell>
                    <TableCell>
                      {line.taxPointDate ?? t('documents.notAvailable')}
                    </TableCell>
                    <TableCell>
                      {line.activityCode ?? t('documents.notAvailable')}
                    </TableCell>
                    <TableCell className={styles.amount!}>
                      {formatAmount(line.baseAmount, document.currencyCode)}
                    </TableCell>
                    <TableCell>{t(vatModeLabelKeys[line.vatMode])}</TableCell>
                    <TableCell className={styles.amount!}>
                      {formatAmount(line.vatAmount, document.currencyCode)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <StructuredListWrapper
            aria-label={t('documents.totalsInvoice')}
            isCondensed
          >
            <StructuredListBody>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.totalGross')}
                </StructuredListCell>
                <StructuredListCell className={styles.amount!}>
                  {formatAmount(
                    detail.invoice.grossTotal,
                    document.currencyCode,
                  )}
                </StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.totalRounding')}
                </StructuredListCell>
                <StructuredListCell className={styles.amount!}>
                  {formatAmount(
                    detail.invoice.roundingAmount,
                    document.currencyCode,
                  )}
                </StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.totalAdvance')}
                </StructuredListCell>
                <StructuredListCell className={styles.amount!}>
                  {formatAmount(
                    detail.invoice.advanceTotal,
                    document.currencyCode,
                  )}
                </StructuredListCell>
              </StructuredListRow>
              <StructuredListRow>
                <StructuredListCell>
                  {t('documents.totalAmountDue')}
                </StructuredListCell>
                <StructuredListCell className={styles.amount!}>
                  {formatAmount(
                    detail.invoice.amountDue,
                    document.currencyCode,
                  )}
                </StructuredListCell>
              </StructuredListRow>
            </StructuredListBody>
          </StructuredListWrapper>
        </>
      )}
      <section aria-labelledby="document-event-heading">
        <Stack gap={5}>
          <h2 id="document-event-heading">{t('documents.eventTitle')}</h2>
          {detail.event === null ? (
            <p>{t('documents.eventNone')}</p>
          ) : (
            <>
              {detail.event.isBalanced ? null : (
                <InlineNotification
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('documents.eventUnbalanced')}
                />
              )}
              <p>
                {t('documents.eventTotals', {
                  credit: formatAmount(
                    detail.event.creditTotal,
                    document.currencyCode,
                  ),
                  debit: formatAmount(
                    detail.event.debitTotal,
                    document.currencyCode,
                  ),
                })}
              </p>
              <TableContainer
                className={styles.tableContainer!}
                title={t('documents.eventTitle')}
              >
                <Table aria-label={t('documents.eventTitle')} size="sm">
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">
                        {t('documents.eventColumnLine')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnAccount')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnEffectiveDate')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnActivity')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnDebit')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnCredit')}
                      </TableHeader>
                      <TableHeader scope="col">
                        {t('documents.eventColumnDescription')}
                      </TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.event.lines.map((line) => (
                      <TableRow key={line.lineNo}>
                        <TableCell>{line.lineNo}</TableCell>
                        <TableCell>
                          {line.accountCode} {line.accountName}
                        </TableCell>
                        <TableCell>{line.effectiveDate}</TableCell>
                        <TableCell>
                          {line.activityCode ?? t('documents.notAvailable')}
                        </TableCell>
                        <TableCell className={styles.amount!}>
                          {line.side === 'debit'
                            ? formatAmount(line.amount, document.currencyCode)
                            : ''}
                        </TableCell>
                        <TableCell className={styles.amount!}>
                          {line.side === 'credit'
                            ? formatAmount(line.amount, document.currencyCode)
                            : ''}
                        </TableCell>
                        <TableCell>
                          {line.description ?? t('documents.notAvailable')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </section>
      <section aria-labelledby="document-originals-heading">
        <Stack gap={5}>
          <h2 id="document-originals-heading">
            {t('documents.originalsTitle')}
          </h2>
          {detail.supersedesDocumentId === null &&
          detail.supersededByDocumentId === null ? null : (
            <InlineNotification
              hideCloseButton
              kind="info"
              lowContrast
              title={t('documents.versionBanner')}
            >
              <Stack gap={3}>
                {detail.supersedesDocumentId === null ? null : (
                  <Link
                    href={documentPath(
                      organizationId,
                      detail.supersedesDocumentId,
                    )}
                  >
                    {t('documents.supersedesLink')}
                  </Link>
                )}
                {detail.supersededByDocumentId === null ? null : (
                  <Link
                    href={documentPath(
                      organizationId,
                      detail.supersededByDocumentId,
                    )}
                  >
                    {t('documents.supersededByLink')}
                  </Link>
                )}
              </Stack>
            </InlineNotification>
          )}
          {detail.files.length === 0 ? (
            <p>{t('documents.originalsNone')}</p>
          ) : (
            <ul aria-label={t('documents.originalsTitle')}>
              {detail.files.map((file) => (
                <li key={file.blobId}>
                  <Link
                    href={inboxBlobDownloadPath(organizationId, file.blobId)}
                  >
                    {file.filename ??
                      t('documents.originalFile', {
                        position: String(file.position),
                      })}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {detail.inboxItems.map((item) => (
            <div className={styles.actions!} key={item.id}>
              <span>
                {t(inboxStatusLabelKeys[item.status])} · {item.receivedAt}
              </span>
              <Link
                href={withOrganization(
                  `/inbox/${encodeURIComponent(item.id)}`,
                  organization.slug,
                )}
              >
                {item.id}
              </Link>
            </div>
          ))}
        </Stack>
      </section>
      <section aria-labelledby="document-links-heading">
        <Stack gap={5}>
          <h2 id="document-links-heading">{t('documents.linksTitle')}</h2>
          {detail.links.length === 0 ? <p>{t('documents.linksNone')}</p> : null}
          {detail.links.map((link) => (
            <div className={styles.actions!} key={link.id}>
              <span>
                {t(documentLinkKindLabelKeys[link.kind])}{' '}
                {link.fromDocumentId === document.id
                  ? link.toDocumentId
                  : link.fromDocumentId}
              </span>
              {canManage ? (
                <Button
                  kind="ghost"
                  onClick={() => {
                    void removeLink(link.id);
                  }}
                  size="sm"
                  type="button"
                >
                  {t('documents.removeLink')}
                </Button>
              ) : null}
            </div>
          ))}
          {canManage ? (
            <>
              <Select
                id="document-link-kind"
                labelText={t('documents.linkKind')}
                onChange={(event) => {
                  const parsed = documentLinkKindSchema.safeParse(
                    event.target.value,
                  );
                  setLinkKind(parsed.success ? parsed.data : 'relates');
                }}
                value={linkKind}
              >
                {documentLinkKindSchema.options.map((option) => (
                  <SelectItem
                    key={option}
                    text={t(documentLinkKindLabelKeys[option])}
                    value={option}
                  />
                ))}
              </Select>
              <ComboBox
                id="document-link-target"
                items={candidates}
                itemToString={(item) => (item === null ? '' : item.title)}
                onChange={(change) => {
                  setLinkTargetId(change.selectedItem?.id ?? '');
                }}
                onInputChange={(value) => {
                  setLinkQuery(value);
                }}
                selectedItem={
                  candidates.find((summary) => summary.id === linkTargetId) ??
                  null
                }
                titleText={t('documents.linkTarget')}
              />
              <Button
                disabled={linkTargetId.length === 0}
                kind="tertiary"
                onClick={() => {
                  void addLink();
                }}
                type="button"
              >
                {t('documents.addLink')}
              </Button>
            </>
          ) : null}
        </Stack>
      </section>
      {attributes.length > 0 ? (
        <section aria-labelledby="document-attributes-heading">
          <Stack gap={5}>
            <h2 id="document-attributes-heading">
              {t('documents.attributesTitle')}
            </h2>
            <StructuredListWrapper
              aria-label={t('documents.attributesTitle')}
              isCondensed
            >
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>
                    {t('documents.attributesTitle')}
                  </StructuredListCell>
                  <StructuredListCell head>
                    {t('documents.columnTitle')}
                  </StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {attributes.map(([key, value]) => (
                  <StructuredListRow key={key}>
                    <StructuredListCell>{key}</StructuredListCell>
                    <StructuredListCell>{value}</StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>
          </Stack>
        </section>
      ) : null}
      <Button href="/documents" kind="tertiary">
        {t('documents.back')}
      </Button>
    </PageContainer>
  );
}
