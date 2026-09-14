'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  Column,
  Grid,
  OverflowMenu,
  OverflowMenuItem,
} from '@bap/design-system/react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';

import { useActiveOrganization } from './active-organization';
import { buildTrail, collapseTrail } from './breadcrumb-trail';
import type { Crumb } from './breadcrumb-trail';
import styles from './breadcrumbs.module.scss';

function renderCrumb(crumb: Crumb) {
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

  // The current page is the page title, so the breadcrumb shows only ancestors.
  const ancestors = crumbs.slice(0, -1);
  if (ancestors.length === 0) {
    return null;
  }

  const { head, hidden, tail } = collapseTrail(ancestors);

  return (
    <div className={styles.band!}>
      <Grid className={styles.grid!}>
        <Column lg={16} md={8} sm={4}>
          <Breadcrumb size="sm">
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
        </Column>
      </Grid>
    </div>
  );
}
