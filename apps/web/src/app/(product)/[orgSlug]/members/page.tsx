import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import { getAuth } from '../../../../lib/auth/server';
import {
  readLegalEntities,
  readMemberEntityScopes,
  readOrganizationAccess,
} from '../../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../../lib/organizations/resolver';
import MembersView from './members-view';
import type { InvitationRow, MemberRole, MemberRow } from './members-view';

// A role from the provider maps to the three assignable roles, otherwise member.
function asRole(value: string): MemberRole {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

// A member is active unless the provider reports the inactive status.
function asStatus(value: string | undefined): 'active' | 'inactive' {
  return value === 'inactive' ? 'inactive' : 'active';
}

// A stored date renders as a plain calendar date, consistent with the other lists.
function isoDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString().slice(0, 10);
}

type RawMember = {
  createdAt?: Date | string;
  id: string;
  role: string;
  status?: string;
  user: { email: string; name: string };
  userId: string;
};

type RawInvitation = {
  email: string;
  expiresAt?: Date | string;
  id: string;
  role: string;
  status: string;
};

function mapMember(member: RawMember): MemberRow {
  return {
    email: member.user.email,
    id: member.id,
    joinedAt: isoDate(member.createdAt),
    name: member.user.name,
    role: asRole(member.role),
    status: asStatus(member.status),
    userId: member.userId,
  };
}

function mapInvitation(invitation: RawInvitation): InvitationRow {
  return {
    email: invitation.email,
    expiresAt: isoDate(invitation.expiresAt),
    id: invitation.id,
    role: asRole(invitation.role),
  };
}

export default async function OrganizationMembersPage({
  params,
}: Readonly<{ params: Promise<{ orgSlug: string }> }>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  const auth = await getAuth();
  const requestHeaders = await headers();

  // Capabilities only choose which controls render, Better Auth and the API enforce access.
  const [access, session] = await Promise.all([
    readOrganizationAccess(organization.id),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  const capabilities = access?.capabilities;
  const canManageMembers = capabilities?.manageMembers ?? false;
  const canManageEntityAccess = capabilities?.manageEntityAccess ?? false;

  const [memberResult, invitationResult] = await Promise.allSettled([
    auth.api.listMembers({
      headers: requestHeaders,
      query: { limit: 100, organizationId: organization.id },
    }),
    auth.api.listInvitations({
      headers: requestHeaders,
      query: { organizationId: organization.id },
    }),
  ]);
  const loadError =
    memberResult.status === 'rejected' ||
    invitationResult.status === 'rejected';

  const members =
    memberResult.status === 'fulfilled'
      ? memberResult.value.members.map(mapMember)
      : [];
  const invitations =
    invitationResult.status === 'fulfilled'
      ? invitationResult.value
          .filter((invitation) => invitation.status === 'pending')
          .map(mapInvitation)
      : [];

  // One entity list and one bulk scope read, never one request per listed member.
  const [legalEntities, memberScopes] = canManageEntityAccess
    ? await Promise.all([
        readLegalEntities(organization.id),
        readMemberEntityScopes(organization.id),
      ])
    : [null, null];
  // A failed read must never render as unrestricted access, so the editor is withheld.
  const scopeEditorAvailable = legalEntities !== null && memberScopes !== null;
  const scopeEntries =
    memberScopes === null
      ? []
      : [...memberScopes].map(([userId, scope]) => ({ scope, userId }));

  return (
    <PageContainer>
      <MembersView
        canManageEntityAccess={canManageEntityAccess}
        canManageMembers={canManageMembers}
        currentUserId={session?.user.id ?? null}
        initialInvitations={invitations}
        initialMembers={members}
        initialScopes={scopeEntries}
        legalEntities={legalEntities ?? []}
        loadError={loadError}
        organizationId={organization.id}
        scopeEditorAvailable={scopeEditorAvailable}
        workspaceName={organization.name}
      />
    </PageContainer>
  );
}
