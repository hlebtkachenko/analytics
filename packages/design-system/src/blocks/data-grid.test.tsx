import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataGrid } from './data-grid';
import styles from './data-grid.module.scss';
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

  it('freezes a pinned column with a sticky left offset', () => {
    const pinnedColumns: readonly GridColumn[] = [
      { key: 'name', header: 'Name', pinned: true, width: 200 },
      { key: 'score', header: 'Score', width: 120, align: 'end' },
    ];
    render(<DataGrid columns={pinnedColumns} rows={rows} />);
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    const [nameCell, scoreCell] = within(firstBodyRow).getAllByRole('cell');
    expect((nameCell as HTMLElement).style.position).toBe('sticky');
    expect((nameCell as HTMLElement).style.left).toBe('0px');
    expect((scoreCell as HTMLElement).style.position).toBe('');
  });

  it('renders a toolbar action button and fires its handler', () => {
    const onClick = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        toolbarActions={[{ id: 'create', label: 'Create dataset', onClick }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create dataset' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('opens a per-row overflow menu and runs the chosen action', () => {
    const onEdit = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rowActions={() => [{ id: 'edit', label: 'Edit', onClick: onEdit }]}
        rows={rows}
      />,
    );
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(firstBodyRow).getByRole('button'));
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('expands a row to reveal its detail content', () => {
    render(
      <DataGrid
        columns={columns}
        renderRowDetail={(row) => <div>Detail for {String(row.name)}</div>}
        rows={rows}
      />,
    );
    expect(screen.queryByText('Detail for beta')).not.toBeInTheDocument();
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(
      within(firstBodyRow).getByRole('button', {
        name: 'Toggle detail for row 1',
      }),
    );
    expect(screen.getByText('Detail for beta')).toBeInTheDocument();
  });

  it('commits an inline text edit on Enter', () => {
    const onCellEdit = vi.fn();
    const editableColumns: readonly GridColumn[] = [
      { key: 'name', header: 'Name', editor: { type: 'text' } },
      { key: 'score', header: 'Score', align: 'end' },
    ];
    render(
      <DataGrid
        columns={editableColumns}
        onCellEdit={onCellEdit}
        rows={rows}
      />,
    );
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(firstBodyRow).getByText('beta'));
    const input = within(firstBodyRow).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'beta-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellEdit).toHaveBeenCalledWith('1', 'name', 'beta-2');
  });

  it('commits an inline checkbox edit immediately', () => {
    const onCellEdit = vi.fn();
    const editableColumns: readonly GridColumn[] = [
      { key: 'name', header: 'Name' },
      { key: 'active', header: 'Active', editor: { type: 'checkbox' } },
    ];
    const boolRows: readonly GridRow[] = [
      { id: '1', name: 'beta', active: false },
    ];
    render(
      <DataGrid
        columns={editableColumns}
        onCellEdit={onCellEdit}
        rows={boolRows}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCellEdit).toHaveBeenCalledWith('1', 'active', true);
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataGrid columns={columns} emptyLabel="Nothing here" rows={[]} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('marks its root so it shrinks inside a grid or flex parent', () => {
    const { container } = render(<DataGrid columns={columns} rows={rows} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(styles.root!);
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
