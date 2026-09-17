'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow, RowAction } from '@bap/design-system/blocks';
import type { Route } from 'next';
import {
  Button,
  FilterableMultiSelect,
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
  Tile,
} from '@bap/design-system/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useToast } from '../../../../components/shell/toast';
import { authClient } from '../../../../lib/auth/client';
import {
  memberEntityScopePath,
  mutateJson,
} from '../../../../lib/datasets/client';
import type { LegalEntity } from '../../../../lib/datasets/client';
import styles from './members-view.module.scss';

export type MemberRole = 'admin' | 'member' | 'owner';

export type EntityScope =
  | Readonly<{ mode: 'all' }>
  | Readonly<{ legalEntityIds: readonly string[]; mode: 'restricted' }>;

export type MemberRow = Readonly<{
  email: string;
  id: string;
  joinedAt: string;
  name: string;
  role: MemberRole;
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

const emailSchema = z.email().max(254);

// The member and invitation lists re-read from Better Auth, validated at the boundary.
const memberListSchema = z.object({
  members: z.array(
    z.object({
      createdAt: z.union([z.string(), z.date()]).optional(),
      id: z.string().min(1),
      role: z.string(),
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

  const roleLabels: Readonly<Record<MemberRole, string>> = {
    admin: t('members.roles.admin'),
    member: t('members.roles.member'),
    owner: t('members.roles.owner'),
  };

  const now = Date.now();
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

  const memberColumns: readonly GridColumn[] = [
    { header: t('members.list.columnName'), key: 'name', sortable: true },
    { header: t('members.list.columnEmail'), key: 'email', sortable: true },
    { header: t('members.list.columnRole'), key: 'role', sortable: true },
    { header: t('members.list.columnScope'), key: 'scope' },
    { header: t('members.list.columnJoined'), key: 'joined', sortable: true },
  ];

  const memberRows: readonly GridRow[] = members.map((member) => ({
    email: member.email,
    id: member.id,
    joined: member.joinedAt,
    name: member.name,
    role: roleLabels[member.role],
    scope: scopeSummary(member.userId),
  }));

  const invitationColumns: readonly GridColumn[] = [
    {
      header: t('members.invitations.columnEmail'),
      key: 'email',
      sortable: true,
    },
    {
      header: t('members.invitations.columnRole'),
      key: 'role',
      sortable: true,
    },
    {
      header: t('members.invitations.columnExpires'),
      key: 'expires',
      sortable: true,
    },
  ];

  const invitationRows: readonly GridRow[] = invitations.map((invitation) => ({
    email: invitation.email,
    expires:
      invitation.expiresAt !== '' &&
      new Date(invitation.expiresAt).getTime() < now
        ? t('members.invitations.expired')
        : isoDate(invitation.expiresAt),
    id: invitation.id,
    role: roleLabels[invitation.role],
  }));

  const inviteToolbar = canManageMembers
    ? [
        {
          id: 'invite-member',
          label: t('members.list.inviteAction'),
          onClick: () => {
            openInvite();
          },
        },
      ]
    : undefined;

  function memberRowActions(row: GridRow): readonly RowAction[] {
    const member = members.find((candidate) => candidate.id === row.id);
    if (member === undefined) {
      return [];
    }
    const actions: RowAction[] = [];
    if (canManageMembers) {
      actions.push({
        id: 'change-role',
        label: t('members.actions.changeRole'),
        onClick: () => {
          openRole(member);
        },
      });
    }
    // The API answers 409 for an owner target, so the owner is always all entities.
    if (
      canManageEntityAccess &&
      scopeEditorAvailable &&
      member.role !== 'owner'
    ) {
      actions.push({
        id: 'edit-scope',
        label: t('members.actions.editScope'),
        onClick: () => {
          openScope(member);
        },
      });
    }
    // Leaving the workspace is the settings flow, so the caller never removes self.
    if (canManageMembers && member.userId !== currentUserId) {
      actions.push({
        id: 'remove-member',
        isDelete: true,
        label: t('members.actions.remove'),
        onClick: () => {
          setRemoveTarget(member);
        },
      });
    }
    return actions;
  }

  function invitationRowActions(row: GridRow): readonly RowAction[] {
    if (!canManageMembers) {
      return [];
    }
    const invitation = invitations.find((candidate) => candidate.id === row.id);
    if (invitation === undefined) {
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

  async function confirmRemove(): Promise<void> {
    const target = removeTarget;
    if (target === null) {
      return;
    }
    setSubmitting(true);
    const result = await authClient.organization.removeMember({
      memberIdOrEmail: target.id,
      organizationId,
    });
    setSubmitting(false);
    setRemoveTarget(null);

    if (!result.error) {
      notify({ kind: 'success', title: t('members.toast.removeSuccess') });
      await reloadMembers();
      return;
    }

    if (
      result.error.code ===
      'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER'
    ) {
      notify({ kind: 'error', title: t('members.remove.lastOwner') });
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
                      type="button"
                    >
                      {t('members.list.inviteAction')}
                    </Button>
                  ) : null}
                </Tile>
              ) : (
                <DataGrid
                  columns={memberColumns}
                  initialSort={[{ direction: 'ASC', key: 'name' }]}
                  rowActions={memberRowActions}
                  rows={memberRows}
                  search
                  size="sm"
                  sortable
                  {...(inviteToolbar === undefined
                    ? {}
                    : { toolbarActions: inviteToolbar })}
                />
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
                      type="button"
                    >
                      {t('members.list.inviteAction')}
                    </Button>
                  ) : null}
                </Tile>
              ) : (
                <DataGrid
                  columns={invitationColumns}
                  initialSort={[{ direction: 'ASC', key: 'email' }]}
                  rows={invitationRows}
                  size="sm"
                  sortable
                  {...(canManageMembers
                    ? { rowActions: invitationRowActions }
                    : {})}
                  {...(inviteToolbar === undefined
                    ? {}
                    : { toolbarActions: inviteToolbar })}
                />
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
              <FilterableMultiSelect
                id="scope-entities"
                items={[...legalEntities]}
                itemToString={(item) =>
                  (item as LegalEntity | null)?.name ?? ''
                }
                onChange={({ selectedItems }) => {
                  setScopeSelection(
                    (selectedItems ?? []) as readonly LegalEntity[],
                  );
                }}
                selectedItems={[...scopeSelection]}
                titleText={t('members.scope.entitiesLabel')}
              />
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
        >
          <p>{t('members.cancelInvite.body')}</p>
        </Modal>
      ) : null}
    </>
  );
}
