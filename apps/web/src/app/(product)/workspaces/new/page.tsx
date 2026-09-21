import { getOrganizationCreationQuota } from '@bap/db/access';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import { translate } from '../../../../i18n/server';
import { getAuth, getAuthPool } from '../../../../lib/auth/server';
import CreateWorkspaceWizard from './create-workspace-wizard';

export default async function NewOrganizationPage() {
  const auth = await getAuth().catch(() => null);
  if (auth === null) {
    redirect('/sign-in');
  }
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session?.user.emailVerified !== true) {
    redirect('/sign-in');
  }

  const quota = await getOrganizationCreationQuota(
    await getAuthPool(),
    session.user.id,
  ).catch(() => null);
  const remaining = quota?.remainingTotal ?? 0;

  const title = await translate('workspaces.create.title');

  return (
    <PageContainer>
      <h1>{title}</h1>
      <CreateWorkspaceWizard
        initialName={session.user.name}
        remaining={remaining}
      />
    </PageContainer>
  );
}
