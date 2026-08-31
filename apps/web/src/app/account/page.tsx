// Temporary account UI: delete when the Carbon account screen lands.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '../../lib/auth/server';
import AccountActions from './account-actions';

export default async function AccountPage() {
  let email: string | undefined;

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });

    email = session?.user.email;
  } catch {
    // Session failures are handled as signed-out state.
  }

  if (!email) {
    redirect('/sign-in');
    return null;
  }

  return <AccountActions email={email} />;
}
