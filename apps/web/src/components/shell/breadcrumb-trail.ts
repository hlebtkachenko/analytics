export type Crumb = Readonly<{ current: boolean; href: string; label: string }>;

// The module label for a top-level segment, and the label a shared descendant reuses.
export const moduleLabels: Readonly<Record<string, string>> = {
  account: 'Account',
  assistant: 'AI Assistant',
  datasets: 'Datasets',
  documents: 'Documents',
  entities: 'Entities',
  members: 'Members',
  organizations: 'Workspaces',
  settings: 'Settings',
};

// Child labels are scoped by their parent module, so `new` never reads the same
// under two modules. Add the parent, then the child segment, to name one.
const childLabels: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    account: {
      access: 'Access',
      preferences: 'Preferences',
      security: 'Security',
    },
    documents: { analytics: 'Analytics', new: 'New document' },
    organizations: { new: 'Create workspace' },
  };

// The label an unknown child segment takes, so an opaque identifier never reaches the trail.
const childFallbacks: Readonly<Record<string, string>> = {
  documents: 'Document',
};

function segmentLabel(segment: string, parent: string | undefined): string {
  const scoped =
    parent === undefined ? undefined : childLabels[parent]?.[segment];
  if (scoped !== undefined) {
    return scoped;
  }
  return (
    moduleLabels[segment] ??
    (parent === undefined ? undefined : childFallbacks[parent]) ??
    segment
  );
}

// Builds the full breadcrumb trail from route segments. Route-group segments are
// filtered out. The first segment is either a known module or a workspace slug.
export function buildTrail(
  segments: readonly string[],
  organization?: Readonly<{ name: string; slug: string }>,
): Crumb[] {
  const parts = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  if (parts.length === 0) {
    return [];
  }

  const crumbs: Crumb[] = [];
  const first = parts[0]!;
  const isModule = first in moduleLabels;

  let href = '';
  let start = 0;

  if (!isModule) {
    // A workspace slug route: Organizations, then the organization, then descendants.
    crumbs.push({
      current: false,
      href: '/organizations',
      label: moduleLabels.organizations!,
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
      label: segmentLabel(segment, index === 0 ? undefined : parts[index - 1]),
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
