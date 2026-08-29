import { useVirtualizer } from '@tanstack/react-virtual';
import { Heading, Search, Stack, Tile } from '@bap/design-system/react';
import type { CarbonCatalog } from '@bap/design-system/catalog';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  carbonColorTokens,
  carbonFonts,
  carbonLayoutTokens,
  carbonMotionTokens,
  carbonSpacingTokens,
  carbonThemes,
  carbonTypeTokens,
} from '../shared/catalog.js';

type FoundationCategory =
  | 'aliases'
  | 'charts-api'
  | 'colors'
  | 'fonts'
  | 'grid'
  | 'layers'
  | 'layout'
  | 'mixins'
  | 'motion'
  | 'react-api'
  | 'react-cjs'
  | 'react-esm'
  | 'sass-variables'
  | 'spacing'
  | 'themes'
  | 'theme-values'
  | 'type'
  | 'functions';

type FoundationItem = Readonly<{
  detail: string;
  group: string;
  name: string;
}>;

function valueText(value: unknown) {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function tokenItems(
  group: string,
  tokens: readonly Readonly<{ name: string; value: unknown }>[],
) {
  return tokens.map((token) => ({
    detail: valueText(token.value),
    group,
    name: token.name,
  }));
}

function propertyText(
  properties: readonly Readonly<{
    name: string;
    optional: boolean;
    type: string;
    values: readonly (boolean | number | string)[] | null;
  }>[],
) {
  if (!properties.length) return 'Properties: none';
  return `Properties:\n${properties
    .map(
      (property) =>
        `${property.name}${property.optional ? '?' : ''}: ${property.type}${property.values ? ` (${property.values.join(', ')})` : ''}`,
    )
    .join('\n')}`;
}

export function reactApiItems(catalog: CarbonCatalog): FoundationItem[] {
  return [...catalog.react.declarations, ...catalog.react.namespaceMembers].map(
    (entry) => ({
      detail: [
        `Status: ${entry.status}`,
        `Classification: ${entry.classification}`,
        `Renderability: ${entry.renderability}`,
        `Alias: ${entry.aliasOf ?? 'none'}`,
        `Props: ${entry.props ? `${entry.props.carbonOwnedPropertyCount} Carbon-owned, ${entry.props.inheritedPropertyCount} inherited` : 'none'}`,
        `Props type: ${entry.props?.type ?? 'none'}`,
        `Props path: ${entry.props?.declarationPath ?? 'none'}`,
        `Path: ${entry.declarationPath ?? 'none'}`,
      ].join('\n'),
      group: entry.ancestry.length ? entry.ancestry.join('.') : 'React root',
      name: entry.qualifiedName,
    }),
  );
}

export function reactRuntimeItems(
  catalog: CarbonCatalog,
  mode: 'cjs' | 'esm',
): FoundationItem[] {
  return catalog.react[mode].map((entry) => {
    const synthetic =
      entry.name === 'default' || entry.name === 'module.exports';
    return {
      detail: [
        `Mode: ${mode.toUpperCase()}`,
        `Export kind: ${entry.exportKey}`,
        `Runtime type: ${entry.runtimeType}`,
        synthetic ? 'Synthetic Node CJS interop key' : 'Installed root export',
      ].join('\n'),
      group: synthetic
        ? `React ${mode.toUpperCase()} synthetic interop`
        : `React ${mode.toUpperCase()} root`,
      name: entry.name,
    };
  });
}

export function chartsApiItems(catalog: CarbonCatalog): FoundationItem[] {
  const declarations = catalog.inventories.charts?.declarations ?? {};
  return Object.entries(declarations).flatMap(([packageName, entries]) =>
    entries.map((entry) => ({
      detail: [
        `Type-only: ${entry.typeOnly ? 'yes' : 'no'}`,
        `Alias: ${entry.aliasOf ?? 'none'}`,
        `Path: ${entry.declarationPath ?? 'none'}`,
        propertyText(entry.properties),
      ].join('\n'),
      group: packageName,
      name: entry.name,
    })),
  );
}

function compactItems(category: FoundationCategory): FoundationItem[] {
  if (category === 'themes') {
    return carbonThemes.map((name) => ({
      detail: 'Installed Carbon theme',
      group: 'themes',
      name,
    }));
  }
  if (category === 'colors') return tokenItems('colors', carbonColorTokens);
  if (category === 'layout') return tokenItems('layout', carbonLayoutTokens);
  if (category === 'motion') return tokenItems('motion', carbonMotionTokens);
  if (category === 'type') return tokenItems('type', carbonTypeTokens);
  if (category === 'spacing') {
    return carbonSpacingTokens.map(([name, detail]) => ({
      detail,
      group: 'spacing',
      name,
    }));
  }
  if (category === 'fonts') {
    return carbonFonts.map((font) => ({
      detail: `${font.weights.join(', ')}; ${font.styles.join(', ')}`,
      group: 'fonts',
      name: font.family,
    }));
  }
  return [];
}

function catalogItems(
  category: Exclude<
    FoundationCategory,
    'colors' | 'fonts' | 'layout' | 'motion' | 'spacing' | 'themes' | 'type'
  >,
  catalog: CarbonCatalog,
) {
  if (category === 'react-api') return reactApiItems(catalog);
  if (category === 'react-cjs') return reactRuntimeItems(catalog, 'cjs');
  if (category === 'react-esm') return reactRuntimeItems(catalog, 'esm');
  if (category === 'charts-api') return chartsApiItems(catalog);
  const sassEntries = catalog.sass.flatMap((module) =>
    module.variables.map((variable) => ({
      detail: variable.value,
      group: module.module,
      name: variable.name,
    })),
  );
  if (category === 'theme-values') {
    return tokenItems('themes', catalog.inventories.themes?.cjs ?? []);
  }
  if (category === 'layers') {
    return tokenItems(
      'theme layers',
      (catalog.inventories.themes?.cjs ?? []).filter((token) =>
        token.name.includes('layer'),
      ),
    );
  }
  if (category === 'grid') {
    return (catalog.inventories.grid?.sass?.variables ?? []).map(
      (variable) => ({
        detail: variable.value,
        group: 'grid',
        name: variable.name,
      }),
    );
  }
  if (category === 'sass-variables') return sassEntries;
  if (category === 'aliases') {
    const counts = new Map<string, number>();
    for (const item of sassEntries) {
      counts.set(item.detail, (counts.get(item.detail) ?? 0) + 1);
    }
    return sassEntries.filter((item) => (counts.get(item.detail) ?? 0) > 1);
  }
  const property = category === 'mixins' ? 'mixins' : 'functions';
  return catalog.sass.flatMap((module) =>
    module[property].map((name) => ({
      detail: `${property.slice(0, -1)} exported by ${module.module}`,
      group: module.module,
      name,
    })),
  );
}

function needsCatalog(category: FoundationCategory) {
  return ![
    'colors',
    'fonts',
    'layout',
    'motion',
    'spacing',
    'themes',
    'type',
  ].includes(category);
}

function categoryTitle(category: FoundationCategory) {
  return {
    aliases: 'Sass aliases',
    'charts-api': 'Charts API and option declarations',
    colors: 'Color values',
    fonts: 'Self-hosted fonts',
    functions: 'Sass functions',
    grid: 'Grid and breakpoints',
    layers: 'Layer values',
    layout: 'Layout values',
    mixins: 'Sass mixins',
    motion: 'Motion values',
    'react-api': 'React API declarations and namespaces',
    'react-cjs': 'React CommonJS root exports',
    'react-esm': 'React ESM root exports',
    'sass-variables': 'Sass variables and maps',
    spacing: 'Spacing values',
    themes: 'Themes',
    'theme-values': 'Semantic theme values',
    type: 'Typography values',
  }[category];
}

function VirtualItems({
  items,
  label,
}: Readonly<{ items: readonly FoundationItem[]; label: string }>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 82,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });
  return (
    <div
      aria-label={label}
      className="bap-workbench-virtual"
      ref={parentRef}
      role="region"
      tabIndex={0}
    >
      <div
        className="bap-workbench-virtual-inner"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (!item) return null;
          return (
            <Tile
              className="bap-workbench-virtual-row"
              key={`${item.group}-${item.name}`}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <strong>{item.name}</strong>
              <p>{item.detail}</p>
              <small>{item.group}</small>
            </Tile>
          );
        })}
      </div>
    </div>
  );
}

