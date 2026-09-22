'use client';

import type { Route } from 'next';
import { DataGrid } from '@bap/design-system/blocks';
import type {
  GridColumn,
  GridFilterGroup,
  GridFilterOption,
  GridRow,
  RowAction,
  ToolbarAction,
} from '@bap/design-system/blocks';
import { Download, UserFollow } from '@bap/design-system/icons';
import {
  Checkbox,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  TextInput,
} from '@bap/design-system/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useToast } from '../../../../components/shell/toast';
import { authClient } from '../../../../lib/auth/client';
import {
  inviteMemberWithScopeAction,
  transferOwnershipAction,
} from '../../../../lib/organizations/actions';
import {
  memberEntityScopePath,
  memberStatusPath,
  mutateJson,
} from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';
import { StatusIndicator } from '../../../../components/status-indicator';
import { memberMatchesFilters, memberRowActionIds } from './members-filter';
import styles from './members-view.module.scss';

type FilterSelection = Readonly<Record<string, readonly string[]>>;

export type MemberRole = 'admin' | 'member' | 'owner';
export type MemberStatus = 'active' | 'inactive';

export type EntityScope =
  | Readonly<{ mode: 'all' }>
  | Readonly<{ legalEntityIds: readonly string[]; mode: 'restricted' }>;

export type MemberRow = Readonly<{
  email: string;
  id: string;
  joinedAt: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  userId: string;
}>;

export type InvitationRow = Readonly<{
  email: string;
  expiresAt: string;
  id: string;
  role: MemberRole;
}>;

export type ScopeEntry = Readonly<{ scope: EntityScope; userId: string }>;

type MembersViewProperties = Readonly<{
  callerIsOwner: boolean;
  canManageEntityAccess: boolean;
  canManageMembers: boolean;
  currentUserId: string | null;
  initialInvitations: readonly InvitationRow[];
  initialMembers: readonly MemberRow[];
  initialScopes: readonly ScopeEntry[];
  legalEntities: readonly LegalEntity[];
  loadError: boolean;
  organizationId: string;
  scopeEditorAvailable: boolean;
  workspaceName: string;
}>;

// Owner is never assignable through invite or a role change; ownership moves only through transfer.
const assignableRoles: readonly MemberRole[] = ['admin', 'member'];
// Every role a listed member can hold, used only by the role filter columns.
const filterableRoles: readonly MemberRole[] = ['owner', 'admin', 'member'];

const emailSchema = z.email().max(254);

// The member and invitation lists re-read from Better Auth, validated at the boundary.
const memberListSchema = z.object({
  members: z.array(
    z.object({
      createdAt: z.union([z.string(), z.date()]).optional(),
      id: z.string().min(1),
      role: z.string(),
      status: z.string().optional(),
      user: z.object({ email: z.string(), name: z.string() }),
      userId: z.string().min(1),
    }),
  ),
});

const invitationListSchema = z.array(
  z.object({
    email: z.string(),
    expiresAt: z.union([z.string(), z.date()]).optional(),
    id: z.string().min(1),
    role: z.string(),
    status: z.string(),
  }),
);

