import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '../../../lib/auth/server';
import OnboardingView from './onboarding-view';
import type { OnboardingInvitation } from './onboarding-view';

export default async function WelcomePage() {
  const requestHeaders = await headers();

  let user: Readonly<{ name: string }> | null = null;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session) {
      user = { name: session.user.name ?? '' };
    }
  } catch {
    user = null;
  }

  if (user === null) {
    redirect('/sign-in');
    return null;
  }

  // Surface any pending invitation from the same source the organizations page reads.
  let invitations: OnboardingInvitation[] = [];
  try {
    const auth = await getAuth();
    const pending = await auth.api.listUserInvitations({
      headers: requestHeaders,
    });
    invitations = pending.map((invitation) => ({
      id: invitation.id,
      organizationName: invitation.organizationName,
    }));
  } catch {
    invitations = [];
  }

  return <OnboardingView invitations={invitations} name={user.name} />;
}
