import '@bap/design-system/styles.scss';
import '@bap/design-system/fonts.scss';
import '@bap/design-system/charts.css';
import { DesignSystemProvider } from '@bap/design-system/theme';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  description: 'Business Analytics Platform',
  title: 'BAP',
};

type RootLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProperties) {
  return (
    <html data-carbon-theme="white" lang="en">
      <body>
        <DesignSystemProvider theme="white">{children}</DesignSystemProvider>
      </body>
    </html>
  );
}
