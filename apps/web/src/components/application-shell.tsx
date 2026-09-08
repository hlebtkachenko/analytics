'use client';

import {
  Header,
  HeaderMenuButton,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
} from '@bap/design-system/react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import styles from './application-shell.module.scss';

const primaryDestinations = [
  { href: '/access', label: 'Access', route: 'access' },
  { href: '/organizations', label: 'Organizations', route: 'organizations' },
  { href: '/datasets', label: 'Datasets', route: 'datasets' },
  { href: '/account', label: 'Account', route: 'account' },
] as const;

const publicTopLevelRoutes = new Set([
  'activate',
  'design-system',
  'forgot-password',
  'invitation',
  'reset-password',
  'sign-in',
  'sign-up',
  'welcome',
]);

function applicationRoute(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];

  if (!first || publicTopLevelRoutes.has(first)) {
    return null;
  }

  if (first === 'access' || first === 'account' || first === 'datasets') {
    return segments.length === 1 ? first : null;
  }

  if (first === 'organizations') {
    return segments.length <= 2 ? 'organizations' : null;
  }

  if (
    segments.length === 1 ||
    (segments.length === 2 &&
      (segments[1] === 'members' || segments[1] === 'settings'))
  ) {
    return 'organizations';
  }

  return null;
}

type ApplicationShellProperties = Readonly<{
  children: ReactNode;
}>;

export default function ApplicationShell({
  children,
}: ApplicationShellProperties) {
  const pathname = usePathname();
  const route = applicationRoute(pathname);
  const [openPathname, setOpenPathname] = useState<string>();
  const navigationOpen = openPathname === pathname;

  if (route === null) {
    return children;
  }

  return (
    <>
      <SkipToContent href="#main-content">Skip to main content</SkipToContent>
      <Header aria-label="BAP">
        <HeaderMenuButton
          aria-label={
            navigationOpen
              ? 'Close primary navigation'
              : 'Open primary navigation'
          }
          isActive={navigationOpen}
          onClick={() => setOpenPathname(navigationOpen ? undefined : pathname)}
        />
        <HeaderName href="/access" prefix="">
          BAP
        </HeaderName>
        <HeaderNavigation aria-label="Primary navigation">
          {/* exact path uses aria-current page, section state uses Carbon isActive (aria-current true) */}
          {primaryDestinations.map((destination) => {
            const active = destination.route === route;
            const currentPage = pathname === destination.href;
            return (
              <HeaderMenuItem
                aria-current={currentPage ? 'page' : undefined}
                href={destination.href}
                isActive={active}
                key={destination.href}
              >
                {destination.label}
              </HeaderMenuItem>
            );
          })}
        </HeaderNavigation>
        <SideNav
          aria-label="Primary navigation on small screens"
          className={navigationOpen ? styles.sideNavOpen : styles.sideNavClosed}
          expanded={navigationOpen}
          isChildOfHeader
          onOverlayClick={() => setOpenPathname(undefined)}
        >
          <SideNavItems>
            {primaryDestinations.map((destination) => (
              <SideNavLink
                aria-current={
                  pathname === destination.href ? 'page' : undefined
                }
                href={destination.href}
                isActive={destination.route === route}
                key={destination.href}
              >
                {destination.label}
              </SideNavLink>
            ))}
          </SideNavItems>
        </SideNav>
      </Header>
      <div className={styles.content}>{children}</div>
    </>
  );
}

export { applicationRoute, primaryDestinations, publicTopLevelRoutes };
