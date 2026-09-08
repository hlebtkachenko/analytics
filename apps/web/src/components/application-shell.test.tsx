import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservedOrganizationSlugs } from '../lib/organizations/slug';
import ApplicationShell, {
  applicationRoute,
  primaryDestinations,
  publicTopLevelRoutes,
} from './application-shell';

const mocks = vi.hoisted(() => ({ pathname: '/access' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApplicationShell', () => {
  it('recognizes only current application routes', () => {
    expect(applicationRoute('/access')).toBe('access');
    expect(applicationRoute('/organizations/new')).toBe('organizations');
    expect(applicationRoute('/example/members')).toBe('organizations');
    expect(applicationRoute('/datasets')).toBe('datasets');
    expect(applicationRoute('/account')).toBe('account');
    expect(applicationRoute('/sign-in')).toBeNull();
    expect(applicationRoute('/invitation/example')).toBeNull();
    expect(applicationRoute('/design-system')).toBeNull();
  });

  it('adds one skip target and current primary navigation to application pages', () => {
    mocks.pathname = '/organizations/new';
    render(
      <ApplicationShell>
        <main id="main-content">
          <h1>Create organization</h1>
        </main>
      </ApplicationShell>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main-content');
    expect(
      screen.getAllByRole('link', { name: 'Organizations' })[0],
    ).not.toHaveAttribute('aria-current', 'page');

    const menu = screen.getByRole('button', {
      name: 'Open primary navigation',
    });
    fireEvent.click(menu);
    expect(menu).toHaveAccessibleName('Close primary navigation');
  });

  it('marks aria-current="page" only for the exact current path', () => {
    mocks.pathname = '/organizations';
    render(
      <ApplicationShell>
        <main id="main-content">
          <h1>Organizations</h1>
        </main>
      </ApplicationShell>,
    );

    expect(
      screen.getAllByRole('link', { name: 'Organizations' })[0],
    ).toHaveAttribute('aria-current', 'page');

    cleanup();
    mocks.pathname = '/organizations/new';
    render(
      <ApplicationShell>
        <main id="main-content">
          <h1>New organization</h1>
        </main>
      </ApplicationShell>,
    );

    const sectionLink = screen.getAllByRole('link', {
      name: 'Organizations',
    })[0];
    expect(sectionLink).toHaveAttribute('aria-current', 'true');
    expect(sectionLink).not.toHaveAttribute('aria-current', 'page');
  });

  it('keeps the reserved slug contract in parity with the shell and public routes', () => {
    const primaryRoutes = new Set<string>(
      primaryDestinations.map((destination) => destination.route),
    );
    const infrastructureRoutes = new Set(['api', 'health', 'metrics', 'ready']);

    for (const slug of reservedOrganizationSlugs) {
      if (infrastructureRoutes.has(slug)) {
        continue;
      }
      expect(primaryRoutes.has(slug) || publicTopLevelRoutes.has(slug)).toBe(
        true,
      );
    }

    for (const route of publicTopLevelRoutes) {
      expect(reservedOrganizationSlugs as readonly string[]).toContain(route);
    }

    // Top-level application routes must be reserved organization slugs.
    for (const destination of primaryDestinations) {
      expect(reservedOrganizationSlugs as readonly string[]).toContain(
        destination.route,
      );
    }
  });

  it('does not leak the authenticated shell into identity pages', () => {
    mocks.pathname = '/sign-in';
    render(
      <ApplicationShell>
        <main>
          <h1>Sign in</h1>
        </main>
      </ApplicationShell>,
    );

    expect(
      screen.queryByRole('link', { name: 'Skip to main content' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toBeVisible();
  });
});
