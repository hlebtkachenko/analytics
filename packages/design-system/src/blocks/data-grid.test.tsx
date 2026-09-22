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

  it('wraps the table in a container that never widens its parent', () => {
    const { container } = render(<DataGrid columns={columns} rows={rows} />);
    const section = container.querySelector('.cds--data-table-container');
    expect(section?.className).toContain('container');
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

  it('reports the next sort spec without reordering rows in server mode', () => {
    const onSortChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        onSortChange={onSortChange}
        rows={rows}
        sortMode="server"
        sortable
      />,
    );
    fireEvent.click(screen.getByText('Score'));
    expect(onSortChange).toHaveBeenCalledWith([
      { key: 'score', direction: 'ASC' },
    ]);
    expect(bodyRowText()[0]).toContain('beta');
  });

  it('cycles the controlled server sort through descending and cleared', () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataGrid
        columns={columns}
        onSortChange={onSortChange}
        rows={rows}
        sort={[{ key: 'score', direction: 'ASC' }]}
        sortMode="server"
        sortable
      />,
    );
    expect(screen.getByText('Score').closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    fireEvent.click(screen.getByText('Score'));
    expect(onSortChange).toHaveBeenLastCalledWith([
      { key: 'score', direction: 'DESC' },
    ]);
    rerender(
      <DataGrid
        columns={columns}
        onSortChange={onSortChange}
        rows={rows}
        sort={[{ key: 'score', direction: 'DESC' }]}
        sortMode="server"
        sortable
      />,
    );
    fireEvent.click(screen.getByText('Score'));
    expect(onSortChange).toHaveBeenLastCalledWith([]);
  });

  it('filters rows with the client search', () => {
    render(<DataGrid columns={columns} rows={rows} search />);
    fireEvent.change(screen.getByPlaceholderText('Search rows'), {
      target: { value: 'alpha' },
    });
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
  });

  it('names each search landmark from its grid title', () => {
    render(
      <>
        <DataGrid columns={columns} rows={rows} search title="My workspaces" />
        <DataGrid
          columns={columns}
          rows={rows}
          search
          title="Joined workspaces"
        />
      </>,
    );
    expect(screen.getAllByRole('search')).toHaveLength(2);
    expect(
      screen.getByRole('search', { name: 'Search My workspaces' }),
    ).not.toBe(
      screen.getByRole('search', { name: 'Search Joined workspaces' }),
    );
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

  it('hides the batch action bar from focus until a row is selected', () => {
    render(
      <DataGrid
        batchActions={[{ id: 'archive', label: 'Archive', onClick: vi.fn() }]}
        columns={columns}
        rows={rows}
        selection="multi"
      />,
    );
    const action = screen.getByText('Archive').closest('button') as HTMLElement;
    expect(action).toHaveAttribute('tabindex', '-1');
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(firstBodyRow).getByRole('checkbox'));
    expect(action).toHaveAttribute('tabindex', '0');
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

  it('does not fire the row click when the overflow menu is used', () => {
    const onRowClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <DataGrid
        columns={columns}
        onRowClick={onRowClick}
        rowActions={() => [{ id: 'edit', label: 'Edit', onClick: onEdit }]}
        rows={rows}
      />,
    );
    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(firstBodyRow).getByRole('button'));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(within(firstBodyRow).getByText('beta'));
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
    );
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

  it('announces the error state through an alert', () => {
    render(
      <DataGrid
        columns={columns}
        errorLabel="Rows went missing"
        rows={[]}
        state="error"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Rows went missing');
  });

  it('places the given placeholder in the search field', () => {
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        search
        searchPlaceholder="Search documents"
      />,
    );
    expect(screen.getByPlaceholderText('Search documents')).toBeInTheDocument();
  });

  it('marks its root so it shrinks inside a grid or flex parent', () => {
    const { container } = render(<DataGrid columns={columns} rows={rows} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(styles.container!);
  });

  it('narrows rows to the applied filter selection', () => {
    render(
      <DataGrid
        columns={columns}
        filters={[
          {
            heading: 'Name',
            key: 'name',
            options: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta' },
            ],
          },
        ]}
        rows={rows}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const body = bodyRowText();
    expect(body).toHaveLength(1);
    expect(body[0]).toContain('alpha');
  });

  it('leaves rows untouched and reports the applied values in server mode', () => {
    const onFilterChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        filters={[
          {
            heading: 'Name',
            key: 'name',
            options: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta' },
            ],
          },
        ]}
        filterValues={{ name: [] }}
        onFilterChange={onFilterChange}
        rows={rows}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onFilterChange).toHaveBeenCalledWith({ name: ['alpha'] });
    expect(bodyRowText()).toHaveLength(3);
  });

  it('shows the count of applied filter selections in the badge', () => {
    const { container } = render(
      <DataGrid
        columns={columns}
        filters={[
          {
            heading: 'Name',
            key: 'name',
            options: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta' },
            ],
          },
        ]}
        rows={rows}
      />,
    );
    expect(container.querySelector(`.${styles.filterCount!}`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(
      container.querySelector(`.${styles.filterCount!}`)?.textContent,
    ).toBe('2');
  });

  it('clears the staged selection when reset is clicked', () => {
    render(
      <DataGrid
        columns={columns}
        filters={[
          {
            heading: 'Name',
            key: 'name',
            options: [{ id: 'alpha', label: 'Alpha' }],
          },
        ]}
        rows={rows}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const alpha = screen.getByRole('checkbox', {
      name: 'Alpha',
    }) as HTMLInputElement;
    fireEvent.click(alpha);
    expect(alpha.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      (screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
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
