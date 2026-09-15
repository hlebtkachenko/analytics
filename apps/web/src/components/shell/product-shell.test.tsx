import { DesignSystemProvider } from '@bap/design-system/theme';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = { pathname: '/access', segments: ['access'] as string[] };

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegments: () => navigation.segments,
}));

import { ActiveOrganization } from './active-organization';
import ProductShell from './product-shell';
import { railDestinations, workspaceSectionItems } from './product-navigation';

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

  it('renders exactly the rail destinations from the navigation array', () => {
    renderShell();

    const rail = screen.getByRole('navigation', { name: 'Side navigation' });
    const links = within(rail).getAllByRole('link');

    expect(links).toHaveLength(railDestinations.length);
    railDestinations.forEach((destination, index) => {
      expect(links[index]!.textContent).toContain(destination.label);
      expect(links[index]!.getAttribute('href')).toBe(destination.href);
    });
  });

  it('shows the workspace section for the active organization', () => {
    render(
      <DesignSystemProvider mode="light">
        <ProductShell railPinned={false}>
          <ActiveOrganization
            name="Acme Legal"
            role="owner"
            slug="acme-legal"
          />
          <p>Page body</p>
        </ProductShell>
      </DesignSystemProvider>,
    );

    const rail = screen.getByRole('navigation', { name: 'Side navigation' });
    expect(within(rail).getByText('Acme Legal')).toBeTruthy();

    const links = within(rail).getAllByRole('link');
    const workspaceLinks = links.slice(railDestinations.length);

    expect(workspaceLinks).toHaveLength(workspaceSectionItems.length);
    workspaceSectionItems.forEach((item, index) => {
      expect(workspaceLinks[index]!.textContent).toContain(item.label);
      expect(workspaceLinks[index]!.getAttribute('href')).toBe(
        `/acme-legal/${item.segment}`,
      );
    });
  });
});
