import '@bap/design-system/styles.scss';
import '@bap/design-system/fonts.scss';
import '@bap/design-system/charts.css';
import {
  DesignSystemProvider,
  resolveCarbonTheme,
} from '@bap/design-system/theme';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { I18nProvider } from '../i18n/client-provider';
import { readThemeMode } from '../lib/preferences/server';

export const metadata: Metadata = {
  description: 'Afframe Analytics, a business analytics platform.',
  title: {
    default: 'Afframe Analytics',
    template: '%s | Afframe Analytics',
  },
};

export const dynamic = 'force-dynamic';

type RootLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProperties) {
  const mode = await readThemeMode();

  return (
    <html
      data-carbon-theme={
        mode === 'system' ? undefined : resolveCarbonTheme(mode, false)
      }
      lang="en-US"
    >
      <body>
        <DesignSystemProvider mode={mode}>
          <I18nProvider>{children}</I18nProvider>
        </DesignSystemProvider>
      </body>
    </html>
  );
}
