import {
  Button,
  Column,
  Grid,
  Heading,
  Stack,
  Tile,
} from '@bap/design-system/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { FoundationExplorer } from './foundation-explorer.js';
import '../shared/workbench.scss';

const meta = {
  component: Tile,
  parameters: { layout: 'padded' },
  title: 'Foundations/Overview',
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: () => (
    <Stack gap={7}>
      <Heading>Carbon foundation catalog</Heading>
      <p>
        Search every pinned theme, token, Sass symbol, font, grid value, and
        motion value. The larger Sass inventory loads only when its explorer is
        opened.
      </p>
      <Grid condensed>
        <Column sm={4} md={4} lg={4}>
          <Tile>
            <Heading>Foundations</Heading>
            <p>
              Semantic themes, color, type, spacing, layout, layers, and motion.
            </p>
          </Tile>
        </Column>
        <Column sm={4} md={4} lg={4}>
          <Tile>
            <Heading>System symbols</Heading>
            <p>
              Grid maps, Sass aliases, mixins, functions, and self-hosted fonts.
            </p>
          </Tile>
        </Column>
        <Column sm={4} md={4} lg={4}>
          <Tile>
            <Heading>Workbench controls</Heading>
            <p>
              Switch themes, provider flags, and Carbon reference viewports.
            </p>
          </Tile>
        </Column>
      </Grid>
      <Button kind="primary">Carbon button</Button>
    </Stack>
  ),
};

export const Themes: Story = {
  render: () => <FoundationExplorer category="themes" />,
};
export const SemanticThemeValues: Story = {
  render: () => <FoundationExplorer category="theme-values" />,
};
export const ReactApiDeclarations: Story = {
  render: () => <FoundationExplorer category="react-api" />,
};
export const ReactCommonJsExports: Story = {
  render: () => <FoundationExplorer category="react-cjs" />,
};
export const ReactEsmExports: Story = {
  render: () => <FoundationExplorer category="react-esm" />,
};
export const Colors: Story = {
  render: () => <FoundationExplorer category="colors" />,
};
export const Typography: Story = {
  render: () => <FoundationExplorer category="type" />,
};
export const Spacing: Story = {
  render: () => <FoundationExplorer category="spacing" />,
};
export const Layout: Story = {
  render: () => <FoundationExplorer category="layout" />,
};
export const GridAndBreakpoints: Story = {
  render: () => <FoundationExplorer category="grid" />,
};
export const Layers: Story = {
  render: () => <FoundationExplorer category="layers" />,
};
export const Motion: Story = {
  render: () => <FoundationExplorer category="motion" />,
};
export const Fonts: Story = {
  render: () => <FoundationExplorer category="fonts" />,
};
export const SassVariablesAndMaps: Story = {
  render: () => <FoundationExplorer category="sass-variables" />,
};
export const SassAliases: Story = {
  render: () => <FoundationExplorer category="aliases" />,
};
export const SassMixins: Story = {
  render: () => <FoundationExplorer category="mixins" />,
};
export const SassFunctions: Story = {
  render: () => <FoundationExplorer category="functions" />,
};
export const ChartsApiAndOptions: Story = {
  render: () => <FoundationExplorer category="charts-api" />,
};
