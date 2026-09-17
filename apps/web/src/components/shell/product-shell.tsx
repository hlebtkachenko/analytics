'use client';

import {
  Close,
  Enterprise,
  Help,
  Search,
  Switcher,
  UserAvatar,
} from '@bap/design-system/icons';
import {
  Content,
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SideNavMenu,
  SideNavMenuItem,
  SkipToContent,
  Theme,
} from '@bap/design-system/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import {
  railCookieName,
  railPinnedValue,
  writePreferenceCookie,
} from '../../lib/preferences/cookies';
import {
  ActiveOrganizationProvider,
  useActiveOrganization,
} from './active-organization';
import Breadcrumbs from './breadcrumbs';
import GlobalSearch from './global-search';
import { AccountPanel, HelpPanel, SwitcherPanel } from './header-panels';
import {
  activeRoute,
  railDestinations,
  workspaceSectionItems,
} from './product-navigation';
import styles from './product-shell.module.scss';
import { ToastProvider } from './toast';
import { largeViewportQuery, useMediaQuery } from './use-media-query';

type PanelId = 'account' | 'help' | 'search' | 'switcher';

type ProductShellProperties = Readonly<{
  children: ReactNode;
  feedbackEmail?: string | undefined;
  railPinned: boolean;
  user: Readonly<{ email: string; name: string }>;
  version: string;
}>;

export default function ProductShell({
  children,
  feedbackEmail,
  railPinned,
  user,
  version,
}: ProductShellProperties) {
  return (
    <ToastProvider>
      <ActiveOrganizationProvider>
        <ShellChrome
          feedbackEmail={feedbackEmail}
          railPinned={railPinned}
          user={user}
          version={version}
        >
          {children}
        </ShellChrome>
      </ActiveOrganizationProvider>
    </ToastProvider>
  );
}

function ShellChrome({
  children,
  feedbackEmail,
  railPinned,
  user,
  version,
}: ProductShellProperties) {
  const pathname = usePathname();
  const route = activeRoute(pathname);
  const organization = useActiveOrganization();
  const isLarge = useMediaQuery(largeViewportQuery, true);
  const [pinned, setPinned] = useState(railPinned);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  const [trackedRailPinned, setTrackedRailPinned] = useState(railPinned);

  // Close transient navigation and panels when the route changes, adjusting
  // state during render rather than in an effect.
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    setMobileOpen(false);
    setOpenPanel(null);
  }

  // The preferences page writes the rail cookie then refreshes; sync the seeded
  // state during render so a changed server preference applies live.
  if (railPinned !== trackedRailPinned) {
    setTrackedRailPinned(railPinned);
    setPinned(railPinned);
  }

  const expanded = (pinned && isLarge) || mobileOpen;
  const searchOpen = openPanel === 'search';

  // Escape dismisses any open panel or the mobile navigation.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpenPanel(null);
        setMobileOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function toggleNavigation(): void {
    if (isLarge) {
      const next = !pinned;
      setPinned(next);
      writePreferenceCookie(railCookieName, next ? railPinnedValue : null);
    } else {
      setMobileOpen((open) => !open);
    }
  }

  function togglePanel(id: PanelId): void {
    setOpenPanel((current) => (current === id ? null : id));
  }

  // The rail and the workspace section are rendered from the navigation arrays alone.
  const railLinks = railDestinations.map((destination) => (
    <SideNavLink
      href={destination.href}
      isActive={route === destination.route}
      key={destination.route}
      renderIcon={destination.icon}
    >
      {destination.label}
    </SideNavLink>
  ));
  const workspaceLinks =
    organization === undefined
      ? null
      : workspaceSectionItems.map((item) => (
          <SideNavMenuItem
            href={`/${organization.slug}/${item.segment}`}
            key={item.segment}
          >
            {item.label}
          </SideNavMenuItem>
        ));

  return (
    <>
      <Theme theme="g100">
        <Header
          aria-label="Afframe Analytics"
          className={searchOpen ? styles.searching! : ''}
        >
          <SkipToContent href="#main-content">
            Skip to main content
          </SkipToContent>
          <HeaderMenuButton
            aria-label={
              expanded ? 'Collapse side navigation' : 'Expand side navigation'
            }
            isActive={expanded}
            isCollapsible
            onClick={toggleNavigation}
          />
          <HeaderName href="/organizations" prefix="Afframe">
            Analytics
          </HeaderName>
          <HeaderNavigation aria-label="Areas">
            <HeaderMenuItem href="/organizations" isActive>
              Analytics
            </HeaderMenuItem>
          </HeaderNavigation>
          {searchOpen ? (
            <GlobalSearch
              activeOrganization={organization}
              onClose={() => setOpenPanel(null)}
            />
          ) : null}
          <HeaderGlobalBar>
            <HeaderGlobalAction
              aria-expanded={searchOpen}
              aria-label={searchOpen ? 'Close search' : 'Search'}
              isActive={searchOpen}
              onClick={() => togglePanel('search')}
              tooltipAlignment="end"
            >
              {searchOpen ? <Close size={20} /> : <Search size={20} />}
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-expanded={openPanel === 'help'}
              aria-label="Help"
              isActive={openPanel === 'help'}
              onClick={() => togglePanel('help')}
              tooltipAlignment="end"
            >
              <Help size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-expanded={openPanel === 'account'}
              aria-label="Account"
              isActive={openPanel === 'account'}
              onClick={() => togglePanel('account')}
              tooltipAlignment="end"
            >
              <UserAvatar size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-expanded={openPanel === 'switcher'}
              aria-label="Workspaces"
              isActive={openPanel === 'switcher'}
              onClick={() => togglePanel('switcher')}
              tooltipAlignment="end"
            >
              <Switcher size={20} />
            </HeaderGlobalAction>
          </HeaderGlobalBar>
          <HelpPanel
            expanded={openPanel === 'help'}
            feedbackEmail={feedbackEmail}
            version={version}
          />
          <AccountPanel
            activeOrganization={organization}
            expanded={openPanel === 'account'}
            user={user}
          />
          <SwitcherPanel
            activeOrganization={organization}
            expanded={openPanel === 'switcher'}
          />
          <SideNav
            aria-label="Side navigation"
            expanded={expanded}
            isChildOfHeader
            isPersistent
            isRail
            onOverlayClick={() => setMobileOpen(false)}
          >
            <SideNavItems>
              {railLinks}
              {organization === undefined ? null : (
                <>
                  <SideNavDivider />
                  <SideNavMenu
                    renderIcon={Enterprise}
                    title={organization.name}
                  >
                    {workspaceLinks}
                  </SideNavMenu>
                </>
              )}
            </SideNavItems>
          </SideNav>
        </Header>
      </Theme>
      <Content
        className={[styles.content, expanded ? styles.contentExpanded : '']
          .filter(Boolean)
          .join(' ')}
        id="main-content"
        tabIndex={-1}
      >
        <Breadcrumbs />
        {children}
      </Content>
    </>
  );
}
