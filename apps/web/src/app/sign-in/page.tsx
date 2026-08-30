'use client';

import {
  Button,
  Form,
  PasswordInput,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../lib/auth/client';

// Better Auth answers a two-factor account with this marker instead of a session.
function requiresTwoFactor(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  );
}

export default function SignInPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState(false);

  async function submit(formData: FormData): Promise<void> {
    setError(false);
    const result = await authClient.signIn.email({
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    });
    if (result.error) {
      setError(true);
      return;
    }
    if (requiresTwoFactor(result.data)) {
      router.replace('/sign-in/two-factor');
      return;
    }
    router.replace('/access');
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('auth.title')}</h1>
        <Form action={submit} aria-label={t('auth.title')}>
          <Stack gap={5}>
            <TextInput
              id="email"
              labelText={t('auth.email')}
              name="email"
              type="email"
              required
            />
            <PasswordInput
              id="password"
              labelText={t('auth.password')}
              name="password"
              required
            />
            {error ? <p role="alert">{t('auth.signInFailed')}</p> : null}
            <Button type="submit">{t('auth.signIn')}</Button>
          </Stack>
        </Form>
      </Stack>
    </main>
  );
}
