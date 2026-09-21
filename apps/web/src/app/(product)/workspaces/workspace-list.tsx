'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridFilterGroup,
  GridRow,
} from '@bap/design-system/blocks';
import { Button, InlineNotification, Tag } from '@bap/design-system/react';
import { Add } from '@bap/design-system/icons';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../components/shell/toast';
import {
  acceptOrganizationInvitationAction,
  declineOrganizationInvitationAction,
} from '../../../lib/organizations/actions';
import WorkspaceBuildSection from './workspace-build-section';
import styles from './workspace-list.module.scss';

export type WorkspaceRow = Readonly<{
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member' | 'owner';
  status: 'active' | 'inactive';
  created: string;
  joined: string;
  memberCount: number;
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
    router.replace('/workspaces');
  }, [notify, result, router, t]);

  const roleLabels = {
    admin: t('workspaces.list.roleAdmin'),
    member: t('workspaces.list.roleMember'),
    owner: t('workspaces.list.roleOwner'),
  } as const;
  const statusLabels = {
    active: t('workspaces.status.active'),
    inactive: t('workspaces.status.inactive'),
  } as const;

  const byId = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  );

  const ownedWorkspaces = workspaces.filter(
    (workspace) => workspace.role === 'owner',
  );
  const memberWorkspaces = workspaces.filter(
    (workspace) => workspace.role !== 'owner',
  );

  function openWorkspace(slug: string): void {
    router.push(`/${slug}` as Route);
  }

  // The Tag columns keep the raw id in the cell value so the block filter and
  // search still match, and render the localized Tag through renderCell.
  function statusColumn(): GridColumn {
    return {
      header: t('workspaces.list.columnStatus'),
      key: 'status',
      renderCell: (row) => {
        const workspace = byId.get(row.id);
        return workspace === undefined ? null : (
          <Tag
            size="sm"
            type={workspace.status === 'active' ? 'green' : 'gray'}
          >
            {statusLabels[workspace.status]}
          </Tag>
        );
      },
      sortable: true,
    };
  }

  const membersColumn: GridColumn = {
    align: 'end',
    header: t('workspaces.list.columnMembers'),
    key: 'members',
    sortable: true,
  };

  const ownedColumns: readonly GridColumn[] = [
    { header: t('workspaces.list.columnName'), key: 'name', sortable: true },
    { header: t('workspaces.list.columnSlug'), key: 'slug', sortable: true },
    statusColumn(),
    membersColumn,
    {
      header: t('workspaces.list.columnCreated'),
      key: 'created',
      sortable: true,
    },
  ];

  const memberColumns: readonly GridColumn[] = [
    { header: t('workspaces.list.columnName'), key: 'name', sortable: true },
    { header: t('workspaces.list.columnSlug'), key: 'slug', sortable: true },
    statusColumn(),
    membersColumn,
    {
      header: t('workspaces.list.columnRole'),
      key: 'role',
      renderCell: (row) => {
        const workspace = byId.get(row.id);
        return workspace === undefined ? null : (
          <Tag
            size="sm"
            type={workspace.role === 'admin' ? 'teal' : 'cool-gray'}
          >
            {roleLabels[workspace.role]}
          </Tag>
        );
      },
      sortable: true,
    },
    {
      header: t('workspaces.list.columnJoined'),
      key: 'joined',
      sortable: true,
    },
  ];

  const ownedRows: readonly GridRow[] = ownedWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
    members: workspace.memberCount,
    created: workspace.created,
  }));

  const memberRows: readonly GridRow[] = memberWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
    members: workspace.memberCount,
    role: workspace.role,
    joined: workspace.joined,
  }));

  const statusFilterGroup: GridFilterGroup = {
    heading: t('workspaces.filter.filterStatus'),
    key: 'status',
    options: [
      { id: 'active', label: t('workspaces.status.active') },
      { id: 'inactive', label: t('workspaces.status.inactive') },
    ],
  };
  const ownedFilters: readonly GridFilterGroup[] = [statusFilterGroup];
  const memberFilters: readonly GridFilterGroup[] = [
    {
      heading: t('workspaces.filter.filterRole'),
      key: 'role',
      options: [
        { id: 'admin', label: t('workspaces.filter.roleAdmin') },
        { id: 'member', label: t('workspaces.filter.roleMember') },
      ],
    },
    statusFilterGroup,
  ];

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
      <div className={styles.titleRow!}>
        <h1>{t('workspaces.list.title')}</h1>
        <Button
          onClick={() => {
            router.push('/workspaces/new');
          }}
          renderIcon={Add}
          type="button"
        >
          {t('workspaces.list.createAction')}
        </Button>
      </div>

      <WorkspaceBuildSection />

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
          columns={ownedColumns}
          errorLabel={t('workspaces.list.loadError')}
          rows={[]}
          size="sm"
          state="error"
          title={t('workspaces.list.myTitle')}
        />
      ) : (
        <>
          <DataGrid
            columns={ownedColumns}
            emptyLabel={t('workspaces.list.emptyOwned')}
            filters={ownedFilters}
            initialSort={[{ direction: 'ASC', key: 'name' }]}
            onRowClick={(row) => {
              openWorkspace(String(row.slug));
            }}
            rowActions={(row) => [
              {
                id: 'open',
                label: t('workspaces.list.openAction'),
                onClick: () => {
                  openWorkspace(String(row.slug));
                },
              },
              {
                id: 'settings',
                label: t('workspaces.list.settingsAction'),
                onClick: () => {
                  router.push(`/${String(row.slug)}/settings` as Route);
                },
              },
              {
                id: 'members',
                label: t('workspaces.list.membersAction'),
                onClick: () => {
                  router.push(`/${String(row.slug)}/members` as Route);
                },
              },
            ]}
            rows={ownedRows}
            search
            searchPlacement="persistent"
            size="sm"
            sortable
            title={t('workspaces.list.myTitle')}
            titleInline
          />

          <DataGrid
            columns={memberColumns}
            filters={memberFilters}
            initialSort={[{ direction: 'ASC', key: 'name' }]}
            onRowClick={(row) => {
              openWorkspace(String(row.slug));
            }}
            rowActions={(row) => [
              {
                id: 'open',
                label: t('workspaces.list.openAction'),
                onClick: () => {
                  openWorkspace(String(row.slug));
                },
              },
              {
                id: 'leave',
                isDelete: true,
                label: t('workspaces.list.leaveAction'),
                onClick: () => {
                  router.push(`/${String(row.slug)}/settings` as Route);
                },
              },
            ]}
            rows={memberRows}
            search
            searchPlacement="persistent"
            size="sm"
            sortable
            title={t('workspaces.list.joinedTitle')}
            titleInline
          />
        </>
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
