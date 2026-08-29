import type { Decorator as StorybookDecorator } from '@storybook/react-vite';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import preview from '../../.storybook/preview.js';
import buttonMeta from './generated/Button.stories.js';
import previewCardBodyMeta from './generated/preview__Card__CardBody.stories.js';
import { renderCarbonComponent } from './component-registry.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DecoratorContext = Parameters<StorybookDecorator>[1];

async function mountStory(content: ReactElement) {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      decorator(() => content, {
        globals: { theme: 'white' },
        parameters: {},
      } as unknown as DecoratorContext),
    );
  });
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('generates switchable Button controls and mounts a preview namespace component', async () => {
  expect(buttonMeta.argTypes?.kind).toMatchObject({
    control: { type: 'select' },
    options: expect.arrayContaining(['primary', 'danger']),
  });
  expect(buttonMeta.argTypes?.size).toMatchObject({
    control: { type: 'select' },
    options: expect.arrayContaining(['sm', 'lg']),
  });
  expect(buttonMeta.argTypes?.hasIconOnly).toMatchObject({
    control: { type: 'boolean' },
    options: [false, true],
  });
  expect(previewCardBodyMeta.component).toBeDefined();

  const ButtonComponent = buttonMeta.component;
  const mounted = await mountStory(
    <>
      {ButtonComponent ? (
        <ButtonComponent kind="danger" size="lg">
          Action
        </ButtonComponent>
      ) : null}
      {renderCarbonComponent('preview__Card.CardBody')}
    </>,
  );
  expect(mounted.host.querySelector('button')).not.toBeNull();
  expect(mounted.host.textContent).not.toBe('');
  await mounted.unmount();
});
