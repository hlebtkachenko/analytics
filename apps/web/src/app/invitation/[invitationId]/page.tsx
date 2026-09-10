import { Link, Stack, Tile } from '@bap/design-system/react';
import { headers } from 'next/headers';

import { translate } from '../../../i18n/server';
import { getAuth } from '../../../lib/auth/server';
import InvitationClient from './invitation-client';

export default async function InvitationPage() {
  const auth = await getAuth().catch(() => null);
  const session = await auth?.api
    .getSession({ headers: await headers() })
    .catch(() => null);

  if (session !== null && session !== undefined) {
    return <InvitationClient />;
  }

  const signedOutTitle = await translate('invitation.signedOutTitle');
  const signedOutGuidance = await translate('invitation.signedOutGuidance');
  const signInLink = await translate('invitation.signInLink');
  const signUpLink = await translate('invitation.signUpLink');

  return (
    <main>
      <Stack gap={7}>
        <h1>{signedOutTitle}</h1>
        <Tile>
          <Stack gap={5}>
            <p>{signedOutGuidance}</p>
            <Link href="/sign-in">{signInLink}</Link>
            <Link href="/sign-up">{signUpLink}</Link>
          </Stack>
        </Tile>
      </Stack>
    </main>
  );
}
