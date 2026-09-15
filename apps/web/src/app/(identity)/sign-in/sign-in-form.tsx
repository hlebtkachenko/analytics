'use client';

import { Login } from '@bap/design-system/icons';
import {
  Button,
  Form,
  InlineNotification,
  Link,
  PasswordInput,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '../../../lib/auth/client';
import {
  defaultReturnPath,
  safeReturnPath,
} from '../../../lib/auth/return-path';

// Better Auth answers a two-factor account with this marker instead of a session.
function requiresTwoFactor(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  );
}

export default function SignInForm({
  publicSignupEnabled,
}: Readonly<{ publicSignupEnabled: boolean }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState(false);
  const returnPath = safeReturnPath(searchParams.get('next'));

  async function submit(formData: FormData): Promise<void> {
    setError(false);
    try {
      const result = await authClient.signIn.email({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      });
      if (result.error) {
        setError(true);
        return;
      }
      if (requiresTwoFactor(result.data)) {
        // The challenge page finishes the trip, so it has to carry the return path.
        router.replace(
          returnPath === defaultReturnPath
            ? '/sign-in/two-factor'
            : `/sign-in/two-factor?next=${encodeURIComponent(returnPath)}`,
        );
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
        <h1>{t('auth.title')}</h1>
        <Form action={submit} aria-label={t('auth.title')}>
          <Stack gap={5}>
            <TextInput
              autoComplete="username"
              id="email"
              labelText={t('auth.email')}
              name="email"
              required
              type="email"
            />
            <PasswordInput
              autoComplete="current-password"
              id="password"
              labelText={t('auth.password')}
              name="password"
              required
              size="lg"
            />
            <Link href="/forgot-password">{t('auth.forgotPassword')}</Link>
            {publicSignupEnabled ? (
              <Link href="/sign-up">{t('auth.createAccount')}</Link>
            ) : null}
            {error ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={t('auth.signInFailed')}
              />
            ) : null}
            <Button renderIcon={Login} type="submit">
              {t('auth.signIn')}
            </Button>
          </Stack>
        </Form>
      </Stack>
    </main>
  );
}
