'use client';

import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';

import { i18n } from './client';

export function I18nProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
