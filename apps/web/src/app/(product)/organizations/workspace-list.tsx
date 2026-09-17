'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import { Button, InlineNotification, Tile } from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../components/shell/toast';
import {
  acceptOrganizationInvitationAction,
  declineOrganizationInvitationAction,
} from '../../../lib/organizations/actions';
import styles from './workspace-list.module.scss';

export type WorkspaceRow = Readonly<{
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member' | 'owner';
  created: string;
}>;

export type InvitationRow = Readonly<{
  id: string;
  organizationName: string;
  role: string;
  expires: string;
}>;

type WorkspaceListProperties = Readonly<{
  invitations: readonly InvitationRow[];
  invitationsFailed: boolean;
  loadError: boolean;
  workspaces: readonly WorkspaceRow[];
}>;

// The invitation result markers the create and response actions redirect back with.
const toastByResult = {
  'accept-error': {
    key: 'workspaces.invitations.acceptFailure',
    kind: 'error',
  },
  'accept-success': {
    key: 'workspaces.invitations.acceptSuccess',
    kind: 'success',
  },
  'decline-error': {
    key: 'workspaces.invitations.declineFailure',
    kind: 'error',
  },
  'decline-success': {
    key: 'workspaces.invitations.declineSuccess',
    kind: 'success',
  },
  'workspace-left': {
    key: 'workspaces.list.leftSuccess',
    kind: 'success',
  },
} as const;

export default function WorkspaceList({
  invitations,
  invitationsFailed,
  loadError,
  workspaces,
}: WorkspaceListProperties) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { notify } = useToast();
  const result = searchParams.get('result');
  const notifiedResultRef = useRef<string | null>(null);

  // Turn the redirect marker into a toast once per marker, then strip it so a reload does not repeat it.
  useEffect(() => {
    if (result === null || notifiedResultRef.current === result) {
      return;
    }
    notifiedResultRef.current = result;
    const toast = toastByResult[result as keyof typeof toastByResult];
    if (toast !== undefined) {
      notify({ kind: toast.kind, title: t(toast.key) });
    }
    router.replace('/organizations');
  }, [notify, result, router, t]);

  const roleLabels = {
    admin: t('workspaces.list.roleAdmin'),
    member: t('workspaces.list.roleMember'),
    owner: t('workspaces.list.roleOwner'),
  } as const;

  const columns: readonly GridColumn[] = [
    { header: t('workspaces.list.columnName'), key: 'name', sortable: true },
    { header: t('workspaces.list.columnSlug'), key: 'slug', sortable: true },
    { header: t('workspaces.list.columnRole'), key: 'role', sortable: true },
    {
      header: t('workspaces.list.columnCreated'),
      key: 'created',
      sortable: true,
    },
  ];

  const rows: readonly GridRow[] = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: roleLabels[workspace.role],
    created: workspace.created,
  }));

  const toolbarActions = [
    {
      id: 'create-workspace',
      label: t('workspaces.list.createAction'),
      onClick: () => {
        router.push('/organizations/new');
      },
    },
  ] as const;

  const invitationColumns: readonly GridColumn[] = [
    {
      header: t('workspaces.invitations.columnWorkspace'),
      key: 'organizationName',
    },
    { header: t('workspaces.invitations.columnRole'), key: 'role' },
    { header: t('workspaces.invitations.columnExpires'), key: 'expires' },
    {
      header: t('workspaces.invitations.actions'),
      key: 'actions',
      renderCell: (row) => (
        <div className={styles.actionsRow}>
          <form action={acceptOrganizationInvitationAction}>
            <input name="invitationId" type="hidden" value={String(row.id)} />
            <Button kind="ghost" size="sm" type="submit">
              {t('workspaces.invitations.accept')}
            </Button>
          </form>
          <form action={declineOrganizationInvitationAction}>
            <input name="invitationId" type="hidden" value={String(row.id)} />
            <Button kind="ghost" size="sm" type="submit">
              {t('workspaces.invitations.decline')}
            </Button>
          </form>
        </div>
      ),
    },
  ];

  const invitationRows: readonly GridRow[] = invitations.map((invitation) => ({
    id: invitation.id,
    organizationName: invitation.organizationName,
    role: invitation.role,
    expires: invitation.expires,
  }));

  return (
    <>
      <h1>{t('workspaces.list.title')}</h1>
      {invitationsFailed ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          role="alert"
          title={t('workspaces.invitations.loadError')}
        />
      ) : null}
      {loadError ? (
        <DataGrid
          columns={columns}
          errorLabel={t('workspaces.list.loadError')}
          rows={[]}
          size="sm"
          state="error"
          toolbarActions={toolbarActions}
        />
      ) : workspaces.length === 0 ? (
        <Tile>
          <h2>{t('workspaces.list.emptyTitle')}</h2>
          <h3>{t('workspaces.list.checklistTitle')}</h3>
          <ol>
            <li>{t('workspaces.list.checklistCreate')}</li>
            <li>{t('workspaces.list.checklistAddEntity')}</li>
            <li>{t('workspaces.list.checklistInvite')}</li>
            <li>{t('workspaces.list.checklistUpload')}</li>
          </ol>
          <Button
            onClick={() => {
              router.push('/organizations/new');
            }}
            type="button"
          >
            {t('workspaces.list.createAction')}
          </Button>
        </Tile>
      ) : (
        <DataGrid
          columns={columns}
          initialSort={[{ direction: 'ASC', key: 'name' }]}
          onRowClick={(row) => {
            router.push(`/${String(row.slug)}` as Route);
          }}
          rows={rows}
          size="sm"
          sortable
          toolbarActions={toolbarActions}
        />
      )}
      {invitations.length > 0 ? (
        <section aria-labelledby="workspace-invitations-heading">
          <h2 id="workspace-invitations-heading">
            {t('workspaces.invitations.heading')}
          </h2>
          <DataGrid
            columns={invitationColumns}
            rows={invitationRows}
            size="sm"
          />
        </section>
      ) : null}
    </>
  );
}
