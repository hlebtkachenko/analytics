import { DataGrid, PivotGrid, TreeDataGrid } from '@bap/design-system/blocks';
import {
  datasetColumns,
  infrastructureTree,
  makeDatasetRows,
  pivotConfig,
  treeColumns,
} from '@bap/design-system/blocks/fixtures';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  parameters: {
    docs: {
      description: {
        component:
          'BAP composed block components (DataGrid, TreeDataGrid, PivotGrid) built on Carbon primitives. These are BAP extensions, not native Carbon components.',
      },
    },
  },
  tags: ['bap-extension'],
  title: 'BAP Extensions/Table blocks',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const DataGridStory: Story = {
  render: () => (
    <DataGrid
      columns={datasetColumns}
      pagination
      rowNumbers
      rows={makeDatasetRows(20)}
      search
      sortable
      title="Datasets"
    />
  ),
};

export const TreeStory: Story = {
  render: () => (
    <TreeDataGrid
      columns={treeColumns}
      nodes={infrastructureTree}
      title="Infrastructure"
    />
  ),
};

export const PivotStory: Story = {
  render: () => (
    <PivotGrid
      config={pivotConfig}
      rows={makeDatasetRows(60)}
      title="Dataset pivot"
    />
  ),
};
