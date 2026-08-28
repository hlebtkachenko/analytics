'use client';

import {
  Column,
  Grid,
  Heading,
  Layer,
  Link,
  Stack,
  Tag,
  Tile,
} from '@bap/design-system/react';
import {
  carbonChartComponents,
  carbonComponentFamilies,
  carbonThemes,
} from '@bap/design-system/tokens';

export function DesignSystemReference() {
  return (
    <main aria-labelledby="design-system-heading">
      <Grid>
        <Column lg={16} md={8} sm={4}>
          <Stack gap={7}>
            <header>
              <Heading id="design-system-heading">Carbon design system</Heading>
              <p>
                BAP exposes the official Carbon React, icon, and chart APIs
                through a version-pinned workspace package.
              </p>
            </header>
            <Stack gap={3} orientation="horizontal">
              <Tag type="green">Client facades</Tag>
              <Tag type="cool-gray">Sass tokens</Tag>
              <Tag type="purple">Accessible charts</Tag>
            </Stack>
            <Layer>
              <Tile>
                <Heading>Implementation reference</Heading>
                <Stack gap={5}>
                  <p>
                    {carbonComponentFamilies.length} source component families
                    and {carbonChartComponents.length} standard chart types are
                    cataloged without creating product screens.
                  </p>
                  <p>Available themes: {carbonThemes.join(', ')}.</p>
                  <Link
                    href="https://carbondesignsystem.com/developing/frameworks/react/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Carbon React documentation
                  </Link>
                </Stack>
              </Tile>
            </Layer>
          </Stack>
        </Column>
      </Grid>
    </main>
  );
}
