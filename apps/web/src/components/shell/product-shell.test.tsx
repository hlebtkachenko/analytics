import { DesignSystemProvider } from '@bap/design-system/theme';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = { pathname: '/access', segments: ['access'] as string[] };

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegments: () => navigation.segments,
}));

import ProductShell from './product-shell';

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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  navigation.pathname = '/access';
  navigation.segments = ['access'];
  stubMatchMedia(true);
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.carbonTheme;
});

function renderShell(railPinned = false) {
  return render(
    <DesignSystemProvider mode="light">
      <ProductShell railPinned={railPinned}>
        <p>Page body</p>
      </ProductShell>
    </DesignSystemProvider>,
  );
}

describe('ProductShell', () => {
  it('owns exactly one main content landmark and renders the page body', () => {
    const { container } = renderShell();

    expect(container.querySelectorAll('main#main-content')).toHaveLength(1);
    expect(screen.getByText('Page body')).toBeTruthy();
  });

  it('renders a skip link that targets the main content', () => {
    renderShell();

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
  });

  it('renders the Afframe Analytics brand and the two areas', () => {
    renderShell();

    expect(screen.getByText('Afframe')).toBeTruthy();
    expect(screen.getByText('AI Assistant')).toBeTruthy();
  });

  it('renders the six global header actions', () => {
    renderShell();

    for (const label of [
      'Search',
      'Notifications',
      'Help',
      'Settings',
      'Workspaces',
      'Account',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('renders the whole-app rail destinations', () => {
    renderShell();

    for (const name of ['Access', 'Organizations', 'Datasets', 'Account']) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
    }
  });
});
