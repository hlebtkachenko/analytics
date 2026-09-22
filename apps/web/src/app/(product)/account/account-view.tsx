'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  Form,
  InlineNotification,
  Modal,
  PasswordInput,
  Stack,
  Tag,
  TextInput,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../components/shell/toast';
import { authClient } from '../../../lib/auth/client';

export type AccountWorkspaceRole = 'admin' | 'member' | 'owner';

export type AccountWorkspace = Readonly<{
  id: string;
  name: string;
  role: AccountWorkspaceRole;
  slug: string;
}>;

type AccountViewProperties = Readonly<{
  email: string;
  name: string;
  workspaces: readonly AccountWorkspace[];
}>;

// Up to two initials from the name, falling back to the email local part.
function initialsFor(name: string, email: string): string {
  const source = name.trim().length > 0 ? name.trim() : email;
  const letters = source
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .filter((letter) => letter.length > 0)
    .slice(0, 2)
    .join('');
  return letters.toUpperCase();
}

export default function AccountView({
  email,
  name,
  workspaces,
}: AccountViewProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const router = useRouter();

  const [profileName, setProfileName] = useState(name);
  const [savingProfile, setSavingProfile] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePasswordError, setDeletePasswordError] = useState<string | null>(
    null,
  );
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const roleLabels: Readonly<Record<AccountWorkspaceRole, string>> = {
    admin: t('workspaces.list.roleAdmin'),
    member: t('workspaces.list.roleMember'),
    owner: t('workspaces.list.roleOwner'),
  };

  const workspaceColumns: readonly GridColumn[] = [
    { header: t('account.workspaces.columnName'), key: 'name', sortable: true },
    { header: t('account.workspaces.columnSlug'), key: 'slug', sortable: true },
    { header: t('account.workspaces.columnRole'), key: 'role', sortable: true },
  ];

  const workspaceRows: readonly GridRow[] = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    role: roleLabels[workspace.role],
    slug: workspace.slug,
  }));

  async function saveProfile(): Promise<void> {
    const trimmed = profileName.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSavingProfile(true);
    const result = await authClient.updateUser({ name: trimmed });
    setSavingProfile(false);

    if (result.error) {
      notify({ kind: 'error', title: t('account.errors.generic') });
      return;
    }
    notify({ kind: 'success', title: t('account.profile.saved') });
    router.refresh();
  }

  function openDelete(): void {
    setDeletePassword('');
    setDeletePasswordError(null);
    setDeleteNotice(null);
    setDeleteOpen(true);
  }

  async function confirmDelete(): Promise<void> {
    setDeleting(true);
    setDeletePasswordError(null);
    setDeleteNotice(null);
    const result = await authClient.deleteUser({ password: deletePassword });
    setDeleting(false);

    if (!result.error) {
      router.replace('/sign-in');
      router.refresh();
      return;
    }

    const code = result.error.code;
    if (
      code === 'INVALID_PASSWORD' ||
      code === 'CREDENTIAL_ACCOUNT_NOT_FOUND'
    ) {
      setDeletePasswordError(t('account.errors.invalidPassword'));
      return;
    }
    if (code === 'ACCOUNT_HAS_SOLE_OWNED_ORGANIZATIONS') {
      setDeleteNotice(t('account.delete.soleOwner'));
      return;
    }
    if (result.error.status === 429) {
      setDeleteNotice(t('account.errors.rateLimit'));
      return;
    }
    notify({ kind: 'error', title: t('account.errors.generic') });
  }

  return (
    <>
      <h1>{t('account.title')}</h1>

      <section aria-labelledby="account-profile-heading">
        <Stack gap={5}>
          <h2 id="account-profile-heading">{t('account.profile.title')}</h2>
          <Tag type="cool-gray">{initialsFor(name, email)}</Tag>
          <Form aria-label={t('account.profile.title')}>
            <Stack gap={6}>
              <TextInput
                id="account-name"
                labelText={t('account.profile.nameLabel')}
                onChange={(event) => {
                  setProfileName(event.target.value);
                }}
                value={profileName}
              />
              <TextInput
                id="account-email"
                labelText={t('account.profile.emailLabel')}
                readOnly
                value={email}
              />
              <Button
                disabled={savingProfile || profileName.trim().length === 0}
                onClick={() => {
                  void saveProfile();
                }}
                type="button"
              >
                {t('account.profile.save')}
              </Button>
            </Stack>
          </Form>
        </Stack>
      </section>

      <section aria-labelledby="account-workspaces-heading">
        <Stack gap={5}>
          <h2 id="account-workspaces-heading">
            {t('account.workspaces.title')}
          </h2>
          {workspaceRows.length === 0 ? (
            <p>{t('account.workspaces.empty')}</p>
          ) : (
            <DataGrid
              columns={workspaceColumns}
              initialSort={[{ direction: 'ASC', key: 'name' }]}
              rows={workspaceRows}
              size="sm"
              sortable
            />
          )}
        </Stack>
      </section>

      <section aria-labelledby="account-delete-heading">
        <Stack gap={5}>
          <h2 id="account-delete-heading">{t('account.delete.heading')}</h2>
          <p>{t('account.delete.soleOwner')}</p>
          <Button kind="danger" onClick={openDelete} type="button">
            {t('account.delete.trigger')}
          </Button>
        </Stack>
      </section>

      {deleteOpen ? (
        <Modal
          danger
          modalHeading={t('account.delete.title')}
          onRequestClose={() => {
            setDeleteOpen(false);
          }}
          onRequestSubmit={() => {
            void confirmDelete();
          }}
          open
          primaryButtonDisabled={deleting || deletePassword.length === 0}
          primaryButtonText={t('account.delete.confirm')}
          secondaryButtonText={t('account.delete.cancel')}
        >
          <Stack gap={5}>
            <p>{t('account.delete.body')}</p>
            {deleteNotice !== null ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={deleteNotice}
              />
            ) : null}
            <PasswordInput
              autoComplete="current-password"
              id="account-delete-password"
              invalid={deletePasswordError !== null}
              invalidText={deletePasswordError ?? ''}
              labelText={t('account.delete.passwordLabel')}
              onChange={(event) => {
                setDeletePassword(event.target.value);
                setDeletePasswordError(null);
              }}
              value={deletePassword}
            />
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}
