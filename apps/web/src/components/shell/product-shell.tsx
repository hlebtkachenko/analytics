'use client';

import type { NotificationRow } from '@bap/db/access';
import {
  Close,
  Enterprise,
  Help,
  Notification,
  Search,
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
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
import {
  activeRoute,
  railDestinations,
  workspaceSectionItems,
} from './product-navigation';
import styles from './product-shell.module.scss';
import { ToastProvider } from './toast';
import { largeViewportQuery, useMediaQuery } from './use-media-query';

type PanelId =
  'account' | 'help' | 'notifications' | 'search' | 'settings' | 'switcher';

type ProductShellProperties = Readonly<{
  children: ReactNode;
  feedbackEmail?: string | undefined;
  invitationCount?: number | undefined;
  notifications?: readonly NotificationRow[] | undefined;
  railPinned: boolean;
  unreadCount?: number | undefined;
  user: Readonly<{ email: string; name: string }>;
  version: string;
}>;

export default function ProductShell({
  children,
  feedbackEmail,
  invitationCount,
  notifications,
  railPinned,
  unreadCount,
  user,
  version,
}: ProductShellProperties) {
  return (
    <ToastProvider>
      <ActiveOrganizationProvider>
        <ShellChrome
          feedbackEmail={feedbackEmail}
          invitationCount={invitationCount}
          notifications={notifications}
          railPinned={railPinned}
          unreadCount={unreadCount}
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
  invitationCount = 0,
  notifications = [],
  railPinned,
  unreadCount = 0,
  user,
  version,
}: ProductShellProperties) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const route = activeRoute(pathname);
  const organization = useActiveOrganization();
  const isLarge = useMediaQuery(largeViewportQuery, true);
  const [pinned, setPinned] = useState(railPinned);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  const [trackedRailPinned, setTrackedRailPinned] = useState(railPinned);
  const triggerRef = useRef<HTMLElement | null>(null);

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

  // Escape dismisses any open panel or the mobile navigation and returns focus
  // to the action that opened it, so keyboard users never lose their place.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        const trigger = triggerRef.current;
        setOpenPanel(null);
        setMobileOpen(false);
        if (trigger !== null) {
          trigger.focus();
          triggerRef.current = null;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A pointer press outside the header closes any open panel. The panels and
  // the search field render inside the header element, so a press that resolves
  // to the header is never treated as outside. Focus is left where the user
  // clicked.
  useEffect(() => {
    if (openPanel === null) {
      return;
    }
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.cds--header') === null
      ) {
        setOpenPanel(null);
        triggerRef.current = null;
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

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
    const active = document.activeElement;
    triggerRef.current = active instanceof HTMLElement ? active : null;
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
          <HeaderName href="/workspaces" prefix="Afframe">
            Analytics
          </HeaderName>
          <HeaderNavigation aria-label="Areas">
            <HeaderMenuItem href="/workspaces" isActive>
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
              aria-expanded={openPanel === 'notifications'}
              aria-label={t('shell.notifications.title')}
              className={styles.invitationAction!}
              isActive={openPanel === 'notifications'}
              onClick={() => togglePanel('notifications')}
              tooltipAlignment="end"
            >
              <Notification size={20} />
              {unreadCount + invitationCount > 0 ? (
                <span aria-hidden="true" className={styles.invitationBadge!}>
                  {unreadCount + invitationCount}
                </span>
              ) : null}
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
              aria-expanded={openPanel === 'settings'}
              aria-label={t('shell.settings.title')}
              isActive={openPanel === 'settings'}
              onClick={() => togglePanel('settings')}
              tooltipAlignment="end"
            >
              <Settings size={20} />
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
          <NotificationsPanel
            expanded={openPanel === 'notifications'}
            invitationCount={invitationCount}
            notifications={notifications}
            unreadCount={unreadCount}
          />
          <HelpPanel
            expanded={openPanel === 'help'}
            feedbackEmail={feedbackEmail}
            version={version}
          />
          <SettingsPanel expanded={openPanel === 'settings'} />
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
