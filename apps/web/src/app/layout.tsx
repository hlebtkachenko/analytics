import '@bap/design-system/styles.scss';
import '@bap/design-system/fonts.scss';
import '@bap/design-system/charts.css';
import { DesignSystemProvider } from '@bap/design-system/theme';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import ApplicationShell from '../components/application-shell';
import { I18nProvider } from '../i18n/client-provider';

export const metadata: Metadata = {
  description: 'Business Analytics Platform',
  title: 'BAP',
};

export const dynamic = 'force-dynamic';

type RootLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProperties) {
  return (
    <html data-carbon-theme="white" lang="en-US">
      <body>
        <DesignSystemProvider theme="white">
          <I18nProvider>
            <ApplicationShell>{children}</ApplicationShell>
          </I18nProvider>
        </DesignSystemProvider>
      </body>
    </html>
  );
}
