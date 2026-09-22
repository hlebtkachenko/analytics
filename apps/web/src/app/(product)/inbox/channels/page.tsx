'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  CodeSnippet,
  CopyButton,
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
import { StatusIndicator } from '../../../../components/status-indicator';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import { sendJson, sendWithoutContent } from '../../../../lib/documents/client';
import {
  inboxChannelCredentialPath,
  inboxChannelCredentialsPath,
  inboxChannelPath,
  inboxChannelsPath,
  intakeCurlExample,
} from '../../../../lib/inbox/client';
import {
  inboxChannelKindForChannelsSchema,
  inboxChannelListResponseSchema,
  inboxChannelSchema,
  intakeEmailAddressSchema,
  issueInboxChannelCredentialResponseSchema,
  tokenSchema,
} from '../../../../lib/inbox/contract.ts';
import type {
  CreateInboxChannelRequest,
  InboxChannel,
  IssueInboxChannelCredentialResponse,
  UpdateInboxChannelRequest,
} from '../../../../lib/inbox/contract.ts';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import styles from './page.module.scss';

type ListResult = Readonly<{ key: string; value?: InboxChannel[] }>;

type PendingConfirm =
  | Readonly<{ channel: InboxChannel; kind: 'delete' }>
  | Readonly<{
      channel: InboxChannel;
      credentialId: string;
      kind: 'revoke';
      prefix: string;
    }>;

// The issue route answers an address for an email channel and a bearer secret for an api channel.
function issuedAddress(
  issued: IssueInboxChannelCredentialResponse,
): string | null {
  return intakeEmailAddressSchema.safeParse(issued.secret).success
    ? issued.secret
    : null;
}

