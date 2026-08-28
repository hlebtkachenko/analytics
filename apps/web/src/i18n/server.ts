import { createInstance } from 'i18next';

import { resources, supportedLanguages } from './resources';

export async function createServerI18n() {
  const instance = createInstance();
  await instance.init({
    fallbackLng: supportedLanguages[0],
    lng: supportedLanguages[0],
    resources,
  });
  return instance;
}

export async function translate(key: string): Promise<string> {
  const instance = await createServerI18n();
  if (!instance.exists(key)) {
    throw new Error(`Missing translation: ${key}`);
  }
  return instance.t(key);
}
