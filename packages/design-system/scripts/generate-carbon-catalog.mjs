import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { isValidElementType } from 'react-is';

import { carbonRenderabilityOverrides } from './carbon-renderability-overrides.mjs';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(import.meta.dirname, '..');
const jsonOutputPath = path.join(packageRoot, 'src/catalog.generated.json');
const summaryOutputPath = path.join(packageRoot, 'src/catalog.generated.ts');
const componentSummaryOutputPath = path.join(
  packageRoot,
  'src/component-catalog.generated.ts',
);
const prettier = require('prettier');
const ts = require('typescript');
const sass = require('sass');

const runtimePackages = [
  '@carbon/colors',
  '@carbon/layout',
  '@carbon/motion',
  '@carbon/themes',
  '@carbon/type',
  '@carbon/icons-react',
  '@carbon/pictograms-react',
  '@carbon/charts-react',
];

const valuePackages = new Set([
  '@carbon/colors',
  '@carbon/layout',
  '@carbon/motion',
  '@carbon/themes',
  '@carbon/type',
]);

const sassModules = [
  '@carbon/react/scss/colors',
  '@carbon/react/scss/grid',
  '@carbon/react/scss/layout',
  '@carbon/react/scss/motion',
  '@carbon/react/scss/spacing',
  '@carbon/react/scss/theme',
  '@carbon/react/scss/themes',
  '@carbon/react/scss/type',
];

function packageData(name, paths) {
  const packagePath = paths
    ? require.resolve(`${name}/package.json`, { paths })
    : require.resolve(`${name}/package.json`);
  const metadata = require(packagePath);
  return {
    name: metadata.name,
    version: metadata.version,
    gitHead: metadata.gitHead ?? null,
    license: metadata.license ?? null,
    repository: metadata.repository?.url ?? null,
  };
}

function sourceRoot(name, paths) {
  return path.dirname(
    paths
      ? require.resolve(`${name}/package.json`, { paths })
      : require.resolve(`${name}/package.json`),
  );
}

function exportKey(name) {
  if (name === 'default') return 'default';
  if (name === 'module' || name === 'export=') return 'module';
  if (name.startsWith('__')) return 'synthetic';
  return 'named';
}

