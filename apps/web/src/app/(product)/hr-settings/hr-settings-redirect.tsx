'use client';

import { InlineNotification } from '@bap/design-system/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function HrSettingsRedirect() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const organization = searchParams.get('organization');
  useEffect(() => {
    router.replace(
      `/hr-settings/structure${organization ? `?organization=${encodeURIComponent(organization)}` : ''}` as never,
    );
  }, [organization, router]);
  return (
    <InlineNotification
      kind="info"
      hideCloseButton
      title={t('hrSettings.loading')}
    />
  );
}
