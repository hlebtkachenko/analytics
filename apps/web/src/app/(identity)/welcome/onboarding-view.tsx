'use client';

import {
  Button,
  Form,
  InlineNotification,
  Link,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../../lib/auth/client';
import { acceptOrganizationInvitationAction } from '../../../lib/organizations/actions';

export type OnboardingInvitation = Readonly<{
  id: string;
  organizationName: string;
}>;

type OnboardingViewProperties = Readonly<{
  invitations: readonly OnboardingInvitation[];
  name: string;
}>;

export default function OnboardingView({
  invitations,
  name,
}: OnboardingViewProperties) {
  const { t } = useTranslation();
  const [profileName, setProfileName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'error' | 'idle' | 'saved'>(
    'idle',
  );

  async function saveName(): Promise<void> {
    const trimmed = profileName.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSaving(true);
    setSaveState('idle');
    const result = await authClient.updateUser({ name: trimmed });
    setSaving(false);
    setSaveState(result.error ? 'error' : 'saved');
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('welcome.title')}</h1>
        <p>{t('welcome.summary')}</p>

        <section aria-labelledby="onboarding-profile-heading">
          <Stack gap={5}>
            <h2 id="onboarding-profile-heading">{t('welcome.profileTitle')}</h2>
            <p>{t('welcome.profileSummary')}</p>
            <Form aria-label={t('welcome.profileTitle')}>
              <Stack gap={5}>
                <TextInput
                  autoComplete="name"
                  helperText={t('welcome.nameHelper')}
                  id="onboarding-name"
                  labelText={t('welcome.nameLabel')}
                  onChange={(event) => {
                    setProfileName(event.target.value);
                    setSaveState('idle');
                  }}
                  value={profileName}
                />
                {saveState === 'saved' ? (
                  <InlineNotification
                    hideCloseButton
                    kind="success"
                    lowContrast
                    title={t('welcome.nameSaved')}
                  />
                ) : null}
                {saveState === 'error' ? (
                  <InlineNotification
                    hideCloseButton
                    kind="error"
                    lowContrast
                    role="alert"
                    title={t('welcome.nameError')}
                  />
                ) : null}
                <Button
                  disabled={saving || profileName.trim().length === 0}
                  onClick={() => {
                    void saveName();
                  }}
                  type="button"
                >
                  {t('welcome.saveName')}
                </Button>
              </Stack>
            </Form>
          </Stack>
        </section>

        {invitations.length > 0 ? (
          <section aria-labelledby="onboarding-invitations-heading">
            <Stack gap={5}>
              <h2 id="onboarding-invitations-heading">
                {t('welcome.invitationsTitle')}
              </h2>
              <p>{t('welcome.invitationsSummary')}</p>
              {invitations.map((invitation) => (
                <Form
                  action={acceptOrganizationInvitationAction}
                  aria-label={invitation.organizationName}
                  key={invitation.id}
                >
                  <Stack gap={3}>
                    <p>{invitation.organizationName}</p>
                    <input
                      name="invitationId"
                      type="hidden"
                      value={invitation.id}
                    />
                    <Button size="sm" type="submit">
                      {t('welcome.accept')}
                    </Button>
                  </Stack>
                </Form>
              ))}
            </Stack>
          </section>
        ) : null}

        <Link href="/access">{t('welcome.continue')}</Link>
      </Stack>
    </main>
  );
}
