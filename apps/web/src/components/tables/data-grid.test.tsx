import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataGrid } from './data-grid';
import type { GridColumn, GridRow } from './types';

const columns: readonly GridColumn[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'score', header: 'Score', sortable: true, align: 'end' },
];

const rows: readonly GridRow[] = [
  { id: '1', name: 'beta', score: 30 },
  { id: '2', name: 'alpha', score: 10 },
  { id: '3', name: 'gamma', score: 20 },
];

function bodyRowText(): string[] {
  const [, ...body] = screen.getAllByRole('row');
  return body.map((row) => row.textContent ?? '');
}

afterEach(cleanup);

describe('DataGrid', () => {
  it('renders headers and every row', () => {
    render(<DataGrid columns={columns} rows={rows} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(bodyRowText()).toHaveLength(3);
  });

  it('sorts ascending when a sortable header is clicked', () => {
    render(<DataGrid columns={columns} rows={rows} sortable />);
    expect(bodyRowText()[0]).toContain('beta');
    fireEvent.click(screen.getByText('Score'));
    expect(bodyRowText()[0]).toContain('alpha');
  });

  it('keeps missing values last in both sort directions', () => {
    const withGap: readonly GridRow[] = [
      { id: '1', name: 'alpha', score: 5 },
      { id: '2', name: 'beta', score: null },
      { id: '3', name: 'gamma', score: 3 },
    ];
    render(<DataGrid columns={columns} rows={withGap} sortable />);
    const scoreHeader = screen.getByText('Score');
    fireEvent.click(scoreHeader);
    expect(bodyRowText().at(-1)).toContain('beta');
    fireEvent.click(scoreHeader);
    expect(bodyRowText()[0]).toContain('alpha');
    expect(bodyRowText().at(-1)).toContain('beta');
  });

  it('filters rows with the client search', () => {
    render(<DataGrid columns={columns} rows={rows} search />);
    fireEvent.change(screen.getByPlaceholderText('Search rows'), {
      target: { value: 'alpha' },
    });
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
  });

  it('reports multi selection changes', () => {
    const onSelectionChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        onSelectionChange={onSelectionChange}
        rows={rows}
        selection="multi"
      />,
    );
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    const checkbox = within(firstBodyRow).getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalledWith(['1']);
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataGrid columns={columns} emptyLabel="Nothing here" rows={[]} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('limits the page to the client page size', () => {
    const many: GridRow[] = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      name: `row-${index}`,
      score: index,
    }));
    render(<DataGrid columns={columns} pageSize={2} pagination rows={many} />);
    expect(bodyRowText()).toHaveLength(2);
  });
});
