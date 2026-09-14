'use client';

import { Asleep, Light, Logout } from '@bap/design-system/icons';
import {
  Button,
  HeaderPanel,
  RadioButton,
  RadioButtonGroup,
  Switcher,
  SwitcherDivider,
  SwitcherItem,
  Tag,
} from '@bap/design-system/react';
import { themeModes, useThemeMode } from '@bap/design-system/theme';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { authClient } from '../../lib/auth/client';
import {
  themeCookieName,
  writePreferenceCookie,
} from '../../lib/preferences/cookies';
import styles from './header-panels.module.scss';
import { useToast } from './toast';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
);

type PanelProperties = Readonly<{ expanded: boolean }>;

export function SwitcherPanel({
  activeSlug,
  expanded,
}: PanelProperties & Readonly<{ activeSlug?: string | undefined }>) {
  const [organizations, setOrganizations] = useState<
    z.infer<typeof organizationsSchema>
  >([]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const controller = new AbortController();
    void fetch('/api/auth/organization/list', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => setOrganizations(organizationsSchema.parse(payload)))
      .catch(() => {});
    return () => controller.abort();
  }, [expanded]);

  return (
    <HeaderPanel aria-label="Workspaces" expanded={expanded}>
      {expanded ? (
        <Switcher aria-label="Workspaces">
          {organizations.map((organization) => (
            <SwitcherItem
              aria-label={organization.name}
              href={`/${organization.slug}`}
              isSelected={organization.slug === activeSlug}
              key={organization.id}
            >
              {organization.name}
            </SwitcherItem>
          ))}
          <SwitcherDivider />
          <SwitcherItem
            aria-label="Create organization"
            href="/organizations/new"
          >
            Create organization
          </SwitcherItem>
          <SwitcherItem aria-label="Manage organizations" href="/organizations">
            Manage organizations
          </SwitcherItem>
        </Switcher>
      ) : null}
    </HeaderPanel>
  );
}

export function NotificationsPanel({ expanded }: PanelProperties) {
  return (
    <HeaderPanel aria-label="Notifications" expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <Tag type="gray">Placeholder</Tag>
          <p>You have no notifications yet.</p>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function HelpPanel({ expanded }: PanelProperties) {
  const { notify } = useToast();
  const soon = (title: string) => () =>
    notify({
      subtitle: `${title} is not available yet.`,
      title: 'Coming soon',
    });

  return (
    <HeaderPanel aria-label="Help" expanded={expanded}>
      {expanded ? (
        <div className={styles.menu!}>
          <Button kind="ghost" onClick={soon('Documentation')}>
            Documentation
          </Button>
          <Button kind="ghost" onClick={soon('Send feedback')}>
            Send feedback
          </Button>
          <Button kind="ghost" onClick={soon("What's new")}>
            What&apos;s new
          </Button>
          <Button kind="ghost" onClick={soon('About')}>
            About
          </Button>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function SettingsPanel({ expanded }: PanelProperties) {
  return (
    <HeaderPanel aria-label="Settings" expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <p>Application preferences arrive with the first product module.</p>
          <Link href="/account">Account settings</Link>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

const modeLabels: Readonly<Record<(typeof themeModes)[number], string>> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

export function AccountPanel({ expanded }: PanelProperties) {
  const router = useRouter();
  const { mode, setMode } = useThemeMode();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <HeaderPanel aria-label="Account" expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <div className={styles.appearance!}>
            <Light aria-hidden="true" focusable="false" size={16} />
            <Asleep aria-hidden="true" focusable="false" size={16} />
          </div>
          <RadioButtonGroup
            legendText="Appearance"
            name="theme-mode"
            onChange={(value) => {
              const next = value as (typeof themeModes)[number];
              setMode(next);
              writePreferenceCookie(themeCookieName, next);
            }}
            orientation="vertical"
            valueSelected={mode}
          >
            {themeModes.map((option) => (
              <RadioButton
                key={option}
                labelText={modeLabels[option]}
                value={option}
              />
            ))}
          </RadioButtonGroup>
          <Link href="/account">Manage account</Link>
          <Button
            kind="secondary"
            onClick={() => void signOut()}
            renderIcon={Logout}
            type="button"
          >
            Sign out
          </Button>
        </div>
      ) : null}
    </HeaderPanel>
  );
}
