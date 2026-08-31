import { InlineNotification, Link, Stack } from '@bap/design-system/react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { translate } from '../../../i18n/server';
import { getAuth } from '../../../lib/auth/server';

type ActivatePageProperties = Readonly<{
  searchParams: Promise<{ state?: string | string[] }>;
}>;

export default async function ActivatePage({
  searchParams,
}: ActivatePageProperties) {
  const query = await searchParams;
  const title = await translate('activate.title');

  if (query.state === 'invalid') {
    const invalidBody = await translate('activate.invalidBody');
    const invalidTitle = await translate('activate.invalidTitle');
    const signIn = await translate('activate.signIn');
    return (
      <main>
        <Stack gap={7}>
          <h1>{title}</h1>
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            role="alert"
            subtitle={invalidBody}
            title={invalidTitle}
          />
          <Link href="/sign-in">{signIn}</Link>
        </Stack>
      </main>
    );
  }

  let authenticated = false;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    authenticated = Boolean(session);
  } catch {
    // Treat an unavailable session boundary like an absent session.
  }
  if (authenticated) {
    redirect('/welcome');
    return null;
  }

  const noSessionBody = await translate('activate.noSessionBody');
  const noSessionTitle = await translate('activate.noSessionTitle');
  const signIn = await translate('activate.signIn');

  return (
    <main>
      <Stack gap={7}>
        <h1>{title}</h1>
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          subtitle={noSessionBody}
          title={noSessionTitle}
        />
        <Link href="/sign-in">{signIn}</Link>
      </Stack>
    </main>
  );
}
