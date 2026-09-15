'use client';

import { Checkmark } from '@bap/design-system/icons';
import {
  Button,
  Form,
  InlineNotification,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../../../lib/auth/client';
import { safeReturnPath } from '../../../../lib/auth/return-path';

// The challenge reads the next parameter, which a prerender cannot know.
export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorChallenge />
    </Suspense>
  );
}

function TwoFactorChallenge() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState(false);
  const returnPath = safeReturnPath(searchParams.get('next'));

  async function submit(formData: FormData): Promise<void> {
    setError(false);
    // The pending challenge is carried by the signed cookie the sign-in response set.
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: String(formData.get('code') ?? ''),
      });
      if (result.error) {
        setError(true);
        return;
      }
      router.replace(returnPath as Route);
    } catch {
      setError(true);
    }
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('twoFactor.title')}</h1>
        <p>{t('twoFactor.summary')}</p>
        <Form action={submit} aria-label={t('twoFactor.title')}>
          <Stack gap={5}>
            <TextInput
              autoComplete="one-time-code"
              id="code"
              inputMode="numeric"
              labelText={t('twoFactor.code')}
              name="code"
              required
            />
            {error ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={t('twoFactor.failed')}
              />
            ) : null}
            <Button renderIcon={Checkmark} type="submit">
              {t('twoFactor.verify')}
            </Button>
          </Stack>
        </Form>
      </Stack>
    </main>
  );
}
