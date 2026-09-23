export type Crumb = Readonly<{ current: boolean; href: string; label: string }>;

// Resolves a navigation translation key; the trail never hands it a workspace name or an opaque id.
type Translate = (key: string) => string;

// The module label key for a top-level segment, and the key a shared descendant reuses.
export const moduleLabelKeys: Readonly<Record<string, string>> = {
  account: 'shell.nav.account',
  assistant: 'shell.nav.assistant',
  datasets: 'shell.nav.datasets',
  documents: 'shell.nav.documents',
  entities: 'shell.nav.entities',
  inbox: 'shell.nav.inbox',
  members: 'shell.nav.members',
  notifications: 'shell.nav.notifications',
  settings: 'shell.nav.settings',
  workspaces: 'shell.nav.workspaces',
};

// Child label keys are scoped by their parent module, so `new` never reads the
// same under two modules. Add the parent, then the child segment, to name one.
const childLabelKeys: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  account: {
    access: 'shell.nav.accountAccess',
    preferences: 'shell.nav.accountPreferences',
    security: 'shell.nav.accountSecurity',
  },
  documents: {
    analytics: 'shell.nav.documentsAnalytics',
    new: 'shell.nav.documentsNew',
  },
  inbox: {
    channels: 'shell.nav.inboxChannels',
    rules: 'shell.nav.inboxRules',
  },
  workspaces: { new: 'shell.nav.workspacesNew' },
};

// The label key an unknown child segment takes, so an opaque identifier never reaches the trail.
const childFallbackKeys: Readonly<Record<string, string>> = {
  documents: 'shell.nav.singleDocument',
  inbox: 'shell.nav.inboxItem',
};

function segmentLabel(
  segment: string,
  parent: string | undefined,
  translate: Translate,
): string {
  const scoped =
    parent === undefined ? undefined : childLabelKeys[parent]?.[segment];
  if (scoped !== undefined) {
    return translate(scoped);
  }
  const key =
    moduleLabelKeys[segment] ??
    (parent === undefined ? undefined : childFallbackKeys[parent]);
  // An unknown segment is an opaque identifier, never a key.
  return key === undefined ? segment : translate(key);
}

// Builds the full breadcrumb trail from route segments. Route-group segments are
// filtered out. The first segment is either a known module or a workspace slug.
export function buildTrail(
  segments: readonly string[],
  organization: Readonly<{ name: string; slug: string }> | undefined,
  translate: Translate,
): Crumb[] {
  const parts = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  if (parts.length === 0) {
    return [];
  }

  const crumbs: Crumb[] = [];
  const first = parts[0]!;
  const isModule = first in moduleLabelKeys;

  let href = '';
  let start = 0;

  if (!isModule) {
    // A workspace slug route: Organizations, then the organization, then descendants.
    crumbs.push({
      current: false,
      href: '/workspaces',
      label: translate(moduleLabelKeys.workspaces!),
    });
    href = `/${first}`;
    crumbs.push({
      current: parts.length === 1,
      href,
      label: organization?.slug === first ? organization.name : first,
    });
    start = 1;
  }

  for (let index = start; index < parts.length; index += 1) {
    const segment = parts[index]!;
    href += `/${segment}`;
    crumbs.push({
      current: index === parts.length - 1,
      href,
      label: segmentLabel(
        segment,
        index === 0 ? undefined : parts[index - 1],
        translate,
      ),
    });
  }

  return crumbs;
}

export type CollapsedTrail = Readonly<{
  head: Crumb[];
  hidden: Crumb[];
  tail: Crumb[];
}>;

// Keeps the first crumb and the last two, hiding the middle behind an overflow
// once the trail grows beyond the maximum.
export function collapseTrail(crumbs: Crumb[], max = 5): CollapsedTrail {
  if (crumbs.length <= max) {
    return { head: crumbs, hidden: [], tail: [] };
  }
  return {
    head: crumbs.slice(0, 1),
    hidden: crumbs.slice(1, -2),
    tail: crumbs.slice(-2),
  };
}
