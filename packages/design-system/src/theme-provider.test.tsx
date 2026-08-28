import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DesignSystemProvider } from './theme-provider.js';

describe('DesignSystemProvider', () => {
  it('synchronizes the Carbon theme selector after a rerender', () => {
    const rendered = render(
      <DesignSystemProvider theme="white">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('white');

    rendered.rerender(
      <DesignSystemProvider theme="g100">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('g100');
  });
});
