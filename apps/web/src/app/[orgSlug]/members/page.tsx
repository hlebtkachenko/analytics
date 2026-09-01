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
  const canManage =
    organization.role === 'owner' || organization.role === 'admin';
  const assignableRoles =
    organization.role === 'owner'
      ? (['owner', 'admin', 'member'] as const)
      : (['admin', 'member'] as const);
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

  return (
    <main>
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
              const canManageTarget =
                organization.role === 'owner' ||
                (organization.role === 'admin' && member.role !== 'owner');

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
