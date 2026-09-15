import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
});
