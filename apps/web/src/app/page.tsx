import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '../lib/auth/server';

export default async function HomePage() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session?.user.emailVerified ? '/access' : '/sign-in');
}
