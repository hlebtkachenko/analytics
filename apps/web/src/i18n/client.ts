'use client';

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resources, supportedLanguages } from './resources';

void i18n.use(initReactI18next).init({
  fallbackLng: supportedLanguages[0],
  interpolation: {
    escapeValue: false,
  },
  lng: supportedLanguages[0],
  resources,
});

export { i18n };
