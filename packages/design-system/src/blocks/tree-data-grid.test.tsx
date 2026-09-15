import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TreeDataGrid } from './tree-data-grid';
import type { GridColumn, TreeNode } from './types';

afterEach(() => {
  cleanup();
});

const columns: readonly GridColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'kind', header: 'Kind' },
];

// A 3-level fixture: region > cluster > node.
const nodes: readonly TreeNode[] = [
  {
    id: 'eu-central',
    cells: { name: 'eu-central', kind: 'Region' },
    children: [
      {
        id: 'cluster-a',
        cells: { name: 'cluster-a', kind: 'Cluster' },
        children: [
          {
            id: 'node-a1',
            cells: { name: 'node-a1', kind: 'Node' },
          },
        ],
      },
    ],
  },
];

describe('TreeDataGrid', () => {
  it('shows the top level by default and hides deep children until expanded', () => {
    render(<TreeDataGrid columns={columns} nodes={nodes} />);

    expect(screen.getByText('eu-central')).toBeVisible();
    expect(screen.getByText('cluster-a')).toBeVisible();
    expect(screen.queryByText('node-a1')).not.toBeInTheDocument();
  });

  it('reveals a deep child once every ancestor is expanded', () => {
    render(<TreeDataGrid columns={columns} nodes={nodes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand cluster-a' }));

    expect(screen.getByText('node-a1')).toBeVisible();
  });

  it('hides children again when the toggle is clicked a second time', () => {
    render(<TreeDataGrid columns={columns} nodes={nodes} />);

    const regionToggle = screen.getByRole('button', {
      name: 'Collapse eu-central',
    });
    fireEvent.click(regionToggle);

    expect(screen.queryByText('cluster-a')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand eu-central' }),
    ).toBeVisible();
  });

  it('sorts siblings within a parent rather than globally', () => {
    // A second top-level region with clusters in reverse alphabetical order.
    const sortNodes: readonly TreeNode[] = [
      {
        id: 'us-east',
        cells: { name: 'us-east', kind: 'Region' },
        children: [
          { id: 'us-cluster-z', cells: { name: 'zeta', kind: 'Cluster' } },
          { id: 'us-cluster-a', cells: { name: 'alpha', kind: 'Cluster' } },
        ],
      },
      {
        id: 'eu-central',
        cells: { name: 'eu-central', kind: 'Region' },
        children: [
          { id: 'eu-cluster-b', cells: { name: 'bravo', kind: 'Cluster' } },
        ],
      },
    ];
    const sortColumns: readonly GridColumn[] = [
      { key: 'name', header: 'Name', sortable: true },
      { key: 'kind', header: 'Kind' },
    ];

    render(<TreeDataGrid columns={sortColumns} nodes={sortNodes} sortable />);

    // Top-level regions start expanded, so their clusters are already visible.
    fireEvent.click(screen.getByText('Name'));

    const rows = screen.getAllByRole('row');
    const rowTexts = rows.map((row) => row.textContent ?? '');
    const zetaIndex = rowTexts.findIndex((text) => text.includes('zeta'));
    const alphaIndex = rowTexts.findIndex((text) => text.includes('alpha'));

    // Siblings under 'us-east' sort ascending by name: alpha before zeta.
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(zetaIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeLessThan(zetaIndex);
  });

  it('keeps ancestors of a matching deep node visible while searching', () => {
    render(<TreeDataGrid columns={columns} nodes={nodes} search />);

    fireEvent.change(screen.getByPlaceholderText('Search rows'), {
      target: { value: 'node-a1' },
    });

    expect(screen.getByText('eu-central')).toBeVisible();
    expect(screen.getByText('cluster-a')).toBeVisible();
    expect(screen.getByText('node-a1')).toBeVisible();
  });

  it('cascades a subtree selection and reports its ids', () => {
    const onSelectionChange = vi.fn();
    render(
      <TreeDataGrid
        columns={columns}
        nodes={nodes}
        onSelectionChange={onSelectionChange}
        selection="multi"
      />,
    );

    fireEvent.click(screen.getByLabelText('Select cluster-a'));

    expect(onSelectionChange).toHaveBeenCalledWith(['cluster-a', 'node-a1']);
  });
});