// The most recent use across a channel's credentials, or nothing when none was ever used.
function lastUsed(channel: InboxChannel): string | null {
  return (
    channel.credentials
      .map((credential) => credential.lastUsedAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

export default function InboxChannelsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const organizationId = organization.organizationId;
  const { access, state: accessState } = useOrganizationAccess(organizationId);
  const legalEntities = useLegalEntities(organizationId);
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<ListResult>();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CreateInboxChannelRequest['kind']>('api');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [hintKind, setHintKind] = useState('');
  const [createFailed, setCreateFailed] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [hintKindInvalid, setHintKindInvalid] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [issueFailed, setIssueFailed] = useState(false);
  const [issued, setIssued] = useState<IssueInboxChannelCredentialResponse>();
  const [confirm, setConfirm] = useState<PendingConfirm>();

  const listKey = `${organizationId}#${String(refreshCount)}`;

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(inboxChannelsPath(organizationId), controller.signal)
      .then((payload) => inboxChannelListResponseSchema.parse(payload))
      .then((payload) => {
        setResult({ key: listKey, value: payload.channels });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: listKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, listKey]);

  const refresh = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  const channels = result?.key === listKey ? result.value : undefined;
  const canManage = access?.capabilities.manageOrganization ?? false;
  const loading =
    organization.state === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || result?.key !== listKey));
  const failed =
    organization.state === 'error' ||
    (result?.key === listKey && result.value === undefined);
  const entityNames = new Map(
    legalEntities.map((entity) => [entity.id, entity.name]),
  );

  async function createChannel() {
    const trimmedName = name.trim();
    const trimmedHint = hintKind.trim();
    // An empty hint is no hint; a non-empty one must be a token, exactly as the API checks it.
    const parsedHint =
      trimmedHint.length === 0 ? null : tokenSchema.safeParse(trimmedHint);
    const hintRejected = parsedHint !== null && !parsedHint.success;
    setNameInvalid(trimmedName.length === 0);
    setHintKindInvalid(hintRejected);
    if (trimmedName.length === 0 || hintRejected) {
      return;
    }
    setCreateFailed(false);
    try {
      await sendJson(
        {
          body: {
            ...(parsedHint === null ? {} : { hintKind: parsedHint.data }),
            kind,
            ...(legalEntityId.length === 0 ? {} : { legalEntityId }),
            name: trimmedName,
          },
          method: 'POST',
          path: inboxChannelsPath(organizationId),
        },
        inboxChannelSchema,
      );
      setName('');
      setKind('api');
      setLegalEntityId('');
      setHintKind('');
      refresh();
    } catch {
      setCreateFailed(true);
    }
  }

  async function updateChannel(
    channel: InboxChannel,
    body: UpdateInboxChannelRequest,
  ) {
    setWriteFailed(false);
    try {
      await sendJson(
        {
          body,
          method: 'PATCH',
          path: inboxChannelPath(organizationId, channel.id),
        },
        inboxChannelSchema,
      );
      refresh();
    } catch {
      setWriteFailed(true);
    }
  }

  async function issueCredential(channel: InboxChannel) {
    setIssueFailed(false);
    try {
      const response = await sendJson(
        {
          method: 'POST',
          path: inboxChannelCredentialsPath(organizationId, channel.id),
        },
        issueInboxChannelCredentialResponseSchema,
      );
      setIssued(response);
      refresh();
    } catch {
      setIssueFailed(true);
    }
  }

  async function revokeCredential(channel: InboxChannel, credentialId: string) {
    setWriteFailed(false);
    try {
      await sendWithoutContent({
        method: 'DELETE',
        path: inboxChannelCredentialPath(
          organizationId,
          channel.id,
          credentialId,
        ),
      });
      refresh();
    } catch {
      setWriteFailed(true);
    }
  }

  function runConfirm() {
    if (confirm === undefined) {
      return;
    }
    const pending = confirm;
    setConfirm(undefined);
    if (pending.kind === 'delete') {
      void updateChannel(pending.channel, { deleted: true, enabled: false });
    } else {
      void revokeCredential(pending.channel, pending.credentialId);
    }
  }

  const columns: readonly GridColumn[] = [
    { header: t('inboxChannels.columnName'), key: 'name' },
    {
      header: t('inboxChannels.columnEnabled'),
      key: 'enabled',
      renderCell: (row) => (
        <StatusIndicator
          label={t(
            row['enabled'] === 'yes'
              ? 'inboxChannels.enabled'
              : 'inboxChannels.disabled',
          )}
          severity={row['enabled'] === 'yes' ? 'success' : 'neutral'}
        />
      ),
    },
    {
      header: t('inboxChannels.columnKind'),
      key: 'kind',
      renderCell: (row) => (
        <Tag size="sm" type={row['kind'] === 'email' ? 'purple' : 'blue'}>
          {t(
            row['kind'] === 'email'
              ? 'inboxChannels.kindEmail'
              : 'inboxChannels.kindApi',
          )}
        </Tag>
      ),
    },
    { header: t('inboxChannels.columnEntity'), key: 'legalEntity' },
    { header: t('inboxChannels.columnHintKind'), key: 'hintKind' },
    { align: 'end', header: t('inboxChannels.columnItems'), key: 'items' },
    {
      header: t('inboxChannels.columnCredentials'),
      key: 'credentials',
      // An address is plain on the row, so it can be copied here; a prefix identifies a secret only.
      renderCell: (row) =>
        row['kind'] === 'email' && row['address'] !== '' ? (
          <span className={styles.address!}>
            <span>{row['credentials']}</span>
            <CopyButton
              align="top"
              feedback={t('inboxChannels.copied')}
              iconDescription={t('inboxChannels.copyAddress')}
              onClick={() => {
                void navigator.clipboard.writeText(String(row['address']));
              }}
            />
          </span>
        ) : (
          row['credentials']
        ),
    },
    { header: t('inboxChannels.columnLastUsed'), key: 'lastUsed' },
    ...(canManage
      ? [
          {
            header: '',
            key: 'actions',
            renderCell: (row: GridRow) => {
              const channel = (channels ?? []).find(
                (candidate) => candidate.id === row.id,
              );
              if (channel === undefined) {
                return null;
              }
              return (
                <div className={styles.actions!}>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      void updateChannel(channel, {
                        enabled: !channel.enabled,
                      });
                    }}
                    size="sm"
                    type="button"
                  >
                    {t(
                      channel.enabled
                        ? 'inboxChannels.disable'
                        : 'inboxChannels.enable',
                    )}
                  </Button>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      void issueCredential(channel);
                    }}
                    size="sm"
                    type="button"
                  >
                    {t(
                      channel.kind === 'email'
                        ? 'inboxChannels.issueAddress'
                        : 'inboxChannels.issueCredential',
                    )}
                  </Button>
                  {channel.credentials.map((credential) => (
                    <Button
                      key={credential.credentialId}
                      kind="ghost"
                      onClick={() => {
                        setConfirm({
                          channel,
                          credentialId: credential.credentialId,
                          kind: 'revoke',
                          prefix: credential.displayPrefix,
                        });
                      }}
                      size="sm"
                      type="button"
                    >
                      {t(
                        channel.kind === 'email'
                          ? 'inboxChannels.revokeAddress'
                          : 'inboxChannels.revoke',
                        { prefix: credential.displayPrefix },
                      )}
                    </Button>
                  ))}
                  <Button
                    kind="danger--ghost"
                    onClick={() => {
                      setConfirm({ channel, kind: 'delete' });
                    }}
                    size="sm"
                    type="button"
                  >
                    {t('inboxChannels.delete')}
                  </Button>
                </div>
              );
            },
          } satisfies GridColumn,
        ]
      : []),
  ];

  // Cells stay primitive so the grid can sort and search them; tags and buttons come from renderCell.
  const rows: readonly GridRow[] = (channels ?? []).map((channel) => ({
    actions: channel.id,
    address: channel.emailAddress ?? '',
    credentials:
      channel.emailAddress !== null
        ? channel.emailAddress
        : channel.credentials.length === 0
          ? t('inboxChannels.credentialsNone')
          : channel.credentials
              .map((credential) => credential.displayPrefix)
              .join(', '),
    enabled: channel.enabled ? 'yes' : 'no',
    hintKind: channel.hintKind ?? t('inboxChannels.hintKindNone'),
    id: channel.id,
    items: channel.itemCount,
    kind: channel.kind,
    lastUsed: lastUsed(channel) ?? t('inboxChannels.notAvailable'),
    legalEntity:
      channel.legalEntityId === null
        ? t('inboxChannels.entityAny')
        : (entityNames.get(channel.legalEntityId) ?? channel.legalEntityId),
    name: channel.name,
  }));

  const publicOrigin =
    typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <PageContainer>
      <h1>{t('inboxChannels.title')}</h1>
      {accessState === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxChannels.accessError')}
        />
      ) : null}
      {accessState === 'idle' && !canManage ? (
        <InlineNotification
          kind="warning"
          lowContrast
          title={t('inboxChannels.denied')}
        />
      ) : null}
      {failed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxChannels.error')}
        />
      ) : null}
      {writeFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxChannels.writeFailed')}
        />
      ) : null}
      {issueFailed ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          title={t('inboxChannels.issueFailed')}
        />
      ) : null}
      {organization.organizations.length > 0 ? (
        <Select
          id="inbox-channels-organization"
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
      {canManage ? (
        <Tile>
          <Form
            aria-label={t('inboxChannels.createTitle')}
            className={styles.createForm!}
            onSubmit={(event) => {
              event.preventDefault();
              void createChannel();
            }}
          >
            <Stack gap={5}>
              <h2 className={styles.sectionHeading!}>
                {t('inboxChannels.createTitle')}
              </h2>
              {createFailed ? (
                <InlineNotification
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('inboxChannels.createFailed')}
                />
              ) : null}
              <TextInput
                id="inbox-channel-name"
                invalid={nameInvalid}
                invalidText={t('inboxChannels.nameRequired')}
                labelText={t('inboxChannels.name')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
              <Select
                id="inbox-channel-kind"
                helperText={t(
                  kind === 'email'
                    ? 'inboxChannels.kindEmailHelp'
                    : 'inboxChannels.kindApiHelp',
                )}
                labelText={t('inboxChannels.columnKind')}
                onChange={(event) => {
                  setKind(
                    inboxChannelKindForChannelsSchema.parse(event.target.value),
                  );
                }}
                value={kind}
              >
                <SelectItem text={t('inboxChannels.kindApi')} value="api" />
                <SelectItem text={t('inboxChannels.kindEmail')} value="email" />
              </Select>
              <Select
                id="inbox-channel-entity"
                labelText={t('inboxChannels.columnEntity')}
                onChange={(event) => {
                  setLegalEntityId(event.target.value);
                }}
                value={legalEntityId}
              >
                <SelectItem text={t('inboxChannels.entityAny')} value="" />
                {legalEntities.map((entity) => (
                  <SelectItem
                    key={entity.id}
                    text={entity.name}
                    value={entity.id}
                  />
                ))}
              </Select>
              <TextInput
                id="inbox-channel-hint-kind"
                invalid={hintKindInvalid}
                invalidText={t('inboxChannels.hintKindInvalid')}
                labelText={t('inboxChannels.columnHintKind')}
                onChange={(event) => {
                  setHintKind(event.target.value);
                }}
                placeholder={t('inboxChannels.hintKindPlaceholder')}
                value={hintKind}
              />
              <div>
                <Button kind="primary" size="md" type="submit">
                  {t('inboxChannels.create')}
                </Button>
              </div>
            </Stack>
          </Form>
        </Tile>
      ) : null}
      <DataGrid
        columns={columns}
        description={t('inboxChannels.listDescription')}
        emptyLabel={t('inboxChannels.empty')}
        errorLabel={t('inboxChannels.error')}
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
        title={t('inboxChannels.listTitle')}
      />
      {issued === undefined ? null : issuedAddress(issued) === null ? (
        <Modal
          modalHeading={t('inboxChannels.credentialIssued')}
          onRequestClose={() => {
            setIssued(undefined);
          }}
          open
          passiveModal
        >
          <Stack gap={5}>
            <InlineNotification
              hideCloseButton
              kind="warning"
              lowContrast
              title={t('inboxChannels.credentialIssuedWarning')}
            />
            <TextInput
              id="inbox-channel-secret"
              labelText={t('inboxChannels.credentialSecret')}
              readOnly
              value={issued.secret}
            />
            <CodeSnippet
              aria-label={t('inboxChannels.credentialCurl')}
              type="multi"
              wrapText
            >
              {intakeCurlExample(publicOrigin, issued.secret)}
            </CodeSnippet>
          </Stack>
        </Modal>
      ) : (
        <Modal
          modalHeading={t('inboxChannels.addressIssued')}
          onRequestClose={() => {
            setIssued(undefined);
          }}
          open
          passiveModal
        >
          <Stack gap={5}>
            <p>{t('inboxChannels.addressIssuedHelp')}</p>
            <TextInput
              id="inbox-channel-address"
              labelText={t('inboxChannels.address')}
              readOnly
              value={issued.secret}
            />
            <div>
              <CopyButton
                feedback={t('inboxChannels.copied')}
                iconDescription={t('inboxChannels.copyAddress')}
                onClick={() => {
                  void navigator.clipboard.writeText(issued.secret);
                }}
              />
            </div>
          </Stack>
        </Modal>
      )}
      {confirm === undefined ? null : (
        <Modal
          danger
          modalHeading={t(
            confirm.kind === 'revoke'
              ? confirm.channel.kind === 'email'
                ? 'inboxChannels.revokeAddressTitle'
                : 'inboxChannels.revokeTitle'
              : 'inboxChannels.deleteTitle',
          )}
          onRequestClose={() => {
            setConfirm(undefined);
          }}
          onRequestSubmit={runConfirm}
          open
          primaryButtonText={t(
            confirm.kind === 'revoke'
              ? confirm.channel.kind === 'email'
                ? 'inboxChannels.revokeAddressTitle'
                : 'inboxChannels.revokeTitle'
              : 'inboxChannels.delete',
          )}
          secondaryButtonText={t('inboxChannels.cancel')}
        >
          {confirm.kind === 'revoke'
            ? t(
                confirm.channel.kind === 'email'
                  ? 'inboxChannels.revokeAddressConfirm'
                  : 'inboxChannels.revokeConfirm',
                { prefix: confirm.prefix },
              )
            : t('inboxChannels.deleteConfirm', { name: confirm.channel.name })}
        </Modal>
      )}
    </PageContainer>
  );
}
