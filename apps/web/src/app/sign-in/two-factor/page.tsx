'use client';

import { Button, Form, Stack, TextInput } from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../../lib/auth/client';

export default function TwoFactorPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState(false);

  async function submit(formData: FormData): Promise<void> {
    setError(false);
    // The pending challenge is carried by the signed cookie the sign-in response set.
    const result = await authClient.twoFactor.verifyTotp({
      code: String(formData.get('code') ?? ''),
    });
    if (result.error) {
      setError(true);
      return;
    }
    router.replace('/access');
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
            {error ? <p role="alert">{t('twoFactor.failed')}</p> : null}
            <Button type="submit">{t('twoFactor.verify')}</Button>
          </Stack>
        </Form>
      </Stack>
    </main>
  );
}
