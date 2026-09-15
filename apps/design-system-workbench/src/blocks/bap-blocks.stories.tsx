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

export const DataGridExtensionsStory: Story = {
  name: 'DataGrid (extensions)',
  render: () => (
    <DataGrid
      columns={datasetColumns.map((column) => {
        if (column.key === 'name') {
          return { ...column, editor: { type: 'text' } as const };
        }
        if (column.key === 'steward') {
          return {
            ...column,
            editor: {
              type: 'select',
              options: ['Platform', 'Ingestion', 'Reporting', 'Governance'],
            } as const,
          };
        }
        return column;
      })}
      onCellEdit={() => undefined}
      rowActions={() => [
        { id: 'edit', label: 'Edit', onClick: () => undefined },
        {
          id: 'delete',
          label: 'Delete',
          isDelete: true,
          onClick: () => undefined,
        },
      ]}
      rows={makeDatasetRows(12)}
      sortable
      title="Datasets with BAP extensions"
      toolbarActions={[
        { id: 'create', label: 'Create dataset', onClick: () => undefined },
      ]}
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
