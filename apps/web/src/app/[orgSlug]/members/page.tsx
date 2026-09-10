// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getAuth } from '../../../lib/auth/server';
import {
  inviteOrganizationMemberAction,
  removeOrganizationMemberAction,
  updateOrganizationMemberRoleAction,
} from '../../../lib/organizations/actions';
import { updateMemberEntityScopeAction } from '../../../lib/organizations/entity-actions';
import {
  readLegalEntities,
  readMemberEntityScopes,
} from '../../../lib/organizations/entities';
import type { EntityScope } from '../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../lib/organizations/resolver';

export default async function OrganizationMembersPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ result?: string }>;
}>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  const auth = await getAuth();
  const requestHeaders = await headers();
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
  const failed =
    memberResult.status === 'rejected' ||
    invitationResult.status === 'rejected';
  const members =
    memberResult.status === 'fulfilled' ? memberResult.value : null;
  const invitations =
    invitationResult.status === 'fulfilled' ? invitationResult.value : null;
  // ADR 0011 leaves membership, invitations and entity access with the owner alone.
  const canManage = organization.role === 'owner';
  const assignableRoles = ['owner', 'admin', 'member'] as const;
  // One entity list and one bulk scope read, never one request per listed member.
  const [legalEntities, memberScopes] = canManage
    ? await Promise.all([
        readLegalEntities(organization.id),
        readMemberEntityScopes(organization.id),
      ])
    : [null, null];
  // A failed read must never be shown as unrestricted access, so the editor is withheld.
  const scopeEditorAvailable = legalEntities !== null && memberScopes !== null;
  const { result } = await searchParams;
  const invite = inviteOrganizationMemberAction.bind(null, organization.slug);
  const updateRole = updateOrganizationMemberRoleAction.bind(
    null,
    organization.slug,
  );
  const removeMember = removeOrganizationMemberAction.bind(
    null,
    organization.slug,
  );
  const updateEntityScope = updateMemberEntityScopeAction.bind(
    null,
    organization.slug,
  );

  return (
    <main id="main-content" tabIndex={-1}>
      <nav aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/organizations">Organizations</Link>
          </li>
          <li>
            <Link href={`/${organization.slug}`}>{organization.name}</Link>
          </li>
          <li aria-current="page">Members</li>
        </ol>
      </nav>
      <h1>{organization.name} members</h1>
      <p>
        <Link href={`/${organization.slug}`}>Back to organization</Link>
      </p>
      {result === 'success' ? (
        <p role="status">The organization membership was updated.</p>
      ) : null}
      {result === 'error' || failed ? (
        <p role="alert">The organization membership could not be updated.</p>
      ) : null}
      {canManage && !failed ? (
        <section aria-labelledby="invite-member-heading">
          <h2 id="invite-member-heading">Invite member</h2>
          <form action={invite} aria-label="Invite member">
            <p>
              <label htmlFor="invitation-email">Email</label>
              <input
                autoComplete="email"
                id="invitation-email"
                name="email"
                required
                type="email"
              />
            </p>
            <p>
              <label htmlFor="invitation-role">Role</label>
              <select defaultValue="member" id="invitation-role" name="role">
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role[0]?.toUpperCase()}
                    {role.slice(1)}
                  </option>
                ))}
              </select>
            </p>
            <button type="submit">Send invitation</button>
          </form>
        </section>
      ) : null}
      <section aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        {members?.members.length === 0 ? (
          <p>No members are available.</p>
        ) : null}
        {members !== null && members.members.length > 0 ? (
          <ul>
            {members.members.map((member) => {
              const canManageTarget = canManage;
              // Entity access is owner-managed, and an owner never restricts themselves.
              const offersScope = canManage && member.role !== 'owner';
              // A member without a stored scope row is unrestricted by contract.
              const scope: EntityScope = memberScopes?.get(member.userId) ?? {
                mode: 'all',
              };
              const restricted = scope.mode === 'restricted';
              const selectedEntities = new Set(
                scope.mode === 'restricted' ? scope.legalEntityIds : [],
              );

              return (
                <li key={member.id}>
                  <p>
                    {member.user.name} ({member.user.email}), {member.role}
                  </p>
                  {canManageTarget ? (
                    <>
                      <form
                        action={updateRole}
                        aria-label={`Change role for ${member.user.email}`}
                      >
                        <input
                          name="memberId"
                          type="hidden"
                          value={member.id}
                        />
                        <label htmlFor={`role-${member.id}`}>Role</label>
                        <select
                          defaultValue={member.role}
                          id={`role-${member.id}`}
                          name="role"
                        >
                          {assignableRoles.map((role) => (
                            <option key={role} value={role}>
                              {role[0]?.toUpperCase()}
                              {role.slice(1)}
                            </option>
                          ))}
                        </select>
                        <button type="submit">Change role</button>
                      </form>
                      <form
                        action={removeMember}
                        aria-label={`Remove ${member.user.email}`}
                      >
                        <input
                          name="memberId"
                          type="hidden"
                          value={member.id}
                        />
                        <button type="submit">Remove member</button>
                      </form>
                    </>
                  ) : null}
                  {offersScope && !scopeEditorAvailable ? (
                    <p>Entity access is unavailable.</p>
                  ) : null}
                  {offersScope && scopeEditorAvailable ? (
                    <form
                      action={updateEntityScope}
                      aria-label={`Entity access for ${member.user.email}`}
                    >
                      <input
                        name="userId"
                        type="hidden"
                        value={member.userId}
                      />
                      <fieldset>
                        <legend>Entity access</legend>
                        <p>
                          <input
                            defaultChecked={!restricted}
                            id={`scope-all-${member.id}`}
                            name="mode"
                            type="radio"
                            value="all"
                          />
                          <label htmlFor={`scope-all-${member.id}`}>
                            All entities
                          </label>
                        </p>
                        <p>
                          <input
                            defaultChecked={restricted}
                            id={`scope-restricted-${member.id}`}
                            name="mode"
                            type="radio"
                            value="restricted"
                          />
                          <label htmlFor={`scope-restricted-${member.id}`}>
                            Selected entities
                          </label>
                        </p>
                        {legalEntities.map((entity) => (
                          <p key={entity.id}>
                            <input
                              defaultChecked={selectedEntities.has(entity.id)}
                              id={`scope-${member.id}-${entity.id}`}
                              name="legalEntityIds"
                              type="checkbox"
                              value={entity.id}
                            />
                            <label htmlFor={`scope-${member.id}-${entity.id}`}>
                              {entity.name}
                            </label>
                          </p>
                        ))}
                      </fieldset>
                      <button type="submit">Save entity access</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <section aria-labelledby="invitations-heading">
        <h2 id="invitations-heading">Invitations</h2>
        {invitations?.length === 0 ? <p>No invitations are pending.</p> : null}
        {invitations !== null && invitations.length > 0 ? (
          <ul>
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                {invitation.email}, {invitation.role}, {invitation.status}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
