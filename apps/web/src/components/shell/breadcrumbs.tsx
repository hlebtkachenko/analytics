'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  OverflowMenu,
  OverflowMenuItem,
} from '@bap/design-system/react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';

import { useActiveOrganization } from './active-organization';
import { buildTrail, collapseTrail } from './breadcrumb-trail';
import type { Crumb } from './breadcrumb-trail';

function renderCrumb(crumb: Crumb) {
  if (crumb.current) {
    return (
      <BreadcrumbItem isCurrentPage key={crumb.href}>
        {crumb.label}
      </BreadcrumbItem>
    );
  }
  return (
    <BreadcrumbItem key={crumb.href}>
      <Link href={{ pathname: crumb.href }}>{crumb.label}</Link>
    </BreadcrumbItem>
  );
}

export default function Breadcrumbs() {
  const segments = useSelectedLayoutSegments();
  const organization = useActiveOrganization();
  const crumbs = buildTrail(
    segments,
    organization && { name: organization.name, slug: organization.slug },
  );

  // Top-level pages and linear tasks carry no breadcrumb.
  if (crumbs.length <= 1) {
    return null;
  }

  const { head, hidden, tail } = collapseTrail(crumbs);

  return (
    <Breadcrumb noTrailingSlash size="sm">
      {head.map(renderCrumb)}
      {hidden.length > 0 ? (
        <BreadcrumbItem data-floating-menu-container>
          <OverflowMenu aria-label="Show hidden breadcrumbs" size="sm">
            {hidden.map((crumb) => (
              <OverflowMenuItem
                href={crumb.href}
                itemText={crumb.label}
                key={crumb.href}
              />
            ))}
          </OverflowMenu>
        </BreadcrumbItem>
      ) : null}
      {tail.map(renderCrumb)}
    </Breadcrumb>
  );
}