// A role from the provider maps to the three assignable roles, otherwise member.
function asRole(value: string): MemberRole {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

// A member is active unless the provider reports the inactive status.
function asStatus(value: string | undefined): MemberStatus {
  return value === 'inactive' ? 'inactive' : 'active';
}

// A stored date renders as a plain calendar date, consistent with the other lists.
function isoDate(value: Date | string | undefined): string {
  if (value === undefined) {
    return '';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString().slice(0, 10);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadCsv(
  filename: string,
  rows: readonly (readonly string[])[],
): void {
  const contents = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(
    new Blob([`﻿${contents}\n`], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MembersView({
  callerIsOwner,
  canManageEntityAccess,
  canManageMembers,
  currentUserId,
  initialInvitations,
  initialMembers,
  initialScopes,
  legalEntities,
  loadError,
  organizationId,
  scopeEditorAvailable,
  workspaceName,
}: MembersViewProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [members, setMembers] = useState<readonly MemberRow[]>(
    () => initialMembers,
  );
  const [invitations, setInvitations] = useState<readonly InvitationRow[]>(
    () => initialInvitations,
  );
  const [scopes, setScopes] = useState<ReadonlyMap<string, EntityScope>>(
    () => new Map(initialScopes.map((entry) => [entry.userId, entry.scope])),
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Entity access is granted at invite time, so the picker starts empty and forces a choice only when entities exist.
  const [inviteScopeMode, setInviteScopeMode] = useState<'all' | 'restricted'>(
    legalEntities.length === 0 ? 'all' : 'restricted',
  );
  const [inviteScopeSelection, setInviteScopeSelection] = useState<
    readonly LegalEntity[]
  >([]);

  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null);
  const [roleValue, setRoleValue] = useState<MemberRole>('member');

  const [scopeTarget, setScopeTarget] = useState<MemberRow | null>(null);
  const [scopeMode, setScopeMode] = useState<'all' | 'restricted'>('all');
  const [scopeSelection, setScopeSelection] = useState<readonly LegalEntity[]>(
    [],
  );

  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [transferTarget, setTransferTarget] = useState<MemberRow | null>(null);
  // The typed workspace name that must match before a transfer can be confirmed.
  const [transferConfirmName, setTransferConfirmName] = useState('');
  const [cancelTarget, setCancelTarget] = useState<InvitationRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitationsLoading, setInvitationsLoading] = useState(false);

  // Applied filters feed the visible rows and the grid filter panel. Members
  // default to the active status; invitations only filter by role.
  const [memberRoleFilter, setMemberRoleFilter] = useState<readonly string[]>(
    [],
  );
  const [memberEntityFilter, setMemberEntityFilter] = useState<
    readonly string[]
  >([]);
  const [memberStatusFilter, setMemberStatusFilter] = useState<
    readonly string[]
  >(['active']);
  const [invitationRoleFilter, setInvitationRoleFilter] = useState<
    readonly string[]
  >([]);

  const [renderedAt] = useState(() => Date.now());

  const roleLabels: Readonly<Record<MemberRole, string>> = {
    admin: t('members.roles.admin'),
    member: t('members.roles.member'),
    owner: t('members.roles.owner'),
  };
  const roleHelp: Readonly<Record<MemberRole, string>> = {
    admin: t('members.roles.adminHelp'),
    member: t('members.roles.memberHelp'),
    owner: t('members.roles.ownerHelp'),
  };
  const statusLabels: Readonly<Record<MemberStatus, string>> = {
    active: t('members.status.active'),
    inactive: t('members.status.inactive'),
  };
  const orderedLegalEntities = [...legalEntities].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );

  const activeIndex = searchParams.get('tab') === 'invitations' ? 1 : 0;

  function scopeSummary(userId: string): string {
    // Without the scope editor the real scope is unknown, so it is never shown as all entities.
    if (!scopeEditorAvailable) {
      return t('members.scope.unavailable');
    }
    const scope = scopes.get(userId);
    if (scope === undefined || scope.mode === 'all') {
      return t('members.list.scopeAll');
    }
    return t('members.list.scopeCount', { count: scope.legalEntityIds.length });
  }

  function scopeDetail(userId: string): string {
    if (!scopeEditorAvailable) {
      return t('members.scope.unavailable');
    }
    const scope = scopes.get(userId);
    if (scope === undefined || scope.mode === 'all') {
      return t('members.list.scopeAll');
    }
    const names = legalEntities
      .filter((entity) => scope.legalEntityIds.includes(entity.id))
      .map((entity) => entity.name);
    return names.length === 0 ? t('members.list.scopeNone') : names.join(', ');
  }

  function scopeExpandedDetail(userId: string): string {
    if (!scopeEditorAvailable) {
      return t('members.scope.unavailable');
    }
    const scope = scopes.get(userId);
    return scope === undefined || scope.mode === 'all'
      ? t('members.list.scopeAllHelp')
      : scopeDetail(userId);
  }

  // Filter category options shared by the two grid filter panels.
  const roleOptions = useMemo<GridFilterOption[]>(
    () =>
      filterableRoles.map((role) => ({
        id: role,
        label: t(`members.roles.${role}`),
      })),
    [t],
  );
  const entityOptions = useMemo<GridFilterOption[]>(
    () =>
      [...legalEntities]
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((entity) => ({ id: entity.id, label: entity.name })),
    [legalEntities],
  );
  const statusOptions = useMemo<GridFilterOption[]>(
    () => [
      { id: 'active', label: t('members.status.active') },
      { id: 'inactive', label: t('members.status.inactive') },
    ],
    [t],
  );

  const memberStatusSel = memberStatusFilter;
  const visibleMembers = members
    .filter((member) =>
      memberMatchesFilters(
        member,
        {
          entities: memberEntityFilter,
          roles: memberRoleFilter,
          statuses: memberStatusFilter,
        },
        scopes,
      ),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const memberRows: readonly GridRow[] = visibleMembers.map((member) => ({
    email: member.email,
    id: member.id,
    joined: member.joinedAt,
    name: member.name,
    role: member.role,
    scope: scopeSummary(member.userId),
    status: member.status,
  }));

  const invitationRoleSel = invitationRoleFilter;
  const visibleInvitations = invitations
    .filter(
      (invitation) =>
        invitationRoleSel.length === 0 ||
        invitationRoleSel.includes(invitation.role),
    )
    .toSorted((left, right) => left.email.localeCompare(right.email));
  const invitationRows: readonly GridRow[] = visibleInvitations.map(
    (invitation) => ({
      email: invitation.email,
      expires:
        invitation.expiresAt !== '' &&
        new Date(invitation.expiresAt).getTime() < renderedAt
          ? t('members.invitations.expired')
          : isoDate(invitation.expiresAt),
      id: invitation.id,
      role: invitation.role,
    }),
  );

  // The title names the status the list is filtered to.
  function membersTitle(count: number): string {
    if (memberStatusSel.length === 1 && memberStatusSel[0] === 'active') {
      return t('members.list.activeTitle', { count });
    }
    if (memberStatusSel.length === 1 && memberStatusSel[0] === 'inactive') {
      return t('members.list.inactiveTitle', { count });
    }
    return t('members.list.allTitle', { count });
  }

  const memberColumns: readonly GridColumn[] = [
    { header: t('members.list.columnName'), key: 'name', sortable: true },
    { header: t('members.list.columnEmail'), key: 'email', sortable: true },
    {
      header: t('members.list.columnRole'),
      key: 'role',
      renderCell: (row) => roleLabels[asRole(String(row.role))],
      sortable: true,
    },
    { header: t('members.list.columnScope'), key: 'scope', sortable: true },
    {
      header: t('members.list.columnStatus'),
      key: 'status',
      renderCell: (row) => (
        <StatusIndicator
          label={statusLabels[asStatus(String(row.status))]}
          severity={row.status === 'inactive' ? 'neutral' : 'success'}
        />
      ),
      sortable: true,
    },
    { header: t('members.list.columnJoined'), key: 'joined', sortable: true },
  ];
  const invitationColumns: readonly GridColumn[] = [
    {
      header: t('members.invitations.columnEmail'),
      key: 'email',
      sortable: true,
    },
    {
      header: t('members.invitations.columnRole'),
      key: 'role',
      renderCell: (row) => roleLabels[asRole(String(row.role))],
      sortable: true,
    },
    {
      header: t('members.invitations.columnExpires'),
      key: 'expires',
      sortable: true,
    },
  ];

  function memberRowActionsFor(row: GridRow): readonly RowAction[] {
    const member = members.find((candidate) => candidate.id === row.id);
    return member === undefined ? [] : memberRowActions(member);
  }

  function memberActionsLabel(row: GridRow): string {
    const member = members.find((candidate) => candidate.id === row.id);
    return t('members.table.actionsFor', { name: member?.name ?? '' });
  }

  function invitationRowActionsFor(row: GridRow): readonly RowAction[] {
    const invitation = invitations.find((candidate) => candidate.id === row.id);
    return invitation === undefined ? [] : invitationRowActions(invitation);
  }

  function invitationActionsLabel(row: GridRow): string {
    const invitation = invitations.find((candidate) => candidate.id === row.id);
    return t('members.table.actionsFor', { name: invitation?.email ?? '' });
  }

  // Supplementary detail only; the row already carries the member line data.
  function memberDetail(row: GridRow): ReactNode {
    const member = members.find((candidate) => candidate.id === row.id);
    if (member === undefined) {
      return null;
    }
    return (
      <div className={styles.memberDetails!}>
        <dl>
          <div>
            <dt>{t('members.list.rolePermissions')}</dt>
            <dd>{roleHelp[member.role]}</dd>
          </div>
          <div>
            <dt>{t('members.list.scopeDetails')}</dt>
            <dd>{scopeExpandedDetail(member.userId)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  function memberRowActions(member: MemberRow): readonly RowAction[] {
    const descriptors: Readonly<Record<string, RowAction>> = {
      'change-role': {
        id: 'change-role',
        label: t('members.actions.changeRole'),
        onClick: () => {
          openRole(member);
        },
      },
      'edit-scope': {
        id: 'edit-scope',
        label: t('members.actions.editScope'),
        onClick: () => {
          openScope(member);
        },
      },
      'reactivate-member': {
        id: 'reactivate-member',
        label: t('members.actions.reactivate'),
        onClick: () => {
          void reactivateMember(member);
        },
      },
      'remove-member': {
        id: 'remove-member',
        isDelete: true,
        label: t('members.actions.remove'),
        onClick: () => {
          setRemoveTarget(member);
        },
      },
      'transfer-ownership': {
        id: 'transfer-ownership',
        isDelete: true,
        label: t('members.actions.transferOwnership'),
        onClick: () => {
          setTransferConfirmName('');
          setTransferTarget(member);
        },
      },
    };
    return memberRowActionIds(member, {
      callerIsOwner,
      canManageEntityAccess,
      canManageMembers,
      currentUserId,
      scopeEditorAvailable,
    }).map((id) => descriptors[id]!);
  }

  function invitationRowActions(
    invitation: InvitationRow,
  ): readonly RowAction[] {
    if (!canManageMembers) {
      return [];
    }
    return [
      {
        id: 'resend-invitation',
        label: t('members.actions.resend'),
        onClick: () => {
          void resendInvitation(invitation);
        },
      },
      {
        id: 'cancel-invitation',
        isDelete: true,
        label: t('members.actions.cancel'),
        onClick: () => {
          setCancelTarget(invitation);
        },
      },
    ];
  }

  function selectTab(index: number): void {
    const next = new URLSearchParams(searchParams.toString());
    if (index === 1) {
      next.set('tab', 'invitations');
    } else {
      next.delete('tab');
    }
    const query = next.toString();
    const destination = query.length === 0 ? pathname : `${pathname}?${query}`;
    router.replace(destination as Route);
  }

  function openInvite(): void {
    setInviteEmail('');
    setInviteRole('member');
    setInviteError(null);
    setInviteScopeMode(legalEntities.length === 0 ? 'all' : 'restricted');
    setInviteScopeSelection([]);
    setInviteOpen(true);
  }

  function openRole(member: MemberRow): void {
    setRoleTarget(member);
    setRoleValue(member.role);
  }

  function openScope(member: MemberRow): void {
    const scope = scopes.get(member.userId);
    const restricted = scope !== undefined && scope.mode === 'restricted';
    setScopeTarget(member);
    setScopeMode(restricted ? 'restricted' : 'all');
    setScopeSelection(
      restricted
        ? legalEntities.filter((entity) =>
            scope.legalEntityIds.includes(entity.id),
          )
        : [],
    );
  }

  async function reloadMembers(): Promise<void> {
    setMembersLoading(true);
    try {
      const result = await authClient.organization.listMembers({
        query: { limit: 100, organizationId },
      });
      const parsed = memberListSchema.safeParse(result.data);
      if (!parsed.success) {
        return;
      }
      setMembers(
        parsed.data.members.map((member) => ({
          email: member.user.email,
          id: member.id,
          joinedAt: isoDate(member.createdAt),
          name: member.user.name,
          role: asRole(member.role),
          status: asStatus(member.status),
          userId: member.userId,
        })),
      );
    } finally {
      setMembersLoading(false);
    }
  }

  async function reloadInvitations(): Promise<void> {
    setInvitationsLoading(true);
    try {
      const result = await authClient.organization.listInvitations({
        query: { organizationId },
      });
      const parsed = invitationListSchema.safeParse(result.data);
      if (!parsed.success) {
        return;
      }
      setInvitations(
        parsed.data
          .filter((invitation) => invitation.status === 'pending')
          .map((invitation) => ({
            email: invitation.email,
            expiresAt: isoDate(invitation.expiresAt),
            id: invitation.id,
            role: asRole(invitation.role),
          })),
      );
    } finally {
      setInvitationsLoading(false);
    }
  }

  async function submitInvite(): Promise<void> {
    const email = inviteEmail.trim();
    if (!emailSchema.safeParse(email).success) {
      setInviteError(t('members.invite.emailInvalid'));
      return;
    }
    const scope: EntityScope =
      inviteScopeMode === 'restricted'
        ? {
            legalEntityIds: inviteScopeSelection.map((entity) => entity.id),
            mode: 'restricted',
          }
        : { mode: 'all' };
    setSubmitting(true);
    setInviteError(null);
    const result = await inviteMemberWithScopeAction({
      email: email.toLowerCase(),
      organizationId,
      role: inviteRole,
      scope,
    });
    setSubmitting(false);

    if (result.ok) {
      setInviteOpen(false);
      notify({ kind: 'success', title: t('members.toast.inviteSuccess') });
      await reloadInvitations();
      return;
    }

    if (result.reason === 'already-invited') {
      setInviteError(t('members.invite.alreadyInvited'));
      return;
    }
    if (result.reason === 'already-member') {
      setInviteError(t('members.invite.alreadyMember'));
      return;
    }
    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  async function submitRole(): Promise<void> {
    const target = roleTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await authClient.organization.updateMemberRole({
      memberId: target.id,
      organizationId,
      role: roleValue,
    });
    setSubmitting(false);

    if (!result.error) {
      setRoleTarget(null);
      notify({ kind: 'success', title: t('members.toast.roleSuccess') });
      await reloadMembers();
      return;
    }

    if (
      result.error.code === 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER'
    ) {
      notify({ kind: 'error', title: t('members.role.lastOwner') });
      return;
    }
    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  async function submitScope(): Promise<void> {
    const target = scopeTarget;
    if (target === null) {
      return;
    }
    const body: EntityScope =
      scopeMode === 'restricted'
        ? {
            legalEntityIds: scopeSelection.map((entity) => entity.id),
            mode: 'restricted',
          }
        : { mode: 'all' };
    setSubmitting(true);
    const result = await mutateJson(
      memberEntityScopePath(organizationId, target.userId),
      { body, method: 'PUT' },
    );
    setSubmitting(false);

    if (result.ok) {
      setScopes((current) => {
        const next = new Map(current);
        next.set(target.userId, body);
        return next;
      });
      setScopeTarget(null);
      notify({ kind: 'success', title: t('members.toast.scopeSuccess') });
      return;
    }

    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  // Remove retains the membership as inactive so the audit trail survives.
  async function confirmRemove(): Promise<void> {
    const target = removeTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await mutateJson(
      memberStatusPath(organizationId, target.userId),
      { body: { status: 'inactive' }, method: 'PUT' },
    );
    setSubmitting(false);
    setRemoveTarget(null);

    if (result.ok) {
      notify({ kind: 'success', title: t('members.toast.removeSuccess') });
      await reloadMembers();
      return;
    }

    if (result.status === 409) {
      notify({ kind: 'error', title: t('members.remove.lastOwner') });
      return;
    }
    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  // Transfer hands ownership to the target and demotes the caller to admin server-side.
  async function confirmTransfer(): Promise<void> {
    const target = transferTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await transferOwnershipAction({
      organizationId,
      toUserId: target.userId,
    });
    setSubmitting(false);
    setTransferTarget(null);
    setTransferConfirmName('');

    if (result.ok) {
      notify({ kind: 'success', title: t('members.toast.transferSuccess') });
      await reloadMembers();
      // The caller is now admin, so re-render the shell to drop owner-only controls.
      router.refresh();
      return;
    }
    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  async function reactivateMember(member: MemberRow): Promise<void> {
    setSubmitting(true);
    const result = await mutateJson(
      memberStatusPath(organizationId, member.userId),
      { body: { status: 'active' }, method: 'PUT' },
    );
    setSubmitting(false);

    if (result.ok) {
      notify({ kind: 'success', title: t('members.toast.reactivateSuccess') });
      await reloadMembers();
      return;
    }
    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  async function confirmCancel(): Promise<void> {
    const target = cancelTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await authClient.organization.cancelInvitation({
      invitationId: target.id,
    });
    setSubmitting(false);
    setCancelTarget(null);

    if (!result.error) {
      notify({ kind: 'success', title: t('members.toast.cancelSuccess') });
      await reloadInvitations();
      return;
    }

    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  async function resendInvitation(invitation: InvitationRow): Promise<void> {
    const result = await authClient.organization.inviteMember({
      email: invitation.email,
      organizationId,
      resend: true,
      role: invitation.role,
    });

    if (!result.error) {
      notify({ kind: 'success', title: t('members.toast.resendSuccess') });
      await reloadInvitations();
      return;
    }

    notify({ kind: 'error', title: t('members.toast.failure') });
  }

  function exportMembersCsv(): void {
    downloadCsv('members.csv', [
      [
        t('members.list.columnName'),
        t('members.list.columnEmail'),
        t('members.list.columnRole'),
        t('members.list.columnScope'),
        t('members.list.columnStatus'),
        t('members.list.columnJoined'),
      ],
      ...visibleMembers.map((member) => [
        member.name,
        member.email,
        roleLabels[member.role],
        scopeDetail(member.userId),
        statusLabels[member.status],
        member.joinedAt,
      ]),
    ]);
  }

  function exportInvitationsCsv(): void {
    downloadCsv('pending-invitations.csv', [
      [
        t('members.invitations.columnEmail'),
        t('members.invitations.columnRole'),
        t('members.invitations.columnExpires'),
      ],
      ...visibleInvitations.map((invitation) => [
        invitation.email,
        roleLabels[invitation.role],
        invitation.expiresAt,
      ]),
    ]);
  }

  // The panel stages its checkboxes, so the grid reports a whole selection on apply.
  function applyMemberFilters(values: FilterSelection): void {
    setMemberRoleFilter(values.role ?? []);
    setMemberEntityFilter(values.entity ?? []);
    setMemberStatusFilter(values.status ?? []);
  }
  function applyInvitationFilters(values: FilterSelection): void {
    setInvitationRoleFilter(values.role ?? []);
  }

  const memberFilterValues: FilterSelection = {
    entity: memberEntityFilter,
    role: memberRoleFilter,
    status: memberStatusFilter,
  };
  const invitationFilterValues: FilterSelection = {
    role: invitationRoleFilter,
  };

  const memberFilterGroups: readonly GridFilterGroup[] = [
    {
      heading: t('members.table.filterRole'),
      key: 'role',
      options: roleOptions,
    },
    ...(entityOptions.length > 0
      ? [
          {
            heading: t('members.table.filterEntity'),
            key: 'entity',
            options: entityOptions,
          },
        ]
      : []),
    {
      heading: t('members.table.filterStatus'),
      key: 'status',
      options: statusOptions,
    },
  ];
  const invitationFilterGroups: readonly GridFilterGroup[] = [
    {
      heading: t('members.table.filterRole'),
      key: 'role',
      options: roleOptions,
    },
  ];

  // Export first, then the primary invite action at the end of the toolbar.
  const exportAction = (id: string, onClick: () => void): ToolbarAction => ({
    icon: Download,
    id,
    iconOnly: true,
    kind: 'ghost',
    label: t('members.table.exportCsv'),
    onClick,
  });
  const inviteAction: readonly ToolbarAction[] = canManageMembers
    ? [
        {
          icon: UserFollow,
          id: 'invite-member',
          label: t('members.list.inviteAction'),
          onClick: openInvite,
        },
      ]
    : [];
  const memberToolbarActions: readonly ToolbarAction[] = [
    exportAction('export-members', exportMembersCsv),
    ...inviteAction,
  ];
  const invitationToolbarActions: readonly ToolbarAction[] = [
    exportAction('export-invitations', exportInvitationsCsv),
    ...inviteAction,
  ];

  return (
    <>
      <h1>{t('members.list.title', { name: workspaceName })}</h1>
      {loadError ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          role="alert"
          title={t('members.list.loadError')}
        />
      ) : (
        <Tabs
          onChange={({ selectedIndex }) => selectTab(selectedIndex)}
          selectedIndex={activeIndex}
        >
          <TabList
            aria-label={t('members.list.title', { name: workspaceName })}
          >
            <Tab>{t('members.tabs.members')}</Tab>
            <Tab>{t('members.tabs.invitations')}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel className={styles.tabPanel!}>
              <DataGrid
                columns={memberColumns}
                emptyLabel={
                  members.length === 0
                    ? t('members.list.empty')
                    : t('members.table.noResults')
                }
                filterValues={memberFilterValues}
                filters={memberFilterGroups}
                onFilterChange={applyMemberFilters}
                pagination
                renderRowDetail={memberDetail}
                rowActions={memberRowActionsFor}
                rowActionsLabel={memberActionsLabel}
                rows={memberRows}
                search
                searchPlaceholder={t('members.table.searchMembers')}
                searchPlacement="persistent"
                size="sm"
                sortable
                state={membersLoading ? 'loading' : 'ready'}
                title={membersTitle(visibleMembers.length)}
                toolbarActions={memberToolbarActions}
              />
            </TabPanel>
            <TabPanel className={styles.tabPanel!}>
              <DataGrid
                columns={invitationColumns}
                emptyLabel={
                  invitations.length === 0
                    ? t('members.invitations.empty')
                    : t('members.table.noResults')
                }
                filterValues={invitationFilterValues}
                filters={invitationFilterGroups}
                onFilterChange={applyInvitationFilters}
                pagination
                rowActions={invitationRowActionsFor}
                rowActionsLabel={invitationActionsLabel}
                rows={invitationRows}
                search
                searchPlaceholder={t('members.table.searchInvitations')}
                searchPlacement="persistent"
                size="sm"
                sortable
                state={invitationsLoading ? 'loading' : 'ready'}
                title={t('members.invitations.title', {
                  count: visibleInvitations.length,
                })}
                toolbarActions={invitationToolbarActions}
              />
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}

      <Modal
        hasScrollingContent
        modalHeading={t('members.invite.title')}
        onRequestClose={() => {
          setInviteOpen(false);
        }}
        onRequestSubmit={() => {
          void submitInvite();
        }}
        open={inviteOpen}
        primaryButtonDisabled={
          submitting ||
          inviteEmail.trim().length === 0 ||
          (inviteScopeMode === 'restricted' &&
            inviteScopeSelection.length === 0)
        }
        primaryButtonText={t('members.invite.submit')}
        secondaryButtonText={t('members.invite.cancel')}
        size="sm"
      >
        <Stack gap={5}>
          <TextInput
            autoComplete="email"
            id="invite-email"
            invalid={inviteError !== null}
            invalidText={inviteError ?? ''}
            labelText={t('members.invite.emailLabel')}
            onChange={(event) => {
              setInviteEmail(event.target.value);
              setInviteError(null);
            }}
            type="email"
            value={inviteEmail}
          />
          <Select
            id="invite-role"
            labelText={t('members.invite.roleLabel')}
            onChange={(event) => {
              setInviteRole(asRole(event.target.value));
            }}
            value={inviteRole}
          >
            {assignableRoles.map((role) => (
              <SelectItem key={role} text={roleLabels[role]} value={role} />
            ))}
          </Select>
          <Select
            id="invite-scope-mode"
            labelText={t('members.scope.modeLabel')}
            onChange={(event) => {
              setInviteScopeMode(
                event.target.value === 'all' ? 'all' : 'restricted',
              );
            }}
            value={inviteScopeMode}
          >
            <SelectItem
              text={t('members.scope.restricted')}
              value="restricted"
            />
            <SelectItem text={t('members.scope.all')} value="all" />
          </Select>
          {inviteScopeMode === 'restricted' ? (
            <fieldset className={styles.scopeEntities!}>
              <legend>{t('members.scope.entitiesLabel')}</legend>
              {orderedLegalEntities.length === 0 ? (
                <p>{t('members.scope.noEntities')}</p>
              ) : (
                <div className={styles.scopeEntityOptions!}>
                  {orderedLegalEntities.map((entity) => (
                    <Checkbox
                      checked={inviteScopeSelection.some(
                        (selected) => selected.id === entity.id,
                      )}
                      id={`invite-scope-entity-${entity.id}`}
                      key={entity.id}
                      labelText={entity.name}
                      onChange={(_event, { checked }) => {
                        setInviteScopeSelection((current) =>
                          checked
                            ? [...current, entity]
                            : current.filter(
                                (selected) => selected.id !== entity.id,
                              ),
                        );
                      }}
                    />
                  ))}
                </div>
              )}
            </fieldset>
          ) : null}
        </Stack>
      </Modal>

      {roleTarget !== null ? (
        <Modal
          modalHeading={t('members.role.title', { email: roleTarget.email })}
          onRequestClose={() => {
            setRoleTarget(null);
          }}
          onRequestSubmit={() => {
            void submitRole();
          }}
          open
          primaryButtonDisabled={submitting}
          primaryButtonText={t('members.role.submit')}
          secondaryButtonText={t('members.role.cancel')}
          size="sm"
        >
          <Stack gap={5}>
            <Select
              id="role-value"
              labelText={t('members.role.label')}
              onChange={(event) => {
                setRoleValue(asRole(event.target.value));
              }}
              value={roleValue}
            >
              {assignableRoles.map((role) => (
                <SelectItem key={role} text={roleLabels[role]} value={role} />
              ))}
            </Select>
            <div>
              <p>{t('members.roles.ownerHelp')}</p>
              <p>{t('members.roles.adminHelp')}</p>
              <p>{t('members.roles.memberHelp')}</p>
            </div>
          </Stack>
        </Modal>
      ) : null}

      {scopeTarget !== null ? (
        <Modal
          hasScrollingContent
          modalHeading={t('members.scope.title', { email: scopeTarget.email })}
          onRequestClose={() => {
            setScopeTarget(null);
          }}
          onRequestSubmit={() => {
            void submitScope();
          }}
          open
          primaryButtonDisabled={
            submitting ||
            (scopeMode === 'restricted' && scopeSelection.length === 0)
          }
          primaryButtonText={t('members.scope.submit')}
          secondaryButtonText={t('members.scope.cancel')}
          size="sm"
        >
          <Stack gap={5}>
            <Select
              id="scope-mode"
              labelText={t('members.scope.modeLabel')}
              onChange={(event) => {
                setScopeMode(
                  event.target.value === 'restricted' ? 'restricted' : 'all',
                );
              }}
              value={scopeMode}
            >
              <SelectItem text={t('members.scope.all')} value="all" />
              <SelectItem
                text={t('members.scope.restricted')}
                value="restricted"
              />
            </Select>
            {scopeMode === 'restricted' ? (
              <fieldset className={styles.scopeEntities!}>
                <legend>{t('members.scope.entitiesLabel')}</legend>
                {orderedLegalEntities.length === 0 ? (
                  <p>{t('members.scope.noEntities')}</p>
                ) : (
                  <div className={styles.scopeEntityOptions!}>
                    {orderedLegalEntities.map((entity) => (
                      <Checkbox
                        checked={scopeSelection.some(
                          (selected) => selected.id === entity.id,
                        )}
                        id={`scope-entity-${entity.id}`}
                        key={entity.id}
                        labelText={entity.name}
                        onChange={(_event, { checked }) => {
                          setScopeSelection((current) =>
                            checked
                              ? [...current, entity]
                              : current.filter(
                                  (selected) => selected.id !== entity.id,
                                ),
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}
          </Stack>
        </Modal>
      ) : null}

      {removeTarget !== null ? (
        <Modal
          danger
          modalHeading={t('members.remove.title', { name: removeTarget.name })}
          onRequestClose={() => {
            setRemoveTarget(null);
          }}
          onRequestSubmit={() => {
            void confirmRemove();
          }}
          open
          primaryButtonDisabled={submitting}
          primaryButtonText={t('members.remove.confirm')}
          secondaryButtonText={t('members.remove.cancel')}
          size="xs"
        >
          <p>{t('members.remove.body')}</p>
        </Modal>
      ) : null}

      {transferTarget !== null ? (
        <Modal
          danger
          modalHeading={t('members.transfer.title', {
            name: transferTarget.name,
          })}
          onRequestClose={() => {
            setTransferTarget(null);
            setTransferConfirmName('');
          }}
          onRequestSubmit={() => {
            void confirmTransfer();
          }}
          open
          primaryButtonDisabled={
            submitting || transferConfirmName.trim() !== workspaceName
          }
          primaryButtonText={t('members.transfer.confirm')}
          secondaryButtonText={t('members.transfer.cancel')}
          size="sm"
        >
          <Stack gap={5}>
            <p>{t('members.transfer.body', { name: transferTarget.name })}</p>
            <TextInput
              autoComplete="off"
              helperText={t('members.transfer.confirmPrompt', {
                name: workspaceName,
              })}
              id="transfer-confirm-name"
              labelText={t('members.transfer.confirmLabel')}
              onChange={(event) => {
                setTransferConfirmName(event.target.value);
              }}
              onPaste={(event) => {
                event.preventDefault();
              }}
              value={transferConfirmName}
            />
          </Stack>
        </Modal>
      ) : null}

      {cancelTarget !== null ? (
        <Modal
          danger
          modalHeading={t('members.cancelInvite.title', {
            email: cancelTarget.email,
          })}
          onRequestClose={() => {
            setCancelTarget(null);
          }}
          onRequestSubmit={() => {
            void confirmCancel();
          }}
          open
          primaryButtonDisabled={submitting}
          primaryButtonText={t('members.cancelInvite.confirm')}
          secondaryButtonText={t('members.cancelInvite.cancel')}
          size="xs"
        >
          <p>{t('members.cancelInvite.body')}</p>
        </Modal>
      ) : null}
    </>
  );
}
