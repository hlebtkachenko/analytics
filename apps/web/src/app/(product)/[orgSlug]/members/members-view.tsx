'use client';

import type { Route } from 'next';
import {
  Button,
  Checkbox,
  DataTable,
  IconButton,
  InlineNotification,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  Pagination,
  Popover,
  PopoverContent,
  Select,
  SelectItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandedRow,
  TableExpandHeader,
  TableExpandRow,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { Download, Filter, UserFollow } from '@bap/design-system/icons';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useToast } from '../../../../components/shell/toast';
import { authClient } from '../../../../lib/auth/client';
import {
  memberEntityScopePath,
  memberStatusPath,
  mutateJson,
} from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';
import { type FilterGroup, MembersFilterFlyout } from './members-filter-flyout';
import { memberMatchesFilters, memberRowActionIds } from './members-filter';
import styles from './members-view.module.scss';

type FilterItem = Readonly<{ id: string; label: string }>;

type FilterSelection = Readonly<Record<string, readonly string[]>>;

// The toolbar funnel: an IconButton trigger over a batch-updates filter panel.
// The panel only mounts while open so the two tabs never duplicate its inputs.
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
          <MembersFilterFlyout
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

type TableAction = Readonly<{
  id: string;
  isDelete?: boolean;
  label: string;
  onClick: () => void;
}>;

