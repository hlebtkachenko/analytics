import type { Decorator as StorybookDecorator } from '@storybook/react-vite';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import preview from '../../.storybook/preview.js';
import { componentStory } from './component-registry.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DecoratorContext = Parameters<StorybookDecorator>[1];

async function mountSource(name: string, sourceKey: string) {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  const story = componentStory(name);
  const content = story.Variants.render?.({} as never, {} as never);
  if (!content) throw new Error(`${name} has no variants render function.`);
  const previousHash = window.location.hash;
  window.location.hash = `#${sourceKey}`;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      decorator(() => content as ReactElement, {
        globals: { direction: 'ltr', motion: 'reduced', theme: 'white' },
        parameters: {},
      } as unknown as DecoratorContext),
    );
  });
  await expect
    .poll(() => host.querySelector(`[data-specimen-id="${sourceKey}"]`))
    .not.toBeNull();
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
      window.location.hash = previousHash;
    },
  };
}

test('renders real Grid subgrid and offset source compositions', async () => {
  const subgrid = await mountSource(
    'Grid',
    'source-packages-react-src-components-Grid-Grid-stories-js-Subgrid',
  );
  try {
    expect(
      subgrid.host.querySelectorAll('[class*="grid"]').length,
    ).toBeGreaterThanOrEqual(2);
    expect(subgrid.host.textContent).toContain('Subgrid parent column');
  } finally {
    await subgrid.unmount();
  }

  const offset = await mountSource(
    'Grid',
    'source-packages-react-src-components-Grid-Grid-stories-js-Offset',
  );
  try {
    expect(
      offset.host.querySelectorAll('[class*="\\:col-start-"]'),
    ).toHaveLength(2);
    expect(offset.host.textContent).toContain('Small offset 2');
  } finally {
    await offset.unmount();
  }
});

test('renders contained and vertical source tab compositions', async () => {
  await page.viewport(960, 720);
  const contained = await mountSource(
    'Tabs',
    'source-packages-react-src-components-Tabs-Tabs-stories-js-Contained',
  );
  try {
    expect(contained.host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(contained.host.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(contained.host.querySelector('[class*="contained"]')).not.toBeNull();
  } finally {
    await contained.unmount();
  }

  const vertical = await mountSource(
    'TabsVertical',
    'source-packages-react-src-components-Tabs-Tabs-stories-js-Vertical',
  );
  try {
    expect(vertical.host.querySelector('[role="tablist"]')).not.toBeNull();
    const verticalClassNames = [...vertical.host.querySelectorAll('[class]')]
      .map((element) => element.getAttribute('class'))
      .filter((className) => className?.includes('vertical'));
    if (!verticalClassNames.length) {
      throw new Error(
        `Vertical tabs lack a vertical class: ${JSON.stringify(
          [...vertical.host.querySelectorAll('[class]')].map((element) =>
            element.getAttribute('class'),
          ),
        )}`,
      );
    }
    expect(vertical.host.textContent).toContain('Overview panel');
  } finally {
    await vertical.unmount();
  }
});

test('renders visible icon-only tab source compositions', async () => {
  for (const [sourceName, iconSize] of [
    ['Icon20Only', 20],
    ['IconOnly', 16],
    ['Icon20OnlyVisualSnapshots', 20],
    ['IconOnlyVisualSnapshots', 16],
  ] as const) {
    const tabs = await mountSource(
      'Tabs',
      `source-packages-react-src-components-Tabs-Tabs-stories-js-${sourceName}`,
    );
    try {
      const icons = [
        ...tabs.host.querySelectorAll('svg[role="img"][aria-label$=" icon"]'),
      ];
      expect(icons.length).toBeGreaterThanOrEqual(4);
      expect(icons.every((icon) => icon.querySelector('circle'))).toBe(true);
      expect(
        icons.every((icon) => icon.getAttribute('width') === `${iconSize}`),
      ).toBe(true);
      expect(
        tabs.host.querySelector('[role="tab"]')?.getAttribute('aria-disabled'),
      ).toBe('true');
    } finally {
      await tabs.unmount();
    }
  }
});

test('renders the custom heading level without skipping intermediate levels', async () => {
  const heading = await mountSource(
    'Heading',
    'source-packages-react-src-components-Heading-Heading-stories-js-CustomLevel',
  );
  try {
    expect(
      [...heading.host.querySelectorAll('h1, h2, h3, h4, h5')].map(
        (element) => element.tagName,
      ),
    ).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    expect(heading.host.textContent).toContain('Release readiness');
  } finally {
    await heading.unmount();
  }
});

test('renders Card media and DataTable toolbar and expansion compositions', async () => {
  const card = await mountSource(
    'preview__Card.Card',
    'source-packages-react-src-components-Card-Card-stories-js-WithMedia',
  );
  try {
    expect(card.host.querySelector('[class*="card"]')).not.toBeNull();
    expect(card.host.textContent).toContain('Card media');
  } finally {
    await card.unmount();
  }

  const toolbar = await mountSource(
    'DataTable',
    'source-packages-react-src-components-DataTable-stories-DataTable-toolbar-stories-js-PersistentToolbar',
  );
  try {
    expect(
      toolbar.host.querySelector('[class*="table-toolbar"]'),
    ).not.toBeNull();
    expect(toolbar.host.querySelector('input[type="search"]')).not.toBeNull();
  } finally {
    await toolbar.unmount();
  }

  const expansion = await mountSource(
    'DataTable',
    'source-packages-react-src-components-DataTable-stories-expansion-DataTable-expansion-stories-js-BatchExpansion',
  );
  try {
    expect(expansion.host.querySelector('button')).not.toBeNull();
    expect(expansion.host.textContent).toContain('Expandable row content');
  } finally {
    await expansion.unmount();
  }
});

test('renders two-slider-handle and UI Shell navigation source compositions', async () => {
  const slider = await mountSource(
    'Slider',
    'source-packages-react-src-components-Slider-Slider-stories-js-TwoHandleSlider',
  );
  try {
    expect(slider.host.querySelectorAll('input')).toHaveLength(2);
  } finally {
    await slider.unmount();
  }

  const shell = await mountSource(
    'Header',
    'source-packages-react-src-components-UIShell-UIShell-HeaderBase-stories-js-HeaderWNavigationActionsAndSideNav',
  );
  try {
    expect(shell.host.querySelector('[role="banner"], header')).not.toBeNull();
    expect(shell.host.querySelector('nav')).not.toBeNull();
    expect(shell.host.textContent).toContain('Section');
  } finally {
    await shell.unmount();
  }
});
