'use client';

import {
  FormGroup,
  RadioButton,
  RadioButtonGroup,
  Stack,
  Toggle,
} from '@bap/design-system/react';
import type { ThemeMode } from '@bap/design-system/theme';
import { useThemeMode } from '@bap/design-system/theme';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  railCookieName,
  railPinnedValue,
  themeCookieName,
  writePreferenceCookie,
} from '../../../../lib/preferences/cookies';

type PreferencesViewProperties = Readonly<{
  railPinned: boolean;
  themeMode: ThemeMode;
}>;

export default function PreferencesView({
  railPinned,
  themeMode,
}: PreferencesViewProperties) {
  const { t } = useTranslation();
  const { setMode } = useThemeMode();
  const router = useRouter();

  const [mode, setLocalMode] = useState<ThemeMode>(themeMode);
  const [pinned, setPinned] = useState(railPinned);

  function chooseTheme(next: ThemeMode): void {
    setLocalMode(next);
    setMode(next);
    writePreferenceCookie(themeCookieName, next);
  }

  function togglePinned(next: boolean): void {
    setPinned(next);
    writePreferenceCookie(railCookieName, next ? railPinnedValue : null);
    // The shell reads the cookie on the server, so refresh applies the change live.
    router.refresh();
  }

  return (
    <>
      <h1>{t('account.preferences.title')}</h1>

      <section aria-labelledby="preferences-theme-heading">
        <Stack gap={5}>
          <h2 id="preferences-theme-heading">
            {t('account.preferences.themeTitle')}
          </h2>
          <RadioButtonGroup
            legendText={t('account.preferences.themeTitle')}
            name="theme-mode"
            onChange={(value) => {
              chooseTheme(value as ThemeMode);
            }}
            orientation="vertical"
            valueSelected={mode}
          >
            <RadioButton
              labelText={t('account.preferences.themeLight')}
              value="light"
            />
            <RadioButton
              labelText={t('account.preferences.themeDark')}
              value="dark"
            />
            <RadioButton
              labelText={t('account.preferences.themeSystem')}
              value="system"
            />
          </RadioButtonGroup>
        </Stack>
      </section>

      <section aria-labelledby="preferences-rail-heading">
        <Stack gap={5}>
          <h2 id="preferences-rail-heading">
            {t('account.preferences.railTitle')}
          </h2>
          <FormGroup legendText={t('account.preferences.railHelper')}>
            <Toggle
              id="rail-pinned"
              labelText={t('account.preferences.railLabel')}
              onToggle={(next) => {
                togglePinned(next);
              }}
              toggled={pinned}
            />
          </FormGroup>
        </Stack>
      </section>
    </>
  );
}
