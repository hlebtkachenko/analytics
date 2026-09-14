export type Crumb = Readonly<{ current: boolean; href: string; label: string }>;

// The module label for a top-level or descendant segment.
export const moduleLabels: Readonly<Record<string, string>> = {
  access: 'Access',
  account: 'Account',
  assistant: 'AI Assistant',
  datasets: 'Datasets',
  entities: 'Entities',
  members: 'Members',
  new: 'Create organization',
  organizations: 'Organizations',
  settings: 'Settings',
};

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
      label: moduleLabels[segment] ?? segment,
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