export function FoundationExplorer({
  category,
}: Readonly<{ category: FoundationCategory }>) {
  const [catalog, setCatalog] = useState<CarbonCatalog>();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!needsCatalog(category)) return;
    let active = true;
    void import('@bap/design-system/catalog').then(({ carbonCatalog }) => {
      if (active) setCatalog(carbonCatalog);
    });
    return () => {
      active = false;
    };
  }, [category]);
  const source = needsCatalog(category)
    ? catalog
      ? catalogItems(
          category as Exclude<
            FoundationCategory,
            | 'colors'
            | 'fonts'
            | 'layout'
            | 'motion'
            | 'spacing'
            | 'themes'
            | 'type'
          >,
          catalog,
        )
      : []
    : compactItems(category);
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return source
      .filter((item) =>
        normalized
          ? `${item.name} ${item.detail} ${item.group}`
              .toLowerCase()
              .includes(normalized)
          : true,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [query, source]);
  return (
    <Stack gap={6}>
      <Heading>{categoryTitle(category)}</Heading>
      <Search
        id={`foundation-${category}`}
        labelText={`Search ${categoryTitle(category)}`}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search installed values"
        value={query}
      />
      {needsCatalog(category) && !catalog ? (
        <p>Loading local full catalog.</p>
      ) : null}
      <p>{items.length} installed entries.</p>
      <VirtualItems
        items={items}
        label={`Scrollable ${categoryTitle(category)}`}
      />
    </Stack>
  );
}
