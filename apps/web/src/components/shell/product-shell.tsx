'use client';

import {
  DataSet,
  Enterprise,
  Help,
  Notification,
  Search,
  Security,
  Settings,
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
import {
  AccountPanel,
  HelpPanel,
  NotificationsPanel,
  SettingsPanel,
  SwitcherPanel,
} from './header-panels';
import { activeRoute, ASSISTANT_AREA_LABEL } from './product-navigation';
import styles from './product-shell.module.scss';
import { ToastProvider, useToast } from './toast';
import { largeViewportQuery, useMediaQuery } from './use-media-query';

type PanelId =
  'account' | 'help' | 'notifications' | 'search' | 'settings' | 'switcher';

type ProductShellProperties = Readonly<{
  children: ReactNode;
  railPinned: boolean;
}>;

export default function ProductShell({
  children,
  railPinned,
}: ProductShellProperties) {
  return (
    <ToastProvider>
      <ActiveOrganizationProvider>
        <ShellChrome railPinned={railPinned}>{children}</ShellChrome>
      </ActiveOrganizationProvider>
    </ToastProvider>
  );
}

function ShellChrome({ children, railPinned }: ProductShellProperties) {
  const pathname = usePathname();
  const route = activeRoute(pathname);
  const organization = useActiveOrganization();
  const { notify } = useToast();
  const isLarge = useMediaQuery(largeViewportQuery, true);
  const [pinned, setPinned] = useState(railPinned);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [trackedPathname, setTrackedPathname] = useState(pathname);

  // Close transient navigation and panels when the route changes, adjusting
  // state during render rather than in an effect.
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    setMobileOpen(false);
    setOpenPanel(null);
  }

  const expanded = (pinned && isLarge) || mobileOpen;

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

  return (
    <>
      <Theme theme="g100">
        <Header aria-label="Afframe Analytics">
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
          <HeaderName href="/access" prefix="Afframe">
            Analytics
          </HeaderName>
          <HeaderNavigation aria-label="Areas">
            <HeaderMenuItem href="/access" isActive>
              Analytics
            </HeaderMenuItem>
            <HeaderMenuItem
              href="#"
              onClick={(event) => {
                event.preventDefault();
                notify({
                  subtitle: 'The AI Assistant is coming soon.',
                  title: ASSISTANT_AREA_LABEL,
                });
              }}
            >
              {ASSISTANT_AREA_LABEL}
            </HeaderMenuItem>
          </HeaderNavigation>
          <GlobalSearch expanded={openPanel === 'search'} />
          <HeaderGlobalBar>
            <HeaderGlobalAction
              aria-label="Search"
              isActive={openPanel === 'search'}
              onClick={() => togglePanel('search')}
              tooltipAlignment="end"
            >
              <Search size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label="Notifications"
              isActive={openPanel === 'notifications'}
              onClick={() => togglePanel('notifications')}
              tooltipAlignment="end"
            >
              <Notification size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label="Help"
              isActive={openPanel === 'help'}
              onClick={() => togglePanel('help')}
              tooltipAlignment="end"
            >
              <Help size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label="Settings"
              isActive={openPanel === 'settings'}
              onClick={() => togglePanel('settings')}
              tooltipAlignment="end"
            >
              <Settings size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label="Workspaces"
              isActive={openPanel === 'switcher'}
              onClick={() => togglePanel('switcher')}
              tooltipAlignment="end"
            >
              <Switcher size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label="Account"
              isActive={openPanel === 'account'}
              onClick={() => togglePanel('account')}
              tooltipAlignment="end"
            >
              <UserAvatar size={20} />
            </HeaderGlobalAction>
          </HeaderGlobalBar>
          <NotificationsPanel expanded={openPanel === 'notifications'} />
          <HelpPanel expanded={openPanel === 'help'} />
          <SettingsPanel expanded={openPanel === 'settings'} />
          <SwitcherPanel
            activeSlug={organization?.slug}
            expanded={openPanel === 'switcher'}
          />
          <AccountPanel expanded={openPanel === 'account'} />
          <SideNav
            aria-label="Side navigation"
            expanded={expanded}
            isChildOfHeader
            isPersistent
            isRail
            onOverlayClick={() => setMobileOpen(false)}
          >
            <SideNavItems>
              <SideNavLink
                href="/access"
                isActive={route === 'access'}
                renderIcon={Security}
              >
                Access
              </SideNavLink>
              <SideNavLink
                href="/organizations"
                isActive={route === 'organizations'}
                renderIcon={Enterprise}
              >
                Organizations
              </SideNavLink>
              <SideNavLink
                href="/datasets"
                isActive={route === 'datasets'}
                renderIcon={DataSet}
              >
                Datasets
              </SideNavLink>
              <SideNavLink
                href="/account"
                isActive={route === 'account'}
                renderIcon={UserAvatar}
              >
                Account
              </SideNavLink>
              {organization ? (
                <>
                  <SideNavDivider />
                  <SideNavMenu
                    renderIcon={Enterprise}
                    title={organization.name}
                  >
                    <SideNavMenuItem href={`/${organization.slug}/members`}>
                      Members
                    </SideNavMenuItem>
                    <SideNavMenuItem href={`/${organization.slug}/entities`}>
                      Entities
                    </SideNavMenuItem>
                    <SideNavMenuItem href={`/${organization.slug}/settings`}>
                      Settings
                    </SideNavMenuItem>
                  </SideNavMenu>
                </>
              ) : null}
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
