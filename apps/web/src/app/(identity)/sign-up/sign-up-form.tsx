'use client';

import { UserFollow } from '@bap/design-system/icons';
import {
  Button,
  Form,
  InlineNotification,
  PasswordInput,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../../lib/auth/client';

type SignUpFormProperties = Readonly<{
  enabled: boolean;
}>;

export default function SignUpForm({ enabled }: SignUpFormProperties) {
  const { t } = useTranslation();
  const [state, setState] = useState<'error' | 'form' | 'success'>('form');

  async function submit(formData: FormData): Promise<void> {
    setState('form');
    try {
      const result = await authClient.signUp.email({
        callbackURL: '/activate',
        email: String(formData.get('email') ?? ''),
        name: String(formData.get('name') ?? ''),
        password: String(formData.get('password') ?? ''),
      });
      setState(result.error ? 'error' : 'success');
    } catch {
      setState('error');
    }
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('signUp.title')}</h1>
        <p>{t('signUp.summary')}</p>
        {!enabled ? (
          <InlineNotification
            hideCloseButton
            kind="info"
            lowContrast
            title={t('signUp.closed')}
          />
        ) : null}
        {enabled && state === 'success' ? (
          <InlineNotification
            hideCloseButton
            kind="success"
            lowContrast
            subtitle={t('signUp.successBody')}
            title={t('signUp.successTitle')}
          />
        ) : null}
        {enabled && state !== 'success' ? (
          <Form action={submit} aria-label={t('signUp.title')}>
            <Stack gap={5}>
              <TextInput
                autoComplete="name"
                id="name"
                labelText={t('signUp.name')}
                name="name"
                required
              />
              <TextInput
                autoComplete="email"
                id="email"
                labelText={t('signUp.email')}
                name="email"
                required
                type="email"
              />
              <PasswordInput
                autoComplete="new-password"
                helperText={t('signUp.passwordHelper')}
                id="password"
                labelText={t('signUp.password')}
                maxLength={128}
                minLength={14}
                name="password"
                required
                size="lg"
              />
              {state === 'error' ? (
                <InlineNotification
                  hideCloseButton
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('signUp.failed')}
                />
              ) : null}
              <Button renderIcon={UserFollow} type="submit">
                {t('signUp.submit')}
              </Button>
            </Stack>
          </Form>
        ) : null}
      </Stack>
    </main>
  );
}
