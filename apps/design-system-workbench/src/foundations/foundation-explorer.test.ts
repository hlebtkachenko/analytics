import { carbonCatalog } from '@bap/design-system/catalog';
import { describe, expect, it } from 'vitest';

import {
  chartsApiItems,
  reactApiItems,
  reactRuntimeItems,
} from './foundation-explorer.js';

describe('foundation API explorers', () => {
  it('includes every React declaration and recursive namespace member', () => {
    const items = reactApiItems(carbonCatalog);
    const expected = [
      ...carbonCatalog.react.declarations,
      ...carbonCatalog.react.namespaceMembers,
    ].map((entry) => entry.qualifiedName);
    expect(items.map((item) => item.name)).toEqual(expected);
    expect(items).toHaveLength(743);
    expect(items.find((item) => item.name === 'usePrefix')?.detail).toContain(
      'Classification: hook',
    );
  });

  it('keeps CJS and ESM root exports separate and labels interop keys', () => {
    const cjs = reactRuntimeItems(carbonCatalog, 'cjs');
    const esm = reactRuntimeItems(carbonCatalog, 'esm');
    expect(cjs.map((item) => item.name)).toEqual(
      carbonCatalog.react.cjs.map((entry) => entry.name),
    );
    expect(esm.map((item) => item.name)).toEqual(
      carbonCatalog.react.esm.map((entry) => entry.name),
    );
    expect(
      esm
        .filter((item) => item.group.includes('synthetic'))
        .map((item) => item.name),
    ).toEqual(['default', 'module.exports']);
  });

  it('includes every React and core chart declaration with option controls', () => {
    const items = chartsApiItems(carbonCatalog);
    const declarations = carbonCatalog.inventories.charts?.declarations ?? {};
    expect(items).toHaveLength(
      Object.values(declarations).reduce(
        (count, entries) => count + entries.length,
        0,
      ),
    );
    expect(
      items.find(
        (item) =>
          item.group === '@carbon/charts' && item.name === 'ChartOptions',
      )?.detail,
    ).toContain('animations?: boolean | undefined (false, true)');
  });
});
