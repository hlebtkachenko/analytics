import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { I18nProvider } from '../../i18n/client-provider';
import EntityMultiSelect from './entity-multiselect';

// jsdom ships no matchMedia, which Carbon's list box reads on mount.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

const entities = [
  { id: 'entity-b', name: 'Beta Trading' },
  { id: 'entity-a', name: 'Alpha Holding' },
];

// A stateful host, so a selection feeds back through the controlled prop.
function Host({ onIds }: { onIds: (ids: readonly string[]) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <EntityMultiSelect
      entities={entities}
      onChange={(next) => {
        setIds([...next]);
        onIds(next);
      }}
      selectedIds={ids}
    />
  );
}

function renderHost(onIds: (ids: readonly string[]) => void) {
  render(
    <I18nProvider>
      <Host onIds={onIds} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EntityMultiSelect', () => {
  it('lists the entities sorted by name behind the Legal entity control', () => {
    renderHost(() => {});

    fireEvent.click(screen.getByRole('combobox', { name: 'Legal entity' }));
    const options = screen
      .getAllByRole('option')
      .map((option) => option.getAttribute('aria-label'));
    expect(options).toEqual(['Alpha Holding', 'Beta Trading']);
  });

  it('reports the ids of the entities chosen', async () => {
    const onIds = vi.fn();
    renderHost(onIds);

    fireEvent.click(screen.getByRole('combobox', { name: 'Legal entity' }));
    fireEvent.click(screen.getByRole('option', { name: 'Alpha Holding' }));
    await waitFor(() => {
      expect(onIds.mock.calls.at(-1)?.[0]).toEqual(['entity-a']);
    });

    fireEvent.click(screen.getByRole('option', { name: 'Beta Trading' }));
    await waitFor(() => {
      expect(onIds.mock.calls.at(-1)?.[0]).toEqual(['entity-a', 'entity-b']);
    });
  });

  it('reports no id after the selection is cleared', async () => {
    const onIds = vi.fn();
    renderHost(onIds);

    fireEvent.click(screen.getByRole('combobox', { name: 'Legal entity' }));
    fireEvent.click(screen.getByRole('option', { name: 'Alpha Holding' }));
    const clear = await screen.findByRole('button', { name: /Clear/ });
    fireEvent.click(clear);

    await waitFor(() => {
      expect(onIds.mock.calls.at(-1)?.[0]).toEqual([]);
    });
  });
});
