import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { compileString } from 'sass';
import { isValidElementType } from 'react-is';
import type * as TypeScript from 'typescript';
import { describe, expect, it } from 'vitest';

import * as bapCharts from './charts.js';
import { loadCarbonCatalog } from './catalog.js';
import { carbonComponentCatalog } from './component-catalog.generated.js';
import * as bapIcons from './icons.js';
import * as bapPictograms from './pictograms.js';
import * as bapReact from './react.js';
import {
  carbonChartComponents,
  carbonChartDiagramPrimitives,
  carbonChartExperimentalComponents,
  carbonColorTokens,
  carbonComponentFamilies,
  carbonFeatureFlagDefaults,
  carbonFeatureFlagProviderProps,
  carbonFeatureFlags,
  carbonLayoutTokens,
  carbonMotionTokens,
  carbonSpacingTokens,
  carbonThemeTokens,
  carbonThemes,
  carbonTypographyTokens,
  carbonTypeTokens,
} from './tokens.js';

const packageRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const cjsReact = require('@carbon/react');
const cjsIcons = require('@carbon/icons-react');
const cjsPictograms = require('@carbon/pictograms-react');
const cjsCharts = require('@carbon/charts-react');
const cjsColors = require('@carbon/colors');
const cjsLayout = require('@carbon/layout');
const cjsMotion = require('@carbon/motion');
const cjsThemes = require('@carbon/themes');
const cjsType = require('@carbon/type');
const reactRoot = path.dirname(require.resolve('@carbon/react/package.json'));
const chartsReactRoot = path.dirname(
  require.resolve('@carbon/charts-react/package.json'),
);
const chartsRequire = createRequire(path.join(chartsReactRoot, 'catalog.cjs'));
const chartsRoot = path.dirname(
  chartsRequire.resolve('@carbon/charts/package.json'),
);
const cjsFeatureFlags = require(
  require.resolve('@carbon/feature-flags', { paths: [reactRoot] }),
);

function nodeEsmKeys(request: string) {
  const source =
    'const value = await import(process.argv.at(-1)); process.stdout.write(JSON.stringify(Object.keys(value).sort()));';
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', source, request],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    ),
  ) as string[];
}

function facadeEsmKeys(request: string) {
  return nodeEsmKeys(request).filter(
    (name) => name !== 'default' && name !== 'module.exports',
  );
}

function facadeKeys(module: object) {
  return Object.keys(module)
    .filter((name) => name !== 'default' && name !== 'module.exports')
    .sort();
}

function upstreamExportKey(name: string) {
  if (name === 'default') return 'default';
  if (name === 'module' || name === 'export=') return 'module';
  if (name.startsWith('__')) return 'synthetic';
  return 'named';
}

function upstreamJsonValue(value: unknown) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function upstreamTokenEntries(module: Record<string, unknown>) {
  return Object.keys(module)
    .sort()
    .map((name) => ({
      exportKey: upstreamExportKey(name),
      name,
      runtimeType: typeof module[name],
      value: upstreamJsonValue(module[name]),
    }));
}

const privateMetadataPattern =
  /\/(?:Users|home)\/|(?:^|[^a-z0-9])\.pnpm\/|node_modules\/\.pnpm\/|Conductor\/workspaces\/|workspaces\/analytics\/jerusalem|saas-foundation/i;

function declaredExports() {
  const declarationPath = path.join(reactRoot, 'es/index.d.ts');
  const ts = require('typescript');
  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declarationPath);
  if (!source) throw new Error('Cannot read Carbon React declarations');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol)
    throw new Error('Cannot resolve Carbon React declarations');
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol: { getName(): string }) => symbol.getName())
    .sort();
}

function reactDeclarationSymbols() {
  const ts = require('typescript') as typeof TypeScript;
  const declarationPath = path.join(reactRoot, 'es/index.d.ts');
  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declarationPath);
  if (!source) throw new Error('Cannot read Carbon React declarations');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol)
    throw new Error('Cannot resolve Carbon React declarations');
  const symbols = new Map<string, TypeScript.Symbol>();
  const visit = (parent: TypeScript.Symbol, ancestry: readonly string[]) => {
    for (const symbol of checker.getExportsOfModule(parent)) {
      const qualifiedName = [...ancestry, symbol.getName()].join('.');
      symbols.set(qualifiedName, symbol);
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      if (target.flags & ts.SymbolFlags.Module) {
        visit(target, [...ancestry, symbol.getName()]);
      }
    }
  };
  visit(moduleSymbol, []);
  return { checker, symbols, ts };
}

