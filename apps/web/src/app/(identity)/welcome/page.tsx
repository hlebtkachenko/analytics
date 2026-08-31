import { Link, Stack } from '@bap/design-system/react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { translate } from '../../../i18n/server';
import { getAuth } from '../../../lib/auth/server';

export default async function WelcomePage() {
  let authenticated = false;
  try {
    const auth = await getAuth();
    authenticated = Boolean(
      await auth.api.getSession({ headers: await headers() }),
    );
  } catch {
    authenticated = false;
  }

  if (!authenticated) {
    redirect('/sign-in');
    return null;
  }

  const continueLabel = await translate('welcome.continue');
  const summary = await translate('welcome.summary');
  const title = await translate('welcome.title');

  return (
    <main>
      <Stack gap={7}>
        <h1>{title}</h1>
        <p>{summary}</p>
        <Link href="/access">{continueLabel}</Link>
      </Stack>
    </main>
  );
}
