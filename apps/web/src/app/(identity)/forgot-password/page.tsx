'use client';

import { Email } from '@bap/design-system/icons';
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

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<'error' | 'form' | 'success'>('form');

  async function submit(formData: FormData): Promise<void> {
    setState('form');
    try {
      const result = await authClient.requestPasswordReset({
        email: String(formData.get('email') ?? ''),
        redirectTo: '/reset-password',
      });
      setState(result.error ? 'error' : 'success');
    } catch {
      setState('error');
    }
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('forgotPassword.title')}</h1>
        <p>{t('forgotPassword.summary')}</p>
        {state === 'success' ? (
          <InlineNotification
            hideCloseButton
            kind="success"
            lowContrast
            subtitle={t('forgotPassword.successBody')}
            title={t('forgotPassword.successTitle')}
          />
        ) : (
          <Form action={submit} aria-label={t('forgotPassword.title')}>
            <Stack gap={5}>
              <TextInput
                autoComplete="email"
                id="email"
                labelText={t('forgotPassword.email')}
                name="email"
                required
                type="email"
              />
              {state === 'error' ? (
                <InlineNotification
                  hideCloseButton
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('forgotPassword.failed')}
                />
              ) : null}
              <Button renderIcon={Email} type="submit">
                {t('forgotPassword.submit')}
              </Button>
            </Stack>
          </Form>
        )}
        <Link href="/sign-in">{t('forgotPassword.backToSignIn')}</Link>
      </Stack>
    </main>
  );
}
