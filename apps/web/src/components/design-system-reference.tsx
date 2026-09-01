'use client';

import { Launch } from '@bap/design-system/icons';
import {
  Button,
  Column,
  Grid,
  Heading,
  Layer,
  Section,
  Stack,
  Tag,
  Tile,
} from '@bap/design-system/react';
import {
  carbonChartComponents,
  carbonComponentFamilies,
  carbonThemes,
} from '@bap/design-system/tokens';
import { useTranslation } from 'react-i18next';

import '../i18n/client';

export function DesignSystemReference() {
  const { t } = useTranslation();

  return (
    <main aria-labelledby="design-system-heading">
      <Grid>
        <Column lg={16} md={8} sm={4}>
          <Stack gap={7}>
            <header>
              <Heading id="design-system-heading">
                {t('reference.title')}
              </Heading>
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
            <Section level={2}>
              <Layer>
                <Tile>
                  <Heading>Implementation reference</Heading>
                  <Stack gap={5}>
                    <p>
                      {carbonComponentFamilies.length} source component families
                      and {carbonChartComponents.length} standard chart types
                      are cataloged without creating product screens.
                    </p>
                    <p>Available themes: {carbonThemes.join(', ')}.</p>
                    <Button
                      href="https://carbondesignsystem.com/developing/frameworks/react/"
                      kind="tertiary"
                      rel="noreferrer"
                      renderIcon={Launch}
                      target="_blank"
                    >
                      Open Carbon React documentation
                    </Button>
                  </Stack>
                </Tile>
              </Layer>
            </Section>
          </Stack>
        </Column>
      </Grid>
    </main>
  );
}
