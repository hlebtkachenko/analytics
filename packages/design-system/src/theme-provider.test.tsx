import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemProvider, resolveCarbonTheme } from './theme-provider.js';

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  delete document.documentElement.dataset.carbonTheme;
});

describe('resolveCarbonTheme', () => {
  it.each([
    ['light', false, 'white'],
    ['light', true, 'white'],
    ['dark', false, 'g100'],
    ['dark', true, 'g100'],
    ['system', false, 'white'],
    ['system', true, 'g100'],
  ] as const)(
    'maps %s with prefersDark=%s to %s',
    (mode, prefersDark, theme) => {
      expect(resolveCarbonTheme(mode, prefersDark)).toBe(theme);
    },
  );
});

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

  it('resolves an explicit light mode to the White theme', () => {
    render(
      <DesignSystemProvider mode="light">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('white');
  });

  it('resolves an explicit dark mode to the Gray 100 theme', () => {
    render(
      <DesignSystemProvider mode="dark">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('g100');
  });

  it('resolves system mode to Gray 100 when the OS prefers dark', () => {
    stubMatchMedia(true);

    render(
      <DesignSystemProvider mode="system">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('g100');
  });

  it('resolves system mode to White when the OS prefers light', () => {
    stubMatchMedia(false);

    render(
      <DesignSystemProvider mode="system">
        <div />
      </DesignSystemProvider>,
    );

    expect(document.documentElement.dataset.carbonTheme).toBe('white');
  });
});
