import { getOrganizationCreationQuota } from '@bap/db/access';
import { Button, InlineNotification } from '@bap/design-system/react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import { translate } from '../../../../i18n/server';
import { getAuth, getAuthPool } from '../../../../lib/auth/server';
import CreateWorkspaceWizard from './create-workspace-wizard';
import styles from './page.module.scss';

export default async function NewOrganizationPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ result?: string }> }>) {
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
  const { result } = await searchParams;

  const title = await translate('workspaces.create.title');
  const back = await translate('workspaces.create.back');
  const quotaRemaining = await translate('workspaces.create.quotaRemaining', {
    remaining,
  });
  const quotaExhausted = await translate('workspaces.create.quotaExhausted');

  return (
    <PageContainer>
      <h1>{title}</h1>
      <Button href="/workspaces" kind="ghost">
        {back}
      </Button>
      <p>{quotaRemaining}</p>
      {remaining === 0 || result === 'quota-exhausted' ? (
        <div className={styles.notification}>
          <InlineNotification
            hideCloseButton
            kind="warning"
            lowContrast
            title={quotaExhausted}
          />
        </div>
      ) : (
        <CreateWorkspaceWizard initialName={session.user.name} />
      )}
    </PageContainer>
  );
}
