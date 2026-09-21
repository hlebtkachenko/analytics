import { DesignSystemProvider } from '@bap/design-system/theme';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';

const navigation = { pathname: '/account', segments: ['account'] as string[] };

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
  navigation.pathname = '/account';
  navigation.segments = ['account'];
  stubMatchMedia(true);
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.carbonTheme;
});

const testUser = { email: 'ada@example.com', name: 'Ada Lovelace' } as const;

function renderShell(
  options: Readonly<{
    feedbackEmail?: string;
    invitationCount?: number;
    railPinned?: boolean;
  }> = {},
) {
  return render(
    <DesignSystemProvider mode="light">
      <I18nProvider>
        <ProductShell
          feedbackEmail={options.feedbackEmail}
          invitationCount={options.invitationCount}
          railPinned={options.railPinned ?? false}
          user={testUser}
          version="1.2.3"
        >
          <p>Page body</p>
        </ProductShell>
      </I18nProvider>
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

  it('renders the Afframe Analytics brand and no AI Assistant area', () => {
    renderShell();

    expect(screen.getByText('Afframe')).toBeTruthy();
    expect(screen.queryByText('AI Assistant')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Afframe/ }).getAttribute('href'),
    ).toBe('/workspaces');
  });

  it('renders exactly the four global header actions', () => {
    renderShell();

    for (const label of ['Search', 'Help', 'Account', 'Workspaces']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('hides the invitations action when there are no pending invitations', () => {
    renderShell();

    expect(
      screen.queryByRole('button', { name: /Workspace invitations/ }),
    ).toBeNull();
  });

  it('shows a badged invitations action when invitations are pending', () => {
    renderShell({ invitationCount: 2 });

    const action = screen.getByRole('button', {
      name: 'Workspace invitations (2 pending)',
    });
    expect(action).toBeTruthy();
    expect(within(action).getByText('2')).toBeTruthy();
  });

  it('shows the application version in the help panel', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.getByText('Version 1.2.3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Documentation' })).toBeTruthy();
  });

  it('hides the feedback link when no feedback address is configured', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByRole('link', { name: 'Send feedback' })).toBeNull();
  });

  it('shows a feedback mailto link when a feedback address is configured', () => {
    renderShell({ feedbackEmail: 'feedback@example.com' });

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    const link = screen.getByRole('link', { name: 'Send feedback' });
    expect(link.getAttribute('href')).toBe('mailto:feedback@example.com');
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

  it('shows the account identity and links in the account panel', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    const profile = screen.getByRole('link', { name: 'My profile' });
    expect(profile.getAttribute('href')).toBe('/account');
    expect(
      screen
        .getByRole('link', { name: 'Security and sessions' })
        .getAttribute('href'),
    ).toBe('/account/security');
    expect(
      screen.getByRole('link', { name: 'Preferences' }).getAttribute('href'),
    ).toBe('/account/preferences');
    // No active workspace, so no role line is shown.
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('shows the workspace role in the account panel when a workspace is active', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('lists the active organization as a tabbable switcher item', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    const switcher = screen.getByRole('list', { name: 'Workspaces' });
    const item = within(switcher).getByRole('link', { name: 'Acme Legal' });
    expect(item.getAttribute('href')).toBe('/acme-legal');
    expect(item.tabIndex).toBe(0);
    expect(
      within(switcher).getByRole('link', { name: 'Manage workspaces' })
        .tabIndex,
    ).toBe(0);
  });

  it('shows the workspace section for the active organization', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
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