function targetOf(symbol, checker) {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function publicCanonicalNames(symbols, checker, ancestry = []) {
  const byTarget = new Map();
  for (const symbol of symbols) {
    const target = targetOf(symbol, checker);
    const candidates = byTarget.get(target) ?? [];
    candidates.push(symbol.getName());
    byTarget.set(target, candidates);
  }

  return new Map(
    [...byTarget].map(([target, candidates]) => {
      const targetName = portableSymbolName(target.getName());
      const canonical = candidates.includes(targetName)
        ? targetName
        : [...candidates].sort((left, right) => {
            const statusRank = (name) =>
              name.startsWith('preview')
                ? 1
                : name.startsWith('unstable')
                  ? 2
                  : 0;
            return (
              statusRank(left) - statusRank(right) || left.localeCompare(right)
            );
          })[0];
      return [target, [...ancestry, canonical].join('.')];
    }),
  );
}

function hasValue(symbol) {
  return (symbol.flags & ts.SymbolFlags.Value) !== 0;
}

function tagsFor(symbol) {
  return (
    symbol
      .getDeclarations()
      ?.flatMap((declaration) => ts.getJSDocTags(declaration))
      .map((tag) => tag.tagName.text) ?? []
  );
}

function labelsFor(name, source, target, ancestry) {
  const labels = [];
  const qualifiedName = [...ancestry, name].join('.');
  if (/preview_/.test(qualifiedName)) labels.push('preview');
  if (/unstable_/.test(qualifiedName)) labels.push('unstable');
  if ([...tagsFor(source), ...tagsFor(target)].includes('deprecated'))
    labels.push('deprecated');
  return labels.length ? labels : ['stable'];
}

function statusFor(labels) {
  if (labels.includes('deprecated')) return 'deprecated';
  if (labels.includes('unstable')) return 'unstable';
  if (labels.includes('preview')) return 'preview';
  return 'stable';
}

function portableMetadataText(value) {
  return value
    .replaceAll('\\', '/')
    .replace(
      /(["'])[^"']*\/node_modules\/((?:@[^/"']+\/)?[^/"']+)([^"']*)\1/g,
      (_, quote, packageName, suffix) =>
        `${quote}${packageName}${suffix}${quote}`,
    );
}

function portableSymbolName(value) {
  const normalized = portableMetadataText(value);
  const quoted = normalized.match(/^["'](.+)["']$/);
  return quoted?.[1] ?? normalized;
}

function assertPortableCatalog(catalog) {
  const serialized = JSON.stringify(catalog);
  const forbidden = [
    /\/(?:Users|home)\//,
    /(?:^|[^a-z0-9])\.pnpm\//i,
    /node_modules\/\.pnpm\//,
    /(?:Conductor\/)?workspaces\/[^/"\\]+/,
  ];
  const match = forbidden.find((pattern) => pattern.test(serialized));
  if (match)
    throw new Error(
      `Carbon catalog contains non-portable local metadata matching ${match}`,
    );
}

function assertPublicAliasTargets(catalog) {
  const reactDeclarations = [
    ...catalog.react.declarations,
    ...catalog.react.namespaceMembers,
  ];
  const reactNames = new Set(
    reactDeclarations.map((entry) => entry.qualifiedName),
  );
  const invalidReact = reactDeclarations.filter(
    (entry) => !reactNames.has(entry.canonicalName),
  );
  const invalidCharts = Object.entries(
    catalog.inventories.charts.declarations,
  ).flatMap(([packageName, entries]) => {
    const names = new Set(entries.map((entry) => entry.name));
    return entries
      .filter((entry) => !names.has(entry.canonicalName))
      .map((entry) => `${packageName}:${entry.name}`);
  });
  if (invalidReact.length || invalidCharts.length) {
    throw new Error(
      `Non-public Carbon alias targets: ${[
        ...invalidReact.map((entry) => entry.qualifiedName),
        ...invalidCharts,
      ].join(', ')}`,
    );
  }
}

function literalValues(type) {
  const members = (type.isUnion() ? type.types : [type]).filter(
    (member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
  );
  const values = members.flatMap((member) => {
    if (member.flags & ts.TypeFlags.StringLiteral) return [member.value];
    if (member.flags & ts.TypeFlags.NumberLiteral) return [member.value];
    if (member.flags & ts.TypeFlags.BooleanLiteral)
      return [member.intrinsicName === 'true'];
    return [];
  });
  return values.length === members.length ? values : null;
}

function portableDeclarationPath(declaration, sourceRoot) {
  const sourcePath = declaration.getSourceFile().fileName.replaceAll('\\', '/');
  const relative = path.relative(sourceRoot, sourcePath).replaceAll('\\', '/');
  if (!relative.startsWith('../')) return relative;
  const nodeModulesIndex = sourcePath.lastIndexOf('/node_modules/');
  return nodeModulesIndex < 0
    ? null
    : sourcePath.slice(nodeModulesIndex + '/node_modules/'.length);
}

function staticPropertiesFor(target, checker, sourceRoot) {
  const declaration = target.valueDeclaration ?? target.getDeclarations()?.[0];
  if (!declaration) return [];
  const type = hasValue(target)
    ? checker.getTypeOfSymbolAtLocation(target, declaration)
    : checker.getDeclaredTypeOfSymbol(target);
  const signature = type.getCallSignatures().at(0);
  const parameter = signature?.getParameters().at(0);
  const parameterDeclaration =
    parameter?.valueDeclaration ?? parameter?.getDeclarations()?.[0];
  const propertiesType =
    parameter && parameterDeclaration
      ? checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration)
      : type;
  return propertiesType.getProperties().flatMap((property) => {
    const declaration =
      property.valueDeclaration ?? property.getDeclarations()?.[0];
    if (
      !declaration ||
      !declaration.getSourceFile().fileName.startsWith(sourceRoot)
    ) {
      return [];
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      declaration,
    );
    return [
      {
        name: property.getName(),
        optional: Boolean(property.flags & ts.SymbolFlags.Optional),
        type: portableMetadataText(
          checker.typeToString(
            propertyType,
            declaration,
            ts.TypeFormatFlags.NoTruncation,
          ),
        ),
        values: literalValues(propertyType),
      },
    ];
  });
}

function symbolDeclaration(symbol) {
  return symbol.valueDeclaration ?? symbol.getDeclarations()?.[0] ?? null;
}

function isCarbonDeclaration(declaration, reactRoot) {
  return declaration?.getSourceFile().fileName.startsWith(reactRoot) ?? false;
}

function propertiesForType(type, checker, reactRoot) {
  const allProperties = type.getProperties();
  const properties = allProperties.flatMap((property) => {
    const propertyDeclaration = symbolDeclaration(property);
    if (!isCarbonDeclaration(propertyDeclaration, reactRoot)) return [];
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      propertyDeclaration,
    );
    return [
      {
        name: property.getName(),
        optional: Boolean(property.flags & ts.SymbolFlags.Optional),
        type: portableMetadataText(
          checker.typeToString(
            propertyType,
            propertyDeclaration,
            ts.TypeFormatFlags.NoTruncation,
          ),
        ),
        values: literalValues(propertyType),
      },
    ];
  });
  return {
    allPropertyCount: allProperties.length,
    properties,
  };
}

function carbonPropsIdentity(type, reactRoot) {
  const queue = [type];
  const visited = new Set();
  const candidates = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const symbol of [current.aliasSymbol, current.getSymbol?.()]) {
      const declaration = symbol ? symbolDeclaration(symbol) : null;
      if (symbol && isCarbonDeclaration(declaration, reactRoot)) {
        candidates.push({
          declaration,
          name: symbol.getName(),
        });
      }
    }
    queue.push(
      ...(current.types ?? []),
      ...(current.aliasTypeArguments ?? []),
      ...(current.typeArguments ?? []),
    );
  }
  return (
    candidates.find((candidate) => candidate.name.endsWith('Props')) ??
    candidates[0] ??
    null
  );
}

function propsCandidate(type, checker, reactRoot, fallback) {
  const identity = carbonPropsIdentity(type, reactRoot);
  const declaration = identity?.declaration ?? fallback.declaration;
  const { allPropertyCount, properties } = propertiesForType(
    type,
    checker,
    reactRoot,
  );
  return {
    name:
      identity?.name ??
      type.aliasSymbol?.getName() ??
      type.getSymbol?.()?.getName() ??
      fallback.name,
    declaration,
    type: portableMetadataText(
      checker.typeToString(
        type,
        declaration ?? fallback.declaration,
        ts.TypeFormatFlags.NoTruncation,
      ),
    ),
    carbonOwnedPropertyCount: properties.length,
    inheritedPropertyCount: allPropertyCount - properties.length,
    properties,
  };
}

function propsFor(symbol, checker, moduleSymbol, reactRoot, inferSignature) {
  const target = targetOf(symbol, checker);
  const candidates = [];
  const propsSymbol = [symbol.getName(), target.getName()]
    .map((name) =>
      checker
        .getExportsOfModule(moduleSymbol)
        .find((candidate) => candidate.getName() === `${name}Props`),
    )
    .find(Boolean);
  if (propsSymbol) {
    const propsTarget = targetOf(propsSymbol, checker);
    const declaration = symbolDeclaration(propsTarget);
    if (declaration) {
      candidates.push(
        propsCandidate(
          checker.getDeclaredTypeOfSymbol(propsTarget),
          checker,
          reactRoot,
          { declaration, name: propsSymbol.getName() },
        ),
      );
    }
  }
  if (inferSignature) {
    const declaration = symbolDeclaration(symbol) ?? symbolDeclaration(target);
    if (declaration) {
      const valueType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      const signatures = [
        ...valueType
          .getCallSignatures()
          .map((signature) => ({ construct: false, signature })),
        ...valueType
          .getConstructSignatures()
          .map((signature) => ({ construct: true, signature })),
      ];
      for (const { construct, signature } of signatures) {
        const parameter = signature.getParameters()[0];
        const parameterDeclaration = parameter
          ? symbolDeclaration(parameter)
          : null;
        if (parameter && parameterDeclaration) {
          candidates.push(
            propsCandidate(
              checker.getTypeOfSymbolAtLocation(
                parameter,
                parameterDeclaration,
              ),
              checker,
              reactRoot,
              {
                declaration: isCarbonDeclaration(
                  parameterDeclaration,
                  reactRoot,
                )
                  ? parameterDeclaration
                  : declaration,
                name: parameter.getName(),
              },
            ),
          );
        }
        if (construct) {
          const instanceType = signature.getReturnType();
          const instanceProps = instanceType.getProperty('props');
          const instancePropsDeclaration = instanceProps
            ? symbolDeclaration(instanceProps)
            : null;
          if (instanceProps && instancePropsDeclaration) {
            candidates.push(
              propsCandidate(
                checker.getTypeOfSymbolAtLocation(
                  instanceProps,
                  instancePropsDeclaration,
                ),
                checker,
                reactRoot,
                { declaration, name: 'props' },
              ),
            );
          }
        }
      }
    }
  }
  const best = candidates.sort(
    (left, right) =>
      right.carbonOwnedPropertyCount - left.carbonOwnedPropertyCount ||
      right.inheritedPropertyCount - left.inheritedPropertyCount ||
      left.name.localeCompare(right.name),
  )[0];
  if (!best) return null;
  return {
    name: best.name,
    type: best.type,
    declarationPath: best.declaration
      ? portableDeclarationPath(best.declaration, reactRoot)
      : null,
    carbonOwnedPropertyCount: best.carbonOwnedPropertyCount,
    inheritedPropertyCount: best.inheritedPropertyCount,
    properties: best.properties,
  };
}

function assertPropsCoverage(catalog) {
  const renderable = [
    ...catalog.react.declarations,
    ...catalog.react.namespaceMembers,
  ].filter((entry) => entry.renderability === 'renderable');
  const missing = renderable
    .filter((entry) => entry.props === null)
    .map((entry) => entry.qualifiedName)
    .sort();
  const expectedMissing = [...carbonRenderabilityOverrides.noProps].sort();
  if (JSON.stringify(missing) !== JSON.stringify(expectedMissing)) {
    throw new Error(
      `Carbon renderables with no public props metadata: ${missing.join(', ') || 'none'}`,
    );
  }
  const opaque = renderable
    .filter(
      (entry) =>
        entry.props !== null &&
        entry.props.carbonOwnedPropertyCount +
          entry.props.inheritedPropertyCount ===
          0,
    )
    .map((entry) => entry.qualifiedName)
    .sort();
  const expectedOpaque = [...carbonRenderabilityOverrides.opaqueProps].sort();
  if (JSON.stringify(opaque) !== JSON.stringify(expectedOpaque)) {
    throw new Error(
      `Carbon renderables with unreviewed opaque props: ${opaque.join(', ') || 'none'}`,
    );
  }
}

function namespaceParent(name) {
  if (name.startsWith('preview__Card.') && name !== 'preview__Card.Card')
    return 'preview__Card.Card';
  if (
    name.startsWith('preview__DatePicker.') &&
    name !== 'preview__DatePicker.DatePicker'
  ) {
    return 'preview__DatePicker.DatePicker';
  }
  if (
    name.startsWith('preview__Dialog.') &&
    name !== 'preview__Dialog.Dialog'
  ) {
    return 'preview__Dialog.Dialog';
  }
  if (name.startsWith('preview__PageHeader.')) {
    return name === 'preview__PageHeader.PageHeader'
      ? null
      : 'preview__PageHeader.PageHeader';
  }
  if (name.startsWith('unstable__PageHeader.')) {
    return name === 'unstable__PageHeader.PageHeader'
      ? null
      : 'unstable__PageHeader.PageHeader';
  }
  return null;
}

function requiredParentFor(qualifiedName) {
  return (
    carbonRenderabilityOverrides.requiredParents[qualifiedName] ??
    namespaceParent(qualifiedName)
  );
}

function inferredRenderability({ name, namespace, runtimeValue, typeOnly }) {
  const override = carbonRenderabilityOverrides.classification[name];
  if (typeOnly)
    return { classification: 'type', renderability: 'non-renderable' };
  if (namespace)
    return { classification: 'namespace', renderability: 'non-renderable' };
  if (
    override === 'context' ||
    override === 'factory' ||
    override === 'value'
  ) {
    return { classification: override, renderability: 'non-renderable' };
  }
  if (/(?:^|_)use[A-Z]/.test(name)) {
    return { classification: 'hook', renderability: 'non-renderable' };
  }
  if (isValidElementType(runtimeValue)) {
    if (override === 'provider')
      return { classification: 'provider', renderability: 'renderable' };
    if (/^[A-Z]/.test(name) || /(?:^|_)[A-Z]/.test(name)) {
      return { classification: 'component', renderability: 'renderable' };
    }
    return { classification: 'unknown', renderability: 'unknown' };
  }
  if (runtimeValue === undefined)
    return { classification: 'unknown', renderability: 'unknown' };
  return { classification: 'value', renderability: 'non-renderable' };
}

function declarationEntries(
  moduleSymbol,
  runtime,
  checker,
  reactRoot,
  ancestry = [],
) {
  const symbols = checker.getExportsOfModule(moduleSymbol);
  const canonicalNames = publicCanonicalNames(symbols, checker, ancestry);
  return symbols
    .map((symbol) => {
      const name = symbol.getName();
      const target = targetOf(symbol, checker);
      const value = hasValue(target);
      const runtimeValue = runtime?.[name];
      const qualifiedName = [...ancestry, name].join('.');
      const labels = labelsFor(name, symbol, target, ancestry);
      const canonicalName = canonicalNames.get(target) ?? qualifiedName;
      const declaration =
        target.valueDeclaration ?? target.getDeclarations()?.[0];
      const inferred = inferredRenderability({
        name: qualifiedName,
        namespace: false,
        runtimeValue,
        typeOnly: !value,
      });
      const props = value
        ? propsFor(
            symbol,
            checker,
            moduleSymbol,
            reactRoot,
            inferred.renderability === 'renderable',
          )
        : null;
      return {
        name,
        qualifiedName,
        exportKey: exportKey(name),
        aliasOf: canonicalName === qualifiedName ? null : canonicalName,
        canonicalName,
        labels,
        status: statusFor(labels),
        typeOnly: !value,
        runtimeType: runtimeValue === undefined ? null : typeof runtimeValue,
        ...inferred,
        requiredParent: requiredParentFor(qualifiedName),
        declarationPath: declaration
          ? portableDeclarationPath(declaration, reactRoot)
          : null,
        props,
        ancestry,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function namespaceEntries(source, checker, runtime, reactRoot) {
  const namespaces = new Map();
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamespaceExport(statement.exportClause)
    )
      continue;
    const name = statement.exportClause.name.text;
    const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!moduleSymbol) continue;
    namespaces.set(
      name,
      declarationEntries(moduleSymbol, runtime[name], checker, reactRoot, [
        name,
      ]),
    );
  }
  return namespaces;
}

function namespaceMemberRecords(
  moduleSymbol,
  runtime,
  checker,
  reactRoot,
  ancestry = [],
) {
  const records = [];
  const sources = new Map(
    moduleSymbol
      .getDeclarations()
      ?.map((declaration) => [
        declaration.getSourceFile().fileName,
        declaration.getSourceFile(),
      ]),
  );
  for (const source of sources.values()) {
    for (const statement of source.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        !statement.exportClause ||
        !ts.isNamespaceExport(statement.exportClause)
      )
        continue;
      const namespace = statement.exportClause.name.text;
      const childSymbol = checker.getSymbolAtLocation(
        statement.moduleSpecifier,
      );
      if (!childSymbol) continue;
      const childAncestry = [...ancestry, namespace];
      const members = declarationEntries(
        childSymbol,
        runtime?.[namespace],
        checker,
        reactRoot,
        childAncestry,
      );
      records.push(
        ...members.map((member) => ({
          ...member,
          parent: childAncestry.join('.'),
          depth: childAncestry.length,
        })),
      );
      records.push(
        ...namespaceMemberRecords(
          childSymbol,
          runtime?.[namespace],
          checker,
          reactRoot,
          childAncestry,
        ),
      );
    }
  }
  return records.sort((left, right) =>
    left.qualifiedName.localeCompare(right.qualifiedName),
  );
}

function jsonValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return value;
  if (typeof value !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function runtimeEntries(source, includeValues) {
  return Object.keys(source)
    .sort()
    .map((name) => ({
      name,
      exportKey: exportKey(name),
      runtimeType: typeof source[name],
      value: includeValues ? jsonValue(source[name]) : null,
    }));
}

async function runtimeInventory(name) {
  const cjs = require(name);
  const esm = await import(name);
  return {
    package: packageData(name),
    cjs: runtimeEntries(cjs, valuePackages.has(name)),
    esm: runtimeEntries(esm, false),
  };
}

function sassInventory(module) {
  const debug = [];
  sass.compileString(
    `@use 'sass:meta'; @use '${module}' as value; @each $name, $item in meta.module-variables(value) { @debug '__BAP_VARIABLE__' + $name + '__' + meta.inspect($item); } @each $name, $item in meta.module-mixins(value) { @debug '__BAP_MIXIN__' + $name; } @each $name, $item in meta.module-functions(value) { @debug '__BAP_FUNCTION__' + $name; }`,
    {
      loadPaths: [
        path.join(packageRoot, 'node_modules'),
        path.join(packageRoot, '../../node_modules/.pnpm/node_modules'),
      ],
      logger: { debug: (message) => debug.push(message), warn: () => {} },
      quietDeps: true,
    },
  );
  const variables = debug
    .filter((message) => message.startsWith('__BAP_VARIABLE__'))
    .map((message) => {
      const separator = message.indexOf('__', '__BAP_VARIABLE__'.length);
      if (separator < 0)
        throw new Error(`Cannot parse Sass variable from ${module}`);
      return {
        name: message.slice('__BAP_VARIABLE__'.length, separator),
        value: message.slice(separator + 2),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const names = (prefix) =>
    debug
      .filter((message) => message.startsWith(prefix))
      .map((message) => message.slice(prefix.length))
      .sort();
  return {
    module,
    variables,
    mixins: names('__BAP_MIXIN__'),
    functions: names('__BAP_FUNCTION__'),
  };
}

function featureFlagDescriptions(reactRoot) {
  const declarationPath = path.join(
    reactRoot,
    'es/components/FeatureFlags/index.d.ts',
  );
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
  const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined;
  const propsSymbol = moduleSymbol
    ? checker
        .getExportsOfModule(moduleSymbol)
        .find((symbol) => symbol.getName() === 'FeatureFlagsProps')
    : undefined;
  if (!propsSymbol) throw new Error('Cannot resolve Carbon FeatureFlagsProps');
  const props = checker.getDeclaredTypeOfSymbol(targetOf(propsSymbol, checker));
  return new Map(
    props
      .getProperties()
      .map((property) => [
        property.getName(),
        ts
          .displayPartsToString(property.getDocumentationComment(checker))
          .replace(/\s+/g, ' ')
          .trim(),
      ]),
  );
}

async function featureFlagsCatalog(reactRoot) {
  const featureFlags = require(
    require.resolve('@carbon/feature-flags', { paths: [reactRoot] }),
  );
  const source = await readFile(
    path.join(reactRoot, 'es/components/FeatureFlags/index.js'),
    'utf8',
  );
  const mappingSource = source.match(/const PROP_TO_FLAG = \{([\s\S]*?)\};/);
  if (!mappingSource)
    throw new Error('Cannot resolve Carbon FeatureFlags provider mapping');
  const providerMapping = [...mappingSource[1].matchAll(/(\w+):\s*"([^"]+)"/g)]
    .map((match) => ({ name: match[1], flag: match[2] }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const descriptions = featureFlagDescriptions(reactRoot);
  const defaults = Object.fromEntries(
    [...featureFlags.FeatureFlags.flags.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const providerProps = providerMapping.map(({ name, flag }) => {
    const description = descriptions.get(name);
    if (!description || !(flag in defaults)) {
      throw new Error(`Cannot describe Carbon FeatureFlags prop ${name}`);
    }
    return { name, flag, defaultValue: defaults[flag], description };
  });
  const installed = Object.entries(defaults).map(([flag, defaultValue]) => ({
    flag,
    defaultValue,
    providerProp:
      providerProps.find((entry) => entry.flag === flag)?.name ?? null,
  }));
  return {
    package: packageData('@carbon/feature-flags', [reactRoot]),
    defaults,
    installed,
    providerProps,
  };
}

async function reactCatalog() {
  const reactRoot = sourceRoot('@carbon/react');
  const declarationPath = path.join(reactRoot, 'es/index.d.ts');
  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: {
      allowJs: false,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declarationPath);
  if (!source) throw new Error(`Cannot read ${declarationPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol)
    throw new Error('Cannot resolve the Carbon React module symbol');
  const cjsRuntime = require('@carbon/react');
  const esmRuntime = await import('@carbon/react');
  const namespaces = namespaceEntries(source, checker, cjsRuntime, reactRoot);
  const declarations = declarationEntries(
    moduleSymbol,
    cjsRuntime,
    checker,
    reactRoot,
  ).map((entry) => {
    const namespace = namespaces.get(entry.name) ?? null;
    const inferred = namespace
      ? { classification: 'namespace', renderability: 'non-renderable' }
      : {
          classification: entry.classification,
          renderability: entry.renderability,
        };
    return { ...entry, ...inferred, namespace };
  });
  const namespaceMembers = namespaceMemberRecords(
    moduleSymbol,
    cjsRuntime,
    checker,
    reactRoot,
  );
  return {
    package: packageData('@carbon/react'),
    cjs: runtimeEntries(cjsRuntime, false),
    esm: runtimeEntries(esmRuntime, false),
    declarations,
    namespaceMembers,
  };
}

function staticDeclarationCatalog(declarationPath, sourceRoot) {
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
  const symbols = checker.getExportsOfModule(moduleSymbol);
  const canonicalNames = publicCanonicalNames(symbols, checker);
  return symbols
    .map((symbol) => {
      const name = symbol.getName();
      const target = targetOf(symbol, checker);
      const canonicalName = canonicalNames.get(target) ?? name;
      const declaration =
        target.valueDeclaration ?? target.getDeclarations()?.[0];
      return {
        name,
        typeOnly: !hasValue(target),
        aliasOf: canonicalName === name ? null : canonicalName,
        canonicalName,
        declarationPath: declaration
          ? portableDeclarationPath(declaration, sourceRoot)
          : null,
        properties: staticPropertiesFor(target, checker, sourceRoot),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function chartsDeclarationCatalog() {
  const chartsReactRoot = sourceRoot('@carbon/charts-react');
  const chartsRoot = sourceRoot('@carbon/charts', [chartsReactRoot]);
  return {
    '@carbon/charts-react': staticDeclarationCatalog(
      path.join(chartsReactRoot, 'dist/index.d.ts'),
      chartsReactRoot,
    ),
    '@carbon/charts': staticDeclarationCatalog(
      path.join(chartsRoot, 'dist/index.d.ts'),
      chartsRoot,
    ),
  };
}

function componentCatalog(react) {
  return [...react.declarations, ...react.namespaceMembers]
    .filter((entry) => entry.renderability === 'renderable')
    .map((entry) => ({
      name: entry.qualifiedName,
      canonicalName: entry.canonicalName,
      aliasOf: entry.aliasOf,
      status: entry.status,
      renderability: entry.renderability,
      requiredParent: entry.requiredParent,
      controls:
        entry.props?.properties
          .filter((property) => property.values !== null)
          .map(({ name, values }) => ({ name, values })) ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function derivedCatalog(react, inventories, sass) {
  const globalTheme = react.declarations.find(
    (entry) => entry.name === 'GlobalTheme',
  );
  const themeValues = globalTheme?.props?.properties.find(
    (property) => property.name === 'theme',
  )?.values;
  const layout = inventories.layout.cjs;
  const spacingTokens = layout
    .filter(
      (entry) =>
        /^spacing\d{2}$/.test(entry.name) && typeof entry.value === 'string',
    )
    .map((entry) => [entry.name.replace(/(\d{2})$/, '-$1'), entry.value]);
  const chartNames = inventories.charts.cjs
    .filter(
      (entry) =>
        entry.runtimeType === 'function' && entry.name.endsWith('Chart'),
    )
    .map((entry) => entry.name)
    .sort();
  return {
    themes: themeValues ?? [],
    spacingTokens,
    typographyTokens:
      sass
        .find((entry) => entry.module.endsWith('/type'))
        ?.variables.map((entry) => entry.name) ?? [],
    componentFamilies: componentCatalog(react).map((entry) => entry.name),
    chartComponents: chartNames.filter(
      (name) => !name.startsWith('Experimental'),
    ),
    chartExperimentalComponents: chartNames.filter((name) =>
      name.startsWith('Experimental'),
    ),
    chartDiagramPrimitives: inventories.charts.cjs
      .filter(
        (entry) =>
          entry.runtimeType === 'function' &&
          /(Marker|Node|Edge)/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort(),
  };
}

async function buildCatalog() {
  const react = await reactCatalog();
  const inventoryEntries = await Promise.all(
    runtimePackages.map(async (name) => [
      name
        .split('/')
        .at(-1)
        .replace(/-react$/, ''),
      await runtimeInventory(name),
    ]),
  );
  const inventories = Object.fromEntries(inventoryEntries);
  const sassModulesInventory = sassModules.map(sassInventory);
  const reactRoot = sourceRoot('@carbon/react');
  const chartsReactRoot = sourceRoot('@carbon/charts-react');
  inventories.charts.declarations = chartsDeclarationCatalog();
  inventories.grid = {
    package: packageData('@carbon/grid'),
    kind: 'sass',
    cjs: [],
    esm: [],
    sass: sassModulesInventory.find((entry) => entry.module.endsWith('/grid')),
  };
  const featureFlags = await featureFlagsCatalog(reactRoot);
  const catalog = {
    schemaVersion: 2,
    provenance: {
      generator: 'packages/design-system/scripts/generate-carbon-catalog.mjs',
      typescript: ts.version,
      sass: sass.info,
      packages: [
        packageData('@carbon/react'),
        ...runtimePackages.map((name) => packageData(name)),
        packageData('@carbon/charts', [chartsReactRoot]),
        packageData('@carbon/grid'),
      ],
    },
    react,
    featureFlags,
    inventories,
    sass: sassModulesInventory,
    derived: derivedCatalog(react, inventories, sassModulesInventory),
  };
  const unknown = [
    ...catalog.react.declarations,
    ...catalog.react.namespaceMembers,
  ].filter((entry) => entry.renderability === 'unknown');
  if (unknown.length) {
    throw new Error(
      `Unclassified Carbon renderability candidates: ${unknown.map((entry) => entry.qualifiedName).join(', ')}`,
    );
  }
  assertPropsCoverage(catalog);
  assertPublicAliasTargets(catalog);
  assertPortableCatalog(catalog);
  return catalog;
}

function summarySource(catalog) {
  const exportNames = (entries) =>
    entries.map(({ name, exportKey, runtimeType, value }) => ({
      name,
      exportKey,
      runtimeType,
      value,
    }));
  const summary = {
    schemaVersion: catalog.schemaVersion,
    featureFlags: {
      defaults: catalog.featureFlags.defaults,
      installed: catalog.featureFlags.installed,
      providerProps: catalog.featureFlags.providerProps,
    },
    inventories: {
      colors: exportNames(catalog.inventories.colors.cjs),
      layout: exportNames(catalog.inventories.layout.cjs),
      motion: exportNames(catalog.inventories.motion.cjs),
      themes: exportNames(catalog.inventories.themes.cjs),
      type: exportNames(catalog.inventories.type.cjs),
    },
    derived: catalog.derived,
    fonts: [
      {
        family: 'IBM Plex Sans',
        weights: [300, 400, 600],
        styles: ['normal', 'italic'],
      },
      {
        family: 'IBM Plex Mono',
        weights: [300, 400, 600],
        styles: ['normal', 'italic'],
      },
      {
        family: 'IBM Plex Serif',
        weights: [300, 400, 600],
        styles: ['normal', 'italic'],
      },
    ],
  };
  const components = componentCatalog(catalog.react);
  return {
    componentSummary: `// Generated by the Carbon catalog script.\n\nexport type CarbonComponentCatalogEntry = Readonly<{ name: string; canonicalName: string; aliasOf: string | null; status: 'stable' | 'preview' | 'unstable' | 'deprecated'; renderability: 'renderable'; requiredParent: string | null; controls: readonly Readonly<{ name: string; values: readonly (boolean | number | string)[] }>[] }>;\n\nexport const carbonComponentCatalog: readonly CarbonComponentCatalogEntry[] = ${JSON.stringify(components, null, 2)};\n`,
    summary: `// Generated by the Carbon catalog script.\n\nexport interface CarbonTokenRecord { readonly [key: string]: CarbonTokenValue; }\n\nexport type CarbonTokenValue = boolean | number | string | null | readonly CarbonTokenValue[] | CarbonTokenRecord;\n\nexport type CarbonToken = Readonly<{ name: string; exportKey: string; runtimeType: string; value: CarbonTokenValue }>;\n\nexport type CarbonFeatureFlag = Readonly<{ flag: string; defaultValue: boolean; providerProp: string | null }>;\n\nexport type CarbonFeatureFlagProviderProp = Readonly<{ name: string; flag: string; defaultValue: boolean; description: string }>;\n\nexport type CarbonFont = Readonly<{ family: string; weights: readonly number[]; styles: readonly string[] }>;\n\nexport type CarbonTheme = ${summary.derived.themes.map((theme) => JSON.stringify(theme)).join(' | ')};\n\nexport type CarbonDesignSystemSummary = Readonly<{ schemaVersion: number; featureFlags: Readonly<{ defaults: Readonly<Record<string, boolean>>; installed: readonly CarbonFeatureFlag[]; providerProps: readonly CarbonFeatureFlagProviderProp[] }>; inventories: Readonly<{ colors: readonly CarbonToken[]; layout: readonly CarbonToken[]; motion: readonly CarbonToken[]; themes: readonly CarbonToken[]; type: readonly CarbonToken[] }>; derived: Readonly<{ themes: readonly CarbonTheme[]; spacingTokens: readonly (readonly [string, string])[]; typographyTokens: readonly string[]; componentFamilies: readonly string[]; chartComponents: readonly string[]; chartExperimentalComponents: readonly string[]; chartDiagramPrimitives: readonly string[] }>; fonts: readonly CarbonFont[] }>;\n\nexport const carbonDesignSystemSummary: CarbonDesignSystemSummary = ${JSON.stringify(summary, null, 2)};\n\nexport const carbonThemes = carbonDesignSystemSummary.derived.themes;\nexport const carbonSpacingTokens = carbonDesignSystemSummary.derived.spacingTokens;\nexport const carbonTypographyTokens = carbonDesignSystemSummary.derived.typographyTokens;\nexport const carbonComponentFamilies = carbonDesignSystemSummary.derived.componentFamilies;\nexport const carbonChartComponents = carbonDesignSystemSummary.derived.chartComponents;\nexport const carbonChartExperimentalComponents = carbonDesignSystemSummary.derived.chartExperimentalComponents;\nexport const carbonChartDiagramPrimitives = carbonDesignSystemSummary.derived.chartDiagramPrimitives;\nexport const carbonColorTokens = carbonDesignSystemSummary.inventories.colors;\nexport const carbonThemeTokens = carbonDesignSystemSummary.inventories.themes;\nexport const carbonLayoutTokens = carbonDesignSystemSummary.inventories.layout;\nexport const carbonMotionTokens = carbonDesignSystemSummary.inventories.motion;\nexport const carbonTypeTokens = carbonDesignSystemSummary.inventories.type;\nexport const carbonFeatureFlags = carbonDesignSystemSummary.featureFlags.installed;\nexport const carbonFeatureFlagProviderProps = carbonDesignSystemSummary.featureFlags.providerProps;\nexport const carbonFeatureFlagDefaults = carbonDesignSystemSummary.featureFlags.defaults;\nexport const carbonFonts = carbonDesignSystemSummary.fonts;\n`,
  };
}

async function writeFileIfChanged(filePath, content) {
  try {
    if ((await readFile(filePath, 'utf8')) === content) return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  await writeFile(filePath, content);
}

async function main() {
  const catalog = await buildCatalog();
  const { componentSummary, summary } = summarySource(catalog);
  const prettierOptions =
    (await prettier.resolveConfig(summaryOutputPath)) ?? {};
  const [formattedJson, formattedSummary, formattedComponentSummary] =
    await Promise.all([
      prettier.format(JSON.stringify(catalog, null, 2), {
        ...prettierOptions,
        filepath: jsonOutputPath,
      }),
      prettier.format(summary, {
        ...prettierOptions,
        filepath: summaryOutputPath,
      }),
      prettier.format(componentSummary, {
        ...prettierOptions,
        filepath: componentSummaryOutputPath,
      }),
    ]);
  if (process.argv.includes('--check')) {
    const [currentJson, currentSummary, currentComponentSummary] =
      await Promise.all([
        readFile(jsonOutputPath, 'utf8').catch(() => null),
        readFile(summaryOutputPath, 'utf8').catch(() => null),
        readFile(componentSummaryOutputPath, 'utf8').catch(() => null),
      ]);
    if (
      currentJson !== formattedJson ||
      currentSummary !== formattedSummary ||
      currentComponentSummary !== formattedComponentSummary
    ) {
      process.stderr.write(
        'Carbon catalog is stale. Run pnpm --filter @bap/design-system catalog.\n',
      );
      process.exitCode = 1;
    }
    return;
  }
  await Promise.all([
    writeFileIfChanged(jsonOutputPath, formattedJson),
    writeFileIfChanged(summaryOutputPath, formattedSummary),
    writeFileIfChanged(componentSummaryOutputPath, formattedComponentSummary),
  ]);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
