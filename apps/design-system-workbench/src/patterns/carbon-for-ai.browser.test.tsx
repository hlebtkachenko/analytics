import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import { CarbonForAi, carbonForAiFamilies } from './carbon-for-ai.stories.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mount(theme: 'white' | 'g10' | 'g90' | 'g100') {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<CarbonForAi theme={theme} />));
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('renders every documented Carbon for AI family across all Carbon themes', async () => {
  for (const theme of ['white', 'g10', 'g90', 'g100'] as const) {
    const mounted = await mount(theme);
    expect(
      [...mounted.host.querySelectorAll<HTMLElement>('[data-ai-family]')].map(
        (element) => element.dataset.aiFamily,
      ),
    ).toEqual(carbonForAiFamilies);
    expect(
      mounted.host.querySelector(`[data-ai-theme="${theme}"]`),
    ).not.toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    const openModal = [...mounted.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open AI presence modal',
    );
    if (!openModal) throw new Error('Carbon for AI modal trigger is missing.');
    await act(async () => openModal.click());
    await expect
      .poll(() => document.querySelectorAll('[role="dialog"]').length)
      .toBe(1);
    await mounted.unmount();
  }
});