type MembersViewProperties = Readonly<{
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

const assignableRoles: readonly MemberRole[] = ['owner', 'admin', 'member'];
const pageSizeChoices: number[] = [10, 25, 50];

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

// Carbon's render-prop helpers type some values as optionally undefined, which the
// component props reject under exactOptionalPropertyTypes; drop the undefined values.
function definedProps<T extends Record<string, unknown>>(
  props: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
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

  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null);
  const [roleValue, setRoleValue] = useState<MemberRole>('member');

  const [scopeTarget, setScopeTarget] = useState<MemberRow | null>(null);
  const [scopeMode, setScopeMode] = useState<'all' | 'restricted'>('all');
  const [scopeSelection, setScopeSelection] = useState<readonly LegalEntity[]>(
    [],
  );

  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvitationRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Applied filters feed the visible rows and the dismissible-tag row. Members
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

  // Staged filter state edited inside the open panel; committed on apply.
  const [memberFilterOpen, setMemberFilterOpen] = useState(false);
  const [memberStaged, setMemberStaged] = useState<FilterSelection>({
    entity: [],
    role: [],
    status: ['active'],
  });
  const [invitationFilterOpen, setInvitationFilterOpen] = useState(false);
  const [invitationStaged, setInvitationStaged] = useState<FilterSelection>({
    role: [],
  });

  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = useState(10);
  const [invitationPage, setInvitationPage] = useState(1);
  const [invitationPageSize, setInvitationPageSize] = useState(10);
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

  // Filter category items shared by the panel columns and the applied-tag row.
  const roleItems = useMemo<FilterItem[]>(
    () =>
      assignableRoles.map((role) => ({
        id: role,
        label: t(`members.roles.${role}`),
      })),
    [t],
  );
  const entityItems = useMemo<FilterItem[]>(
    () =>
      [...legalEntities]
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((entity) => ({ id: entity.id, label: entity.name })),
    [legalEntities],
  );
  const statusItems = useMemo<FilterItem[]>(
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
  const memberRows = visibleMembers.map((member) => ({
    email: member.email,
    id: member.id,
    joined: member.joinedAt,
    name: member.name,
    role: roleLabels[member.role],
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
  const invitationRows = visibleInvitations.map((invitation) => ({
    email: invitation.email,
    expires:
      invitation.expiresAt !== '' &&
      new Date(invitation.expiresAt).getTime() < renderedAt
        ? t('members.invitations.expired')
        : isoDate(invitation.expiresAt),
    id: invitation.id,
    role: roleLabels[invitation.role],
  }));

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

  const memberHeaders = [
    { header: t('members.list.columnName'), key: 'name' },
    { header: t('members.list.columnEmail'), key: 'email' },
    { header: t('members.list.columnRole'), key: 'role' },
    { header: t('members.list.columnScope'), key: 'scope' },
    { header: t('members.list.columnStatus'), key: 'status' },
    { header: t('members.list.columnJoined'), key: 'joined' },
  ];
  const invitationHeaders = [
    { header: t('members.invitations.columnEmail'), key: 'email' },
    { header: t('members.invitations.columnRole'), key: 'role' },
    { header: t('members.invitations.columnExpires'), key: 'expires' },
  ];

  function memberRowActions(member: MemberRow): readonly TableAction[] {
    const descriptors: Readonly<Record<string, TableAction>> = {
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
    };
    return memberRowActionIds(member, {
      canManageEntityAccess,
      canManageMembers,
      currentUserId,
      scopeEditorAvailable,
    }).map((id) => descriptors[id]!);
  }

  function invitationRowActions(
    invitation: InvitationRow,
  ): readonly TableAction[] {
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
  }

  async function reloadInvitations(): Promise<void> {
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
  }

  async function submitInvite(): Promise<void> {
    if (!emailSchema.safeParse(inviteEmail.trim()).success) {
      setInviteError(t('members.invite.emailInvalid'));
      return;
    }
    setSubmitting(true);
    setInviteError(null);
    const result = await authClient.organization.inviteMember({
      email: inviteEmail.trim().toLowerCase(),
      organizationId,
      role: inviteRole,
    });
    setSubmitting(false);

    if (!result.error) {
      setInviteOpen(false);
      notify({ kind: 'success', title: t('members.toast.inviteSuccess') });
      await reloadInvitations();
      return;
    }

    if (result.error.code === 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION') {
      setInviteError(t('members.invite.alreadyInvited'));
      return;
    }
    if (result.error.code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
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

  // The funnel badge counts applied filters; the checked panel shows which ones.
  const memberAppliedCount =
    memberRoleFilter.length +
    memberEntityFilter.length +
    memberStatusFilter.length;
  const invitationAppliedCount = invitationRoleFilter.length;

  // A staged category toggle adds or removes the id without touching applied state.
  function stageToggle(
    setStaged: (updater: (current: FilterSelection) => FilterSelection) => void,
    groupKey: string,
    id: string,
    checked: boolean,
  ): void {
    setStaged((current) => {
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
      setMemberStaged({
        entity: memberEntityFilter,
        role: memberRoleFilter,
        status: memberStatusFilter,
      });
    }
    setMemberFilterOpen(open);
  }
  function applyMemberFilter(): void {
    setMemberRoleFilter(memberStaged.role ?? []);
    setMemberEntityFilter(memberStaged.entity ?? []);
    setMemberStatusFilter(memberStaged.status ?? []);
    setMemberPage(1);
    setMemberFilterOpen(false);
  }
  function resetMemberStaged(): void {
    setMemberStaged({ entity: [], role: [], status: [] });
  }

  function openInvitationFilter(open: boolean): void {
    if (open) {
      setInvitationStaged({ role: invitationRoleFilter });
    }
    setInvitationFilterOpen(open);
  }
  function applyInvitationFilter(): void {
    setInvitationRoleFilter(invitationStaged.role ?? []);
    setInvitationPage(1);
    setInvitationFilterOpen(false);
  }
  function resetInvitationStaged(): void {
    setInvitationStaged({ role: [] });
  }

  const memberFilterGroups: FilterGroup[] = [
    { heading: t('members.table.filterRole'), items: roleItems, key: 'role' },
    ...(entityItems.length > 0
      ? [
          {
            heading: t('members.table.filterEntity'),
            items: entityItems,
            key: 'entity',
          },
        ]
      : []),
    {
      heading: t('members.table.filterStatus'),
      items: statusItems,
      key: 'status',
    },
  ];
  const invitationFilterGroups: FilterGroup[] = [
    { heading: t('members.table.filterRole'), items: roleItems, key: 'role' },
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
              {members.length === 0 ? (
                <Tile>
                  <p>{t('members.list.empty')}</p>
                  {canManageMembers ? (
                    <Button
                      onClick={() => {
                        openInvite();
                      }}
                      renderIcon={UserFollow}
                      type="button"
                    >
                      {t('members.list.inviteAction')}
                    </Button>
                  ) : null}
                </Tile>
              ) : (
                <DataTable headers={memberHeaders} isSortable rows={memberRows}>
                  {({
                    getExpandedRowProps,
                    getExpandHeaderProps,
                    getHeaderProps,
                    getRowProps,
                    getTableContainerProps,
                    getTableProps,
                    getToolbarProps,
                    headers,
                    onInputChange,
                    rows,
                  }) => {
                    const expandHeaderProps = getExpandHeaderProps();
                    const start = (memberPage - 1) * memberPageSize;
                    const pageRows = rows.slice(start, start + memberPageSize);
                    return (
                      <TableContainer
                        className={styles.tableContainer!}
                        title={membersTitle(visibleMembers.length)}
                        {...getTableContainerProps()}
                      >
                        <TableToolbar {...definedProps(getToolbarProps())}>
                          <TableToolbarContent>
                            <TableToolbarSearch
                              id="active-members-search"
                              labelText={t('members.table.searchMembers')}
                              onChange={(event) => {
                                onInputChange(event);
                                setMemberPage(1);
                              }}
                              persistent
                              placeholder={t('members.table.searchMembers')}
                            />
                            <FilterButton
                              activeCount={memberAppliedCount}
                              applyLabel={t('members.table.applyFilters')}
                              groups={memberFilterGroups}
                              idPrefix="active-members"
                              label={t('members.table.filter')}
                              onApply={applyMemberFilter}
                              onOpenChange={openMemberFilter}
                              onReset={resetMemberStaged}
                              onToggle={(groupKey, id, checked) => {
                                stageToggle(
                                  setMemberStaged,
                                  groupKey,
                                  id,
                                  checked,
                                );
                              }}
                              open={memberFilterOpen}
                              resetLabel={t('members.table.resetFilters')}
                              staged={memberStaged}
                            />
                            <Button
                              kind="ghost"
                              onClick={exportMembersCsv}
                              renderIcon={Download}
                              type="button"
                            >
                              {t('members.table.exportCsv')}
                            </Button>
                            {canManageMembers ? (
                              <Button
                                onClick={() => {
                                  openInvite();
                                }}
                                renderIcon={UserFollow}
                                type="button"
                              >
                                {t('members.list.inviteAction')}
                              </Button>
                            ) : null}
                          </TableToolbarContent>
                        </TableToolbar>
                        <Table {...getTableProps()}>
                          <TableHead>
                            <TableRow>
                              <TableExpandHeader id={expandHeaderProps.id} />
                              {headers.map((header) => {
                                const { key, ...headerProps } = getHeaderProps({
                                  header,
                                });
                                return (
                                  <TableHeader
                                    key={key}
                                    {...definedProps(headerProps)}
                                  >
                                    {header.header}
                                  </TableHeader>
                                );
                              })}
                              <TableHeader
                                aria-label={t('members.table.rowActions')}
                              />
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {pageRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={headers.length + 2}>
                                  {t('members.table.noResults')}
                                </TableCell>
                              </TableRow>
                            ) : null}
                            {pageRows.map((row) => {
                              const { key, ...rowProps } = getRowProps({ row });
                              const member = members.find(
                                (candidate) => candidate.id === row.id,
                              );
                              const actions =
                                member === undefined
                                  ? []
                                  : memberRowActions(member);
                              return (
                                <Fragment key={key}>
                                  <TableExpandRow {...definedProps(rowProps)}>
                                    {row.cells.map((cell) => (
                                      <TableCell key={cell.id}>
                                        {cell.info.header === 'status' ? (
                                          <Tag
                                            size="sm"
                                            type={
                                              cell.value === 'inactive'
                                                ? 'gray'
                                                : 'green'
                                            }
                                          >
                                            {statusLabels[
                                              cell.value as MemberStatus
                                            ] ?? cell.value}
                                          </Tag>
                                        ) : (
                                          cell.value
                                        )}
                                      </TableCell>
                                    ))}
                                    <TableCell className="cds--table-column-menu">
                                      {actions.length > 0 ? (
                                        <OverflowMenu
                                          flipped
                                          iconDescription={t(
                                            'members.table.actionsFor',
                                            { name: member?.name ?? '' },
                                          )}
                                        >
                                          {actions.map((action) => (
                                            <OverflowMenuItem
                                              itemText={action.label}
                                              key={action.id}
                                              onClick={action.onClick}
                                              {...(action.isDelete === true
                                                ? {
                                                    hasDivider: true,
                                                    isDelete: true,
                                                  }
                                                : {})}
                                            />
                                          ))}
                                        </OverflowMenu>
                                      ) : null}
                                    </TableCell>
                                  </TableExpandRow>
                                  {row.isExpanded ? (
                                    <TableExpandedRow
                                      colSpan={headers.length + 2}
                                      {...getExpandedRowProps({ row })}
                                    >
                                      {member === undefined ? null : (
                                        <div className={styles.memberDetails!}>
                                          <dl>
                                            <div>
                                              <dt>
                                                {t(
                                                  'members.list.rolePermissions',
                                                )}
                                              </dt>
                                              <dd>{roleHelp[member.role]}</dd>
                                            </div>
                                            <div>
                                              <dt>
                                                {t('members.list.scopeDetails')}
                                              </dt>
                                              <dd>
                                                {scopeExpandedDetail(
                                                  member.userId,
                                                )}
                                              </dd>
                                            </div>
                                          </dl>
                                        </div>
                                      )}
                                    </TableExpandedRow>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <Pagination
                          onChange={({ page, pageSize }) => {
                            setMemberPage(page);
                            setMemberPageSize(pageSize);
                          }}
                          page={memberPage}
                          pageSize={memberPageSize}
                          pageSizes={pageSizeChoices}
                          size="md"
                          totalItems={rows.length}
                        />
                      </TableContainer>
                    );
                  }}
                </DataTable>
              )}
            </TabPanel>
            <TabPanel className={styles.tabPanel!}>
              {invitations.length === 0 ? (
                <Tile>
                  <p>{t('members.invitations.empty')}</p>
                  {canManageMembers ? (
                    <Button
                      onClick={() => {
                        openInvite();
                      }}
                      renderIcon={UserFollow}
                      type="button"
                    >
                      {t('members.list.inviteAction')}
                    </Button>
                  ) : null}
                </Tile>
              ) : (
                <DataTable
                  headers={invitationHeaders}
                  isSortable
                  rows={invitationRows}
                >
                  {({
                    getHeaderProps,
                    getTableContainerProps,
                    getTableProps,
                    getToolbarProps,
                    headers,
                    onInputChange,
                    rows,
                  }) => {
                    const start = (invitationPage - 1) * invitationPageSize;
                    const pageRows = rows.slice(
                      start,
                      start + invitationPageSize,
                    );
                    return (
                      <TableContainer
                        className={styles.tableContainer!}
                        title={t('members.invitations.title', {
                          count: visibleInvitations.length,
                        })}
                        {...getTableContainerProps()}
                      >
                        <TableToolbar {...definedProps(getToolbarProps())}>
                          <TableToolbarContent>
                            <TableToolbarSearch
                              id="pending-invitations-search"
                              labelText={t('members.table.searchInvitations')}
                              onChange={(event) => {
                                onInputChange(event);
                                setInvitationPage(1);
                              }}
                              persistent
                              placeholder={t('members.table.searchInvitations')}
                            />
                            <FilterButton
                              activeCount={invitationAppliedCount}
                              applyLabel={t('members.table.applyFilters')}
                              groups={invitationFilterGroups}
                              idPrefix="pending-invitations"
                              label={t('members.table.filter')}
                              onApply={applyInvitationFilter}
                              onOpenChange={openInvitationFilter}
                              onReset={resetInvitationStaged}
                              onToggle={(groupKey, id, checked) => {
                                stageToggle(
                                  setInvitationStaged,
                                  groupKey,
                                  id,
                                  checked,
                                );
                              }}
                              open={invitationFilterOpen}
                              resetLabel={t('members.table.resetFilters')}
                              staged={invitationStaged}
                            />
                            <Button
                              kind="ghost"
                              onClick={exportInvitationsCsv}
                              renderIcon={Download}
                              type="button"
                            >
                              {t('members.table.exportCsv')}
                            </Button>
                            {canManageMembers ? (
                              <Button
                                onClick={() => {
                                  openInvite();
                                }}
                                renderIcon={UserFollow}
                                type="button"
                              >
                                {t('members.list.inviteAction')}
                              </Button>
                            ) : null}
                          </TableToolbarContent>
                        </TableToolbar>
                        <Table {...getTableProps()}>
                          <TableHead>
                            <TableRow>
                              {headers.map((header) => {
                                const { key, ...headerProps } = getHeaderProps({
                                  header,
                                });
                                return (
                                  <TableHeader
                                    key={key}
                                    {...definedProps(headerProps)}
                                  >
                                    {header.header}
                                  </TableHeader>
                                );
                              })}
                              <TableHeader
                                aria-label={t('members.table.rowActions')}
                              />
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {pageRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={headers.length + 1}>
                                  {t('members.table.noResults')}
                                </TableCell>
                              </TableRow>
                            ) : null}
                            {pageRows.map((row) => {
                              const invitation = invitations.find(
                                (candidate) => candidate.id === row.id,
                              );
                              const actions =
                                invitation === undefined
                                  ? []
                                  : invitationRowActions(invitation);
                              return (
                                <TableRow key={row.id}>
                                  {row.cells.map((cell) => (
                                    <TableCell key={cell.id}>
                                      {cell.value}
                                    </TableCell>
                                  ))}
                                  <TableCell className="cds--table-column-menu">
                                    {actions.length > 0 ? (
                                      <OverflowMenu
                                        flipped
                                        iconDescription={t(
                                          'members.table.actionsFor',
                                          { name: invitation?.email ?? '' },
                                        )}
                                      >
                                        {actions.map((action) => (
                                          <OverflowMenuItem
                                            itemText={action.label}
                                            key={action.id}
                                            onClick={action.onClick}
                                            {...(action.isDelete === true
                                              ? {
                                                  hasDivider: true,
                                                  isDelete: true,
                                                }
                                              : {})}
                                          />
                                        ))}
                                      </OverflowMenu>
                                    ) : null}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <Pagination
                          onChange={({ page, pageSize }) => {
                            setInvitationPage(page);
                            setInvitationPageSize(pageSize);
                          }}
                          page={invitationPage}
                          pageSize={invitationPageSize}
                          pageSizes={pageSizeChoices}
                          size="md"
                          totalItems={rows.length}
                        />
                      </TableContainer>
                    );
                  }}
                </DataTable>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}

      <Modal
        modalHeading={t('members.invite.title')}
        onRequestClose={() => {
          setInviteOpen(false);
        }}
        onRequestSubmit={() => {
          void submitInvite();
        }}
        open={inviteOpen}
        primaryButtonDisabled={submitting || inviteEmail.trim().length === 0}
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
          primaryButtonDisabled={submitting}
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
