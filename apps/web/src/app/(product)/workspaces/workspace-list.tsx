'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import {
  Button,
  IconButton,
  InlineNotification,
  Popover,
  PopoverContent,
  Tag,
} from '@bap/design-system/react';
import { Filter } from '@bap/design-system/icons';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../components/shell/toast';
import {
  acceptOrganizationInvitationAction,
  declineOrganizationInvitationAction,
} from '../../../lib/organizations/actions';
import WorkspaceBuildSection from './workspace-build-section';
import {
  type FilterGroup,
  WorkspaceFilterFlyout,
} from './workspace-filter-flyout';
import { workspaceMatchesFilters } from './workspace-filter';
import styles from './workspace-list.module.scss';

export type WorkspaceRow = Readonly<{
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member' | 'owner';
  status: 'active' | 'inactive';
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

type FilterSelection = Readonly<Record<string, readonly string[]>>;

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

const pageSizeChoices = [10, 25, 50] as const;

// The funnel trigger over a staged filter panel, mirrored from the members look.
function FilterButton({
  activeCount,
  applyLabel,
  groups,
  idPrefix,
  label,
  onApply,
  onOpenChange,
  onReset,
  onToggle,
  open,
  resetLabel,
  staged,
}: Readonly<{
  activeCount: number;
  applyLabel: string;
  groups: readonly FilterGroup[];
  idPrefix: string;
  label: string;
  onApply: () => void;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  onToggle: (groupKey: string, id: string, checked: boolean) => void;
  open: boolean;
  resetLabel: string;
  staged: FilterSelection;
}>) {
  return (
    <Popover
      align="bottom-end"
      onRequestClose={() => {
        onOpenChange(false);
      }}
      open={open}
    >
      <span className={styles.filterTrigger!}>
        <IconButton
          kind="ghost"
          label={label}
          onClick={() => {
            onOpenChange(!open);
          }}
          type="button"
        >
          <Filter />
        </IconButton>
        {activeCount > 0 ? (
          <span aria-hidden className={styles.filterCount!}>
            {activeCount}
          </span>
        ) : null}
      </span>
      <PopoverContent className={styles.filterPopover!}>
        {open ? (
          <WorkspaceFilterFlyout
            applyLabel={applyLabel}
            groups={groups}
            idPrefix={idPrefix}
            onApply={onApply}
            onReset={onReset}
            onToggle={onToggle}
            resetLabel={resetLabel}
            staged={staged}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

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

  const [memberRoleFilter, setMemberRoleFilter] = useState<readonly string[]>(
    [],
  );
  const [memberStatusFilter, setMemberStatusFilter] = useState<
    readonly string[]
  >([]);
  const [memberFilterOpen, setMemberFilterOpen] = useState(false);
  const [memberStaged, setMemberStaged] = useState<FilterSelection>({
    role: [],
    status: [],
  });

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
  const filteredMembers = memberWorkspaces.filter((workspace) =>
    workspaceMatchesFilters(
      { role: workspace.role, status: workspace.status },
      { roles: memberRoleFilter, statuses: memberStatusFilter },
    ),
  );

  // The staged panel commits on apply; the funnel badge counts applied filters.
  const memberAppliedCount =
    memberRoleFilter.length + memberStatusFilter.length;
  const memberFilterGroups: FilterGroup[] = [
    {
      heading: t('workspaces.filter.filterRole'),
      items: [
        { id: 'admin', label: t('workspaces.filter.roleAdmin') },
        { id: 'member', label: t('workspaces.filter.roleMember') },
      ],
      key: 'role',
    },
    {
      heading: t('workspaces.filter.filterStatus'),
      items: [
        { id: 'active', label: t('workspaces.status.active') },
        { id: 'inactive', label: t('workspaces.status.inactive') },
      ],
      key: 'status',
    },
  ];

  function stageToggle(groupKey: string, id: string, checked: boolean): void {
    setMemberStaged((current) => {
      const selected = current[groupKey] ?? [];
      return {
        ...current,
        [groupKey]: checked
          ? [...selected, id]
          : selected.filter((value) => value !== id),
      };
    });
  }
  function openMemberFilter(open: boolean): void {
    if (open) {
      setMemberStaged({ role: memberRoleFilter, status: memberStatusFilter });
    }
    setMemberFilterOpen(open);
  }
  function applyMemberFilter(): void {
    setMemberRoleFilter(memberStaged.role ?? []);
    setMemberStatusFilter(memberStaged.status ?? []);
    setMemberFilterOpen(false);
  }
  function resetMemberStaged(): void {
    setMemberStaged({ role: [], status: [] });
  }

  function openWorkspace(slug: string): void {
    router.push(`/${slug}` as Route);
  }

  // Expanded detail shared by both tables: the facts that do not fit a column.
  function renderDetail(row: GridRow): ReactNode {
    const workspace = byId.get(row.id);
    if (workspace === undefined) {
      return null;
    }
    return (
      <dl className={styles.rowDetail!}>
        <div>
          <dt>{t('workspaces.list.columnSlug')}</dt>
          <dd>{workspace.slug}</dd>
        </div>
        <div>
          <dt>{t('workspaces.list.columnCreated')}</dt>
          <dd>{workspace.created}</dd>
        </div>
        <div>
          <dt>{t('workspaces.list.columnRole')}</dt>
          <dd>{roleLabels[workspace.role]}</dd>
        </div>
        <div>
          <dt>{t('workspaces.list.columnStatus')}</dt>
          <dd>{statusLabels[workspace.status]}</dd>
        </div>
      </dl>
    );
  }

  const ownedColumns: readonly GridColumn[] = [
    { header: t('workspaces.list.columnName'), key: 'name', sortable: true },
    { header: t('workspaces.list.columnSlug'), key: 'slug', sortable: true },
    {
      header: t('workspaces.list.columnCreated'),
      key: 'created',
      sortable: true,
    },
  ];

  const memberColumns: readonly GridColumn[] = [
    { header: t('workspaces.list.columnName'), key: 'name', sortable: true },
    { header: t('workspaces.list.columnSlug'), key: 'slug', sortable: true },
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
    },
    {
      header: t('workspaces.list.columnCreated'),
      key: 'created',
      sortable: true,
    },
  ];

  const ownedRows: readonly GridRow[] = ownedWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    created: workspace.created,
  }));

  const memberRows: readonly GridRow[] = filteredMembers.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: roleLabels[workspace.role],
    status: statusLabels[workspace.status],
    created: workspace.created,
  }));

  const createAction = {
    id: 'create-workspace',
    label: t('workspaces.list.createAction'),
    onClick: () => {
      router.push('/workspaces/new');
    },
  } as const;

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
          toolbarActions={[createAction]}
        />
      ) : (
        <>
          <section aria-labelledby="workspace-owned-heading">
            <h2 id="workspace-owned-heading">{t('workspaces.list.myTitle')}</h2>
            <DataGrid
              columns={ownedColumns}
              emptyLabel={t('workspaces.list.emptyOwned')}
              initialSort={[{ direction: 'ASC', key: 'name' }]}
              pageSize={10}
              pageSizes={pageSizeChoices}
              pagination
              paginationMode="client"
              renderRowDetail={renderDetail}
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
              size="sm"
              sortable
              toolbarActions={[createAction]}
            />
          </section>

          <section aria-labelledby="workspace-member-heading">
            <div className={styles.sectionHeader!}>
              <h2 id="workspace-member-heading">
                {t('workspaces.list.memberTitle')}
              </h2>
              <FilterButton
                activeCount={memberAppliedCount}
                applyLabel={t('workspaces.filter.apply')}
                groups={memberFilterGroups}
                idPrefix="member-of"
                label={t('workspaces.filter.filter')}
                onApply={applyMemberFilter}
                onOpenChange={openMemberFilter}
                onReset={resetMemberStaged}
                onToggle={stageToggle}
                open={memberFilterOpen}
                resetLabel={t('workspaces.filter.reset')}
                staged={memberStaged}
              />
            </div>
            <DataGrid
              columns={memberColumns}
              initialSort={[{ direction: 'ASC', key: 'name' }]}
              pageSize={10}
              pageSizes={pageSizeChoices}
              pagination
              paginationMode="client"
              renderRowDetail={renderDetail}
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
              size="sm"
              sortable
            />
          </section>
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
