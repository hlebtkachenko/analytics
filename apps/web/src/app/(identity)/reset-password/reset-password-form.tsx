'use client';

import {
  Button,
  Form,
  InlineNotification,
  Link,
  PasswordInput,
  Stack,
} from '@bap/design-system/react';
import { useActionState } from 'react';
import { useTranslation } from 'react-i18next';

import { resetPassword } from './actions';
import type { ResetPasswordState } from './actions';

type ResetPasswordFormProperties = Readonly<{
  available: boolean;
}>;

export default function ResetPasswordForm({
  available,
}: ResetPasswordFormProperties) {
  const { t } = useTranslation();
  const [state, formAction, pending] = useActionState<
    ResetPasswordState,
    FormData
  >(resetPassword, { status: 'form' });

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('resetPassword.title')}</h1>
        {!available && state.status !== 'success' ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            role="alert"
            title={t('resetPassword.invalid')}
          />
        ) : null}
        {state.status === 'success' ? (
          <InlineNotification
            hideCloseButton
            kind="success"
            lowContrast
            subtitle={t('resetPassword.successBody')}
            title={t('resetPassword.successTitle')}
          />
        ) : null}
        {available && state.status !== 'success' ? (
          <Form action={formAction} aria-label={t('resetPassword.title')}>
            <Stack gap={5}>
              <PasswordInput
                autoComplete="new-password"
                helperText={t('resetPassword.passwordHelper')}
                id="new-password"
                labelText={t('resetPassword.newPassword')}
                maxLength={128}
                minLength={14}
                name="newPassword"
                required
              />
              <PasswordInput
                autoComplete="new-password"
                id="confirm-password"
                labelText={t('resetPassword.confirmPassword')}
                maxLength={128}
                minLength={14}
                name="confirmPassword"
                required
              />
              {state.status === 'error' ? (
                <InlineNotification
                  hideCloseButton
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('resetPassword.failed')}
                />
              ) : null}
              <Button disabled={pending} type="submit">
                {t('resetPassword.submit')}
              </Button>
            </Stack>
          </Form>
        ) : null}
        <Link href="/forgot-password">{t('resetPassword.requestNew')}</Link>
      </Stack>
    </main>
  );
}