function hasPublicPropsSignature(
  symbol: TypeScript.Symbol,
  checker: TypeScript.TypeChecker,
  ts: typeof TypeScript,
) {
  const target =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declaration =
    symbol.valueDeclaration ??
    symbol.getDeclarations()?.[0] ??
    target.valueDeclaration ??
    target.getDeclarations()?.[0];
  if (!declaration) return false;
  const valueType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  return [
    ...valueType.getCallSignatures(),
    ...valueType.getConstructSignatures(),
  ].some((signature) => signature.getParameters().length > 0);
}

function chartDeclaredExports(declarationPath: string) {
  const ts = require('typescript');
  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declarationPath);
  if (!source) throw new Error(`Cannot read ${declarationPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol)
    throw new Error(`Cannot resolve declarations for ${declarationPath}`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol: { getName(): string }) => symbol.getName())
    .sort((left: string, right: string) => left.localeCompare(right));
}

function runtimeAtPath(qualifiedName: string) {
  return qualifiedName.split('.').reduce<unknown>((value, name) => {
    if (
      value === null ||
      (typeof value !== 'function' && typeof value !== 'object')
    ) {
      return undefined;
    }
    return (value as Record<string, unknown>)[name];
  }, cjsReact);
}

function sassInventory(module: string) {
  const output: string[] = [];
  compileString(
    `@use 'sass:meta'; @use '${module}' as value; @each $name, $item in meta.module-variables(value) { @debug '__BAP_VARIABLE__' + $name + '__' + meta.inspect($item); } @each $name, $item in meta.module-mixins(value) { @debug '__BAP_MIXIN__' + $name; } @each $name, $item in meta.module-functions(value) { @debug '__BAP_FUNCTION__' + $name; }`,
    {
      loadPaths: ['node_modules', '../../node_modules/.pnpm/node_modules'],
      logger: { debug: (message) => output.push(message), warn: () => {} },
      quietDeps: true,
    },
  );
  const variables = output
    .filter((message) => message.startsWith('__BAP_VARIABLE__'))
    .map((message) => {
      const separator = message.indexOf('__', '__BAP_VARIABLE__'.length);
      return {
        name: message.slice('__BAP_VARIABLE__'.length, separator),
        value: message.slice(separator + 2),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const names = (prefix: string) =>
    output
      .filter((message) => message.startsWith(prefix))
      .map((message) => message.slice(prefix.length))
      .sort();
  return {
    functions: names('__BAP_FUNCTION__'),
    mixins: names('__BAP_MIXIN__'),
    variables,
  };
}

function providerMapping() {
  const source = readFileSync(
    path.join(reactRoot, 'es/components/FeatureFlags/index.js'),
    'utf8',
  );
  const mapping = source.match(/const PROP_TO_FLAG = \{([\s\S]*?)\};/);
  const body = mapping?.[1];
  if (!body) throw new Error('Cannot read Carbon FeatureFlags mapping');
  return [...body.matchAll(/(\w+):\s*"([^"]+)"/g)]
    .map((match) => {
      const name = match[1];
      const flag = match[2];
      if (!name || !flag)
        throw new Error('Cannot parse Carbon FeatureFlags mapping');
      return { flag, name };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

describe('Carbon catalog', () => {
  it('records exact independent CJS and Node ESM module namespaces', async () => {
    const catalog = await loadCarbonCatalog();
    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.react.cjs.map((entry) => entry.name)).toEqual(
      Object.keys(cjsReact).sort(),
    );
    expect(catalog.react.esm.map((entry) => entry.name)).toEqual(
      nodeEsmKeys('@carbon/react'),
    );

    for (const [name, cjs] of [
      ['icons', cjsIcons],
      ['pictograms', cjsPictograms],
      ['charts', cjsCharts],
    ] as const) {
      expect(catalog.inventories[name]?.cjs.map((entry) => entry.name)).toEqual(
        Object.keys(cjs).sort(),
      );
      expect(catalog.inventories[name]?.esm.map((entry) => entry.name)).toEqual(
        nodeEsmKeys(
          `@carbon/${name === 'charts' ? 'charts-react' : `${name}-react`}`,
        ),
      );
    }
  });

  it('keeps full facades in ESM parity and the icon facade curated', async () => {
    expect(facadeKeys(bapReact)).toEqual(facadeEsmKeys('@carbon/react'));
    expect(facadeKeys(bapIcons)).toEqual([
      'AiGenerate',
      'ArrowLeft',
      'ArrowRight',
      'Checkmark',
      'Close',
      'DataSet',
      'Download',
      'Email',
      'Launch',
      'Login',
      'Logout',
      'Password',
      'Security',
      'Send',
      'Upload',
      'UserFollow',
      'UserMultiple',
      'View',
    ]);
    expect(facadeKeys(bapPictograms)).toEqual(
      facadeEsmKeys('@carbon/pictograms-react'),
    );
    expect(
      facadeKeys(bapCharts).filter((name) => name !== 'ChartFrame'),
    ).toEqual(facadeEsmKeys('@carbon/charts-react'));
  });

  it('compares declarations and renderability against independent upstream surfaces', async () => {
    const catalog = await loadCarbonCatalog();
    expect(
      catalog.react.declarations.map((entry) => entry.name).sort(),
    ).toEqual(declaredExports());
    expect(catalog.react.declarations.some((entry) => entry.typeOnly)).toBe(
      true,
    );
    expect(
      catalog.react.namespaceMembers.every(
        (entry) =>
          entry.qualifiedName === `${entry.parent}.${entry.name}` &&
          entry.depth >= 1,
      ),
    ).toBe(true);
    expect(
      [...catalog.react.declarations, ...catalog.react.namespaceMembers].filter(
        (entry) => entry.renderability === 'unknown',
      ),
    ).toEqual([]);
    expect(
      [...catalog.react.declarations, ...catalog.react.namespaceMembers]
        .filter((entry) => entry.renderability === 'renderable')
        .every((entry) =>
          isValidElementType(runtimeAtPath(entry.qualifiedName)),
        ),
    ).toBe(true);
    expect(
      catalog.react.declarations
        .filter((entry) => entry.classification === 'context')
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      'ErrorBoundaryContext',
      'FormContext',
      'PrefixContext',
      'ThemeContext',
    ]);
  });

  it('infers every public renderable props signature independently', async () => {
    const catalog = await loadCarbonCatalog();
    const { checker, symbols, ts } = reactDeclarationSymbols();
    const renderable = [
      ...catalog.react.declarations,
      ...catalog.react.namespaceMembers,
    ].filter((entry) => entry.renderability === 'renderable');
    const inferable = renderable.filter((entry) => {
      const symbol = symbols.get(entry.qualifiedName);
      expect(symbol, entry.qualifiedName).toBeDefined();
      return symbol ? hasPublicPropsSignature(symbol, checker, ts) : false;
    });
    expect(inferable.length).toBeGreaterThan(0);
    expect(
      inferable
        .filter((entry) => entry.props === null)
        .map((entry) => entry.qualifiedName),
    ).toEqual([]);
    expect(
      renderable
        .filter((entry) => entry.props?.type === 'any')
        .map((entry) => entry.qualifiedName)
        .sort(),
    ).toEqual(['preview_OverflowMenuV2', 'unstable_OverflowMenuV2']);
  });

  it.each([
    ['PrimaryButton', 'kind', 'ButtonProps'],
    ['FluidNumberInput', 'id', 'FluidNumberInputProps'],
    ['Table', 'size', 'TableProps'],
    ['HStack', 'orientation', 'StackProps'],
  ])('captures signature props for %s', async (name, property, propsName) => {
    const catalog = await loadCarbonCatalog();
    const entry = catalog.react.declarations.find(
      (candidate) => candidate.name === name,
    );
    expect(entry?.props).toMatchObject({ name: propsName });
    expect(entry?.props?.carbonOwnedPropertyCount).toBeGreaterThan(0);
    expect(entry?.props?.declarationPath).toMatch(/^es\//);
    expect(entry?.props?.properties.map((item) => item.name)).toContain(
      property,
    );
  });

  it('keeps the compact component catalog aligned with heavy renderability metadata', async () => {
    const catalog = await loadCarbonCatalog();
    const expected = [
      ...catalog.react.declarations,
      ...catalog.react.namespaceMembers,
    ]
      .filter((entry) => entry.renderability === 'renderable')
      .map((entry) => ({
        aliasOf: entry.aliasOf,
        canonicalName: entry.canonicalName,
        controls:
          entry.props?.properties
            .filter((property) => property.values !== null)
            .map(({ name, values }) => ({ name, values })) ?? [],
        name: entry.qualifiedName,
        renderability: entry.renderability,
        requiredParent: entry.requiredParent,
        status: entry.status,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(carbonComponentCatalog).toEqual(expected);
  });

  it('uses only public export names for alias metadata', async () => {
    const catalog = await loadCarbonCatalog();
    const declarations = [
      ...catalog.react.declarations,
      ...catalog.react.namespaceMembers,
    ];
    const publicNames = new Set(
      declarations.map((entry) => entry.qualifiedName),
    );
    for (const entry of declarations) {
      expect(publicNames.has(entry.canonicalName), entry.qualifiedName).toBe(
        true,
      );
      expect(entry.aliasOf, entry.qualifiedName).toBe(
        entry.canonicalName === entry.qualifiedName
          ? null
          : entry.canonicalName,
      );
    }

    for (const entries of Object.values(
      catalog.inventories.charts?.declarations ?? {},
    )) {
      const names = new Set(entries.map((entry) => entry.name));
      for (const entry of entries) {
        expect(names.has(entry.canonicalName), entry.name).toBe(true);
        expect(entry.aliasOf, entry.name).toBe(
          entry.canonicalName === entry.name ? null : entry.canonicalName,
        );
      }
    }
  });

  it('captures every installed chart declaration and option control', async () => {
    const catalog = await loadCarbonCatalog();
    const declarations = catalog.inventories.charts?.declarations;
    const reactDeclarations = declarations?.['@carbon/charts-react'];
    const coreDeclarations = declarations?.['@carbon/charts'];
    expect(reactDeclarations?.map((entry) => entry.name)).toEqual(
      chartDeclaredExports(path.join(chartsReactRoot, 'dist/index.d.ts')),
    );
    expect(coreDeclarations?.map((entry) => entry.name)).toEqual(
      chartDeclaredExports(path.join(chartsRoot, 'dist/index.d.ts')),
    );
    const chartOptions = coreDeclarations?.find(
      (entry) => entry.name === 'ChartOptions',
    );
    expect(chartOptions).toMatchObject({
      declarationPath: 'dist/interfaces/charts.d.ts',
      typeOnly: true,
    });
    expect(chartOptions?.properties.length).toBeGreaterThan(0);
    expect(
      chartOptions?.properties.find((entry) => entry.name === 'animations'),
    ).toMatchObject({ values: [false, true] });

    const diagramDeclarations = new Map(
      reactDeclarations?.map((entry) => [entry.name, entry]) ?? [],
    );
    expect(
      diagramDeclarations
        .get('ShapeNode')
        ?.properties.find((entry) => entry.name === 'shape'),
    ).toMatchObject({ values: ['circle', 'square', 'rounded-square'] });
    expect(
      diagramDeclarations
        .get('CardNode')
        ?.properties.find((entry) => entry.name === 'tag'),
    ).toMatchObject({ values: ['div', 'a', 'button'] });
    for (const name of [
      'Marker',
      'ArrowLeftMarker',
      'ArrowRightMarker',
      'CircleMarker',
      'DiamondMarker',
      'SquareMarker',
      'TeeMarker',
    ]) {
      expect(
        diagramDeclarations
          .get(name)
          ?.properties.find((entry) => entry.name === 'position'),
        name,
      ).toMatchObject({ values: ['end', 'start'] });
    }
  });

  it('never serializes machine-specific catalog metadata', async () => {
    const catalog = await loadCarbonCatalog();
    const artifacts = [
      JSON.stringify(catalog),
      readFileSync(
        path.join(packageRoot, 'src/catalog.generated.json'),
        'utf8',
      ),
      readFileSync(path.join(packageRoot, 'src/catalog.generated.ts'), 'utf8'),
      readFileSync(
        path.join(packageRoot, 'src/component-catalog.generated.ts'),
        'utf8',
      ),
    ];
    for (const artifact of artifacts) {
      expect(artifact).not.toMatch(privateMetadataPattern);
    }
  });

  it('derives all installed feature defaults and only real provider props', async () => {
    const catalog = await loadCarbonCatalog();
    const defaults = Object.fromEntries(
      [...cjsFeatureFlags.FeatureFlags.flags.entries()].sort(
        ([left], [right]) => left.localeCompare(right),
      ),
    );
    expect(catalog.featureFlags.defaults).toEqual(defaults);
    expect(carbonFeatureFlagDefaults).toEqual(defaults);
    expect(carbonFeatureFlags).toEqual(catalog.featureFlags.installed);
    expect(
      carbonFeatureFlagProviderProps.map(({ flag, name }) => ({ flag, name })),
    ).toEqual(providerMapping());
    expect(carbonFeatureFlagProviderProps).toEqual(
      catalog.featureFlags.providerProps,
    );
    expect(cjsFeatureFlags.FeatureFlags.flags.get('enable-v11-release')).toBe(
      true,
    );
  });

  it('serializes every inspectable Sass variable, map, mixin, and function', async () => {
    const catalog = await loadCarbonCatalog();
    for (const module of catalog.sass) {
      const actual = sassInventory(module.module);
      expect(module.variables).toEqual(actual.variables);
      expect(module.mixins).toEqual(actual.mixins);
      expect(module.functions).toEqual(actual.functions);
    }
    expect(
      catalog.inventories.grid?.sass?.variables.some(
        (entry) => entry.name === 'grid-breakpoints',
      ),
    ).toBe(true);
  });

  it('keeps compact token, chart, and theme exports derived from installed metadata', async () => {
    const catalog = await loadCarbonCatalog();
    expect(carbonThemes).toEqual(catalog.derived.themes);
    expect(carbonSpacingTokens).toEqual(catalog.derived.spacingTokens);
    expect(carbonTypographyTokens).toEqual(catalog.derived.typographyTokens);
    expect(carbonComponentFamilies).toEqual(catalog.derived.componentFamilies);
    expect(carbonChartComponents).toEqual(catalog.derived.chartComponents);
    expect(carbonChartExperimentalComponents).toEqual(
      catalog.derived.chartExperimentalComponents,
    );
    expect(carbonChartDiagramPrimitives).toEqual(
      catalog.derived.chartDiagramPrimitives,
    );
    for (const [summary, inventory, upstream] of [
      [carbonColorTokens, catalog.inventories.colors, cjsColors],
      [carbonThemeTokens, catalog.inventories.themes, cjsThemes],
      [carbonLayoutTokens, catalog.inventories.layout, cjsLayout],
      [carbonMotionTokens, catalog.inventories.motion, cjsMotion],
      [carbonTypeTokens, catalog.inventories.type, cjsType],
    ] as const) {
      const expected = upstreamTokenEntries(upstream);
      expect(inventory?.cjs).toEqual(expected);
      expect(summary).toEqual(expected);
    }
  });

  it('keeps full metadata lazy and generated artifacts deterministic', () => {
    const tokens = readFileSync(
      path.join(packageRoot, 'src/tokens.ts'),
      'utf8',
    );
    const index = readFileSync(path.join(packageRoot, 'src/index.ts'), 'utf8');
    expect(tokens).not.toContain("from './catalog.js'");
    expect(index).not.toContain("from './catalog.js'");
    expect(
      statSync(path.join(packageRoot, 'src/catalog.generated.ts')).size,
    ).toBeLessThan(750_000);
    expect(
      statSync(path.join(packageRoot, 'src/catalog.generated.json')).size,
    ).toBeGreaterThan(1_000_000);
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/generate-carbon-catalog.mjs', '--check'],
        {
          cwd: packageRoot,
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  }, 60_000);
});
