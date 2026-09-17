'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridRow,
  RowAction,
  ToolbarAction,
} from '@bap/design-system/blocks';
import {
  Button,
  Checkbox,
  CodeSnippet,
  Form,
  Modal,
  PasswordInput,
  Stack,
  Tag,
  TextInput,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../../components/shell/toast';
import { authClient } from '../../../../lib/auth/client';
import { revokeAccountSessionAction } from './actions';

export type AccountSession = Readonly<{
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  updatedAt: string;
  userAgent: string | null;
}>;

type SecurityViewProperties = Readonly<{
  currentSessionId: string;
  sessions: readonly AccountSession[];
  twoFactorEnabled: boolean;
}>;

type EnableStep = 'backup' | 'password' | 'reveal' | 'verify';

// A stored timestamp renders as a plain calendar date, consistent with the other lists.
function isoDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString().slice(0, 10);
}

// The authenticator secret is carried in the otpauth URI query string.
function secretFromUri(uri: string): string {
  const query = uri.split('?')[1];
  if (query === undefined) {
    return '';
  }
  return new URLSearchParams(query).get('secret') ?? '';
}

function isRateLimited(error: { status?: number } | null | undefined): boolean {
  return error?.status === 429;
}

export default function SecurityView({
  currentSessionId,
  sessions,
  twoFactorEnabled,
}: SecurityViewProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(false);
  const [changing, setChanging] = useState(false);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);

  const [enableStep, setEnableStep] = useState<EnableStep | null>(null);
  const [enablePassword, setEnablePassword] = useState('');
  const [enablePasswordError, setEnablePasswordError] = useState<string | null>(
    null,
  );
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<readonly string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disablePasswordError, setDisablePasswordError] = useState<
    string | null
  >(null);

  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState('');
  const [regeneratePasswordError, setRegeneratePasswordError] = useState<
    string | null
  >(null);
  const [regeneratedCodes, setRegeneratedCodes] = useState<
    readonly string[] | null
  >(null);

  const sessionColumns: readonly GridColumn[] = [
    {
      header: t('account.sessions.columnLastActive'),
      key: 'lastActive',
      sortable: true,
    },
    {
      header: t('account.sessions.columnCreated'),
      key: 'created',
      sortable: true,
    },
    {
      header: t('account.sessions.columnExpires'),
      key: 'expires',
      sortable: true,
    },
    { header: t('account.sessions.columnIp'), key: 'ip' },
    { header: t('account.sessions.columnDevice'), key: 'device' },
    {
      header: '',
      key: 'current',
      renderCell: (row: GridRow) =>
        row.id === currentSessionId ? (
          <Tag type="green">{t('account.sessions.current')}</Tag>
        ) : null,
    },
  ];

  const sessionRows: readonly GridRow[] = sessions.map((session) => ({
    created: isoDate(session.createdAt),
    device:
      session.userAgent === null || session.userAgent.length === 0
        ? t('account.sessions.deviceUnknown')
        : session.userAgent.slice(0, 60),
    expires: isoDate(session.expiresAt),
    id: session.id,
    ip:
      session.ipAddress === null || session.ipAddress.length === 0
        ? t('account.sessions.ipUnknown')
        : session.ipAddress,
    lastActive: isoDate(session.updatedAt),
  }));

  function sessionRowActions(row: GridRow): readonly RowAction[] {
    // The current session is signed out by clearing the cookie, not by revoking its token.
    if (row.id === currentSessionId) {
      return [];
    }
    return [
      {
        id: 'revoke-session',
        isDelete: true,
        label: t('account.sessions.revoke'),
        onClick: () => {
          void revokeSession(row.id);
        },
      },
    ];
  }

  const sessionToolbar: readonly ToolbarAction[] = [
    {
      id: 'sign-out-others',
      label: t('account.sessions.signOutOthers'),
      onClick: () => {
        void signOutOthers();
      },
    },
  ];

  async function changePassword(): Promise<void> {
    setCurrentPasswordError(null);
    setNewPasswordError(null);
    if (newPassword !== confirmPassword) {
      setNewPasswordError(t('account.password.mismatch'));
      return;
    }
    setChanging(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: revokeOthers,
    });
    setChanging(false);

    if (!result.error) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify({ kind: 'success', title: t('account.password.updated') });
      // revokeOtherSessions rotates the session, so re-read the current session id.
      router.refresh();
      return;
    }

    const code = result.error.code;
    if (code === 'INVALID_PASSWORD') {
      setCurrentPasswordError(t('account.password.invalidCurrent'));
      return;
    }
    if (code === 'PASSWORD_TOO_SHORT') {
      setNewPasswordError(t('account.password.tooShort'));
      return;
    }
    if (code === 'PASSWORD_TOO_LONG') {
      setNewPasswordError(t('account.password.tooLong'));
      return;
    }
    notify({ kind: 'error', title: t('account.errors.generic') });
  }

  function openEnable(): void {
    setEnablePassword('');
    setEnablePasswordError(null);
    setTotpUri('');
    setBackupCodes([]);
    setVerifyCode('');
    setVerifyError(null);
    setEnableStep('password');
  }

  function closeEnable(): void {
    setEnableStep(null);
  }

  async function submitEnablePassword(): Promise<void> {
    setEnablePasswordError(null);
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.enable({
      password: enablePassword,
    });
    setTwoFactorBusy(false);

    if (result.error) {
      if (isRateLimited(result.error)) {
        setEnablePasswordError(t('account.errors.rateLimit'));
        return;
      }
      if (result.error.code === 'INVALID_PASSWORD') {
        setEnablePasswordError(t('account.errors.invalidPassword'));
        return;
      }
      notify({ kind: 'error', title: t('account.errors.generic') });
      return;
    }

    // Enrolment always returns the TOTP payload; guard the union defensively.
    if (!('totpURI' in result.data)) {
      notify({ kind: 'error', title: t('account.errors.generic') });
      return;
    }
    setTotpUri(result.data.totpURI);
    setBackupCodes(result.data.backupCodes);
    setEnableStep('reveal');
  }

  async function submitVerify(): Promise<void> {
    setVerifyError(null);
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.verifyTotp({ code: verifyCode });
    setTwoFactorBusy(false);

    if (result.error) {
      if (isRateLimited(result.error)) {
        setVerifyError(t('account.errors.rateLimit'));
        return;
      }
      setVerifyError(t('account.twoFactor.invalidCode'));
      return;
    }

    setEnableStep('backup');
    // verify-totp rotates the session, so re-read the current session id.
    router.refresh();
  }

  async function submitDisable(): Promise<void> {
    setDisablePasswordError(null);
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.disable({
      password: disablePassword,
    });
    setTwoFactorBusy(false);

    if (result.error) {
      if (isRateLimited(result.error)) {
        setDisablePasswordError(t('account.errors.rateLimit'));
        return;
      }
      if (result.error.code === 'INVALID_PASSWORD') {
        setDisablePasswordError(t('account.errors.invalidPassword'));
        return;
      }
      notify({ kind: 'error', title: t('account.errors.generic') });
      return;
    }

    setDisableOpen(false);
    setDisablePassword('');
    // disable rotates the session, so re-read the current session id.
    router.refresh();
  }

  async function submitRegenerate(): Promise<void> {
    setRegeneratePasswordError(null);
    setTwoFactorBusy(true);
    const result = await authClient.twoFactor.generateBackupCodes({
      password: regeneratePassword,
    });
    setTwoFactorBusy(false);

    if (result.error) {
      if (isRateLimited(result.error)) {
        setRegeneratePasswordError(t('account.errors.rateLimit'));
        return;
      }
      if (result.error.code === 'INVALID_PASSWORD') {
        setRegeneratePasswordError(t('account.errors.invalidPassword'));
        return;
      }
      notify({ kind: 'error', title: t('account.errors.generic') });
      return;
    }

    setRegeneratedCodes(result.data.backupCodes);
  }

  async function revokeSession(sessionId: string): Promise<void> {
    const result = await revokeAccountSessionAction(sessionId);
    if (result.ok) {
      notify({ kind: 'success', title: t('account.sessions.revokeSuccess') });
      router.refresh();
      return;
    }
    notify({ kind: 'error', title: t('account.sessions.revokeFailure') });
  }

  async function signOutOthers(): Promise<void> {
    const result = await authClient.revokeOtherSessions();
    if (!result.error) {
      notify({
        kind: 'success',
        title: t('account.sessions.signOutOthersSuccess'),
      });
      router.refresh();
      return;
    }
    notify({ kind: 'error', title: t('account.errors.generic') });
  }

  const canChange =
    !changing &&
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0;

  return (
    <>
      <h1>{t('account.title')}</h1>

      <section aria-labelledby="account-password-heading">
        <Stack gap={5}>
          <h2 id="account-password-heading">{t('account.password.title')}</h2>
          <Form aria-label={t('account.password.title')}>
            <Stack gap={6}>
              <PasswordInput
                autoComplete="current-password"
                id="current-password"
                invalid={currentPasswordError !== null}
                invalidText={currentPasswordError ?? ''}
                labelText={t('account.password.currentLabel')}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setCurrentPasswordError(null);
                }}
                value={currentPassword}
              />
              <PasswordInput
                autoComplete="new-password"
                helperText={t('account.password.passwordHelper')}
                id="new-password"
                invalid={newPasswordError !== null}
                invalidText={newPasswordError ?? ''}
                labelText={t('account.password.newLabel')}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setNewPasswordError(null);
                }}
                value={newPassword}
              />
              <PasswordInput
                autoComplete="new-password"
                id="confirm-password"
                labelText={t('account.password.confirmLabel')}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setNewPasswordError(null);
                }}
                value={confirmPassword}
              />
              <Checkbox
                checked={revokeOthers}
                id="revoke-other-sessions"
                labelText={t('account.password.revokeOthers')}
                onChange={(_event, { checked }) => {
                  setRevokeOthers(checked);
                }}
              />
              <Button
                disabled={!canChange}
                onClick={() => {
                  void changePassword();
                }}
                type="button"
              >
                {t('account.password.save')}
              </Button>
            </Stack>
          </Form>
        </Stack>
      </section>

      <section aria-labelledby="account-2fa-heading">
        <Stack gap={5}>
          <h2 id="account-2fa-heading">{t('account.twoFactor.statusTitle')}</h2>
          <p>
            {t('account.twoFactor.status')}:{' '}
            {twoFactorEnabled
              ? t('account.twoFactor.enabled')
              : t('account.twoFactor.disabled')}
          </p>
          {twoFactorEnabled ? (
            <Stack gap={5} orientation="horizontal">
              <Button
                kind="danger"
                onClick={() => {
                  setDisablePassword('');
                  setDisablePasswordError(null);
                  setDisableOpen(true);
                }}
                type="button"
              >
                {t('account.twoFactor.disable')}
              </Button>
              <Button
                kind="tertiary"
                onClick={() => {
                  setRegeneratePassword('');
                  setRegeneratePasswordError(null);
                  setRegeneratedCodes(null);
                  setRegenerateOpen(true);
                }}
                type="button"
              >
                {t('account.twoFactor.regenerate')}
              </Button>
            </Stack>
          ) : (
            <Button onClick={openEnable} type="button">
              {t('account.twoFactor.enable')}
            </Button>
          )}
        </Stack>
      </section>

      <section aria-labelledby="account-sessions-heading">
        <Stack gap={5}>
          <h2 id="account-sessions-heading">{t('account.sessions.title')}</h2>
          {sessionRows.length === 0 ? (
            <p>{t('account.sessions.empty')}</p>
          ) : (
            <DataGrid
              columns={sessionColumns}
              initialSort={[{ direction: 'DESC', key: 'lastActive' }]}
              rowActions={sessionRowActions}
              rows={sessionRows}
              size="sm"
              sortable
              toolbarActions={sessionToolbar}
            />
          )}
        </Stack>
      </section>

      {enableStep === 'password' ? (
        <Modal
          modalHeading={t('account.twoFactor.enableTitle')}
          onRequestClose={closeEnable}
          onRequestSubmit={() => {
            void submitEnablePassword();
          }}
          open
          primaryButtonDisabled={twoFactorBusy || enablePassword.length === 0}
          primaryButtonText={t('account.twoFactor.next')}
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            <p>{t('account.twoFactor.enableBody')}</p>
            <PasswordInput
              autoComplete="current-password"
              id="enable-password"
              invalid={enablePasswordError !== null}
              invalidText={enablePasswordError ?? ''}
              labelText={t('account.twoFactor.passwordLabel')}
              onChange={(event) => {
                setEnablePassword(event.target.value);
                setEnablePasswordError(null);
              }}
              value={enablePassword}
            />
          </Stack>
        </Modal>
      ) : null}

      {enableStep === 'reveal' ? (
        <Modal
          modalHeading={t('account.twoFactor.enableTitle')}
          onRequestClose={closeEnable}
          onRequestSubmit={() => {
            setEnableStep('verify');
          }}
          open
          primaryButtonText={t('account.twoFactor.next')}
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            <p>{t('account.twoFactor.verifyBody')}</p>
            <span>{t('account.twoFactor.uriLabel')}</span>
            <CodeSnippet type="single">{totpUri}</CodeSnippet>
            <span>{t('account.twoFactor.secretLabel')}</span>
            <CodeSnippet type="single">{secretFromUri(totpUri)}</CodeSnippet>
          </Stack>
        </Modal>
      ) : null}

      {enableStep === 'verify' ? (
        <Modal
          modalHeading={t('account.twoFactor.verifyTitle')}
          onRequestClose={closeEnable}
          onRequestSubmit={() => {
            void submitVerify();
          }}
          open
          primaryButtonDisabled={twoFactorBusy || verifyCode.length === 0}
          primaryButtonText={t('account.twoFactor.verify')}
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            <TextInput
              autoComplete="one-time-code"
              id="verify-code"
              invalid={verifyError !== null}
              invalidText={verifyError ?? ''}
              labelText={t('account.twoFactor.codeLabel')}
              onChange={(event) => {
                setVerifyCode(event.target.value);
                setVerifyError(null);
              }}
              value={verifyCode}
            />
          </Stack>
        </Modal>
      ) : null}

      {enableStep === 'backup' ? (
        <Modal
          modalHeading={t('account.twoFactor.backupTitle')}
          onRequestClose={closeEnable}
          onRequestSubmit={closeEnable}
          open
          passiveModal={false}
          primaryButtonText={t('account.twoFactor.done')}
        >
          <Stack gap={5}>
            <p>{t('account.twoFactor.backupBody')}</p>
            <CodeSnippet type="multi">{backupCodes.join('\n')}</CodeSnippet>
          </Stack>
        </Modal>
      ) : null}

      {disableOpen ? (
        <Modal
          danger
          modalHeading={t('account.twoFactor.disableTitle')}
          onRequestClose={() => {
            setDisableOpen(false);
          }}
          onRequestSubmit={() => {
            void submitDisable();
          }}
          open
          primaryButtonDisabled={twoFactorBusy || disablePassword.length === 0}
          primaryButtonText={t('account.twoFactor.disable')}
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            <p>{t('account.twoFactor.disableBody')}</p>
            <PasswordInput
              autoComplete="current-password"
              id="disable-password"
              invalid={disablePasswordError !== null}
              invalidText={disablePasswordError ?? ''}
              labelText={t('account.twoFactor.passwordLabel')}
              onChange={(event) => {
                setDisablePassword(event.target.value);
                setDisablePasswordError(null);
              }}
              value={disablePassword}
            />
          </Stack>
        </Modal>
      ) : null}

      {regenerateOpen ? (
        <Modal
          modalHeading={t('account.twoFactor.regenerateTitle')}
          onRequestClose={() => {
            setRegenerateOpen(false);
          }}
          onRequestSubmit={() => {
            if (regeneratedCodes === null) {
              void submitRegenerate();
            } else {
              setRegenerateOpen(false);
            }
          }}
          open
          primaryButtonDisabled={
            twoFactorBusy ||
            (regeneratedCodes === null && regeneratePassword.length === 0)
          }
          primaryButtonText={
            regeneratedCodes === null
              ? t('account.twoFactor.regenerate')
              : t('account.twoFactor.done')
          }
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            {regeneratedCodes === null ? (
              <>
                <p>{t('account.twoFactor.regenerateBody')}</p>
                <PasswordInput
                  autoComplete="current-password"
                  id="regenerate-password"
                  invalid={regeneratePasswordError !== null}
                  invalidText={regeneratePasswordError ?? ''}
                  labelText={t('account.twoFactor.passwordLabel')}
                  onChange={(event) => {
                    setRegeneratePassword(event.target.value);
                    setRegeneratePasswordError(null);
                  }}
                  value={regeneratePassword}
                />
              </>
            ) : (
              <>
                <p>{t('account.twoFactor.backupBody')}</p>
                <CodeSnippet type="multi">
                  {regeneratedCodes.join('\n')}
                </CodeSnippet>
              </>
            )}
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}
