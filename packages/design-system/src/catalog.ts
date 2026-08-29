import catalogMetadata from './catalog.generated.json' with { type: 'json' };

export type CarbonCatalogPrimitive = boolean | number | string;

export type CarbonCatalogRuntimeEntry = Readonly<{
  exportKey: string;
  name: string;
  runtimeType: string;
  value: unknown;
}>;

export type CarbonCatalogProperty = Readonly<{
  name: string;
  optional: boolean;
  type: string;
  values: readonly CarbonCatalogPrimitive[] | null;
}>;

export type CarbonCatalogProps = Readonly<{
  carbonOwnedPropertyCount: number;
  declarationPath: string | null;
  inheritedPropertyCount: number;
  name: string;
  properties: readonly CarbonCatalogProperty[];
  type: string;
}>;

export type CarbonCatalogDeclaration = Readonly<{
  aliasOf: string | null;
  ancestry: readonly string[];
  canonicalName: string;
  classification: string;
  declarationPath: string | null;
  exportKey: string;
  labels: readonly string[];
  name: string;
  props: CarbonCatalogProps | null;
  qualifiedName: string;
  renderability: 'non-renderable' | 'renderable' | 'unknown';
  requiredParent: string | null;
  runtimeType: string | null;
  status: 'deprecated' | 'preview' | 'stable' | 'unstable';
  typeOnly: boolean;
}>;

export type CarbonCatalogNamespaceDeclaration = CarbonCatalogDeclaration &
  Readonly<{
    namespace: readonly CarbonCatalogDeclaration[] | null;
  }>;

export type CarbonCatalogNamespaceMember = CarbonCatalogDeclaration &
  Readonly<{
    depth: number;
    parent: string;
  }>;

export type CarbonCatalogSassVariable = Readonly<{
  name: string;
  value: string;
}>;

export type CarbonCatalogStaticDeclaration = Readonly<{
  aliasOf: string | null;
  canonicalName: string;
  declarationPath: string | null;
  name: string;
  properties: readonly CarbonCatalogProperty[];
  typeOnly: boolean;
}>;

export type CarbonCatalogSassModule = Readonly<{
  functions: readonly string[];
  mixins: readonly string[];
  module: string;
  variables: readonly CarbonCatalogSassVariable[];
}>;

export type CarbonCatalogFeatureFlag = Readonly<{
  defaultValue: boolean;
  flag: string;
  providerProp: string | null;
}>;

export type CarbonCatalogFeatureFlagProviderProp = Readonly<{
  defaultValue: boolean;
  description: string;
  flag: string;
  name: string;
}>;

export type CarbonCatalog = Readonly<{
  derived: Readonly<{
    chartComponents: readonly string[];
    chartDiagramPrimitives: readonly string[];
    chartExperimentalComponents: readonly string[];
    componentFamilies: readonly string[];
    spacingTokens: readonly (readonly [string, string])[];
    themes: readonly string[];
    typographyTokens: readonly string[];
  }>;
  featureFlags: Readonly<{
    defaults: Readonly<Record<string, boolean>>;
    installed: readonly CarbonCatalogFeatureFlag[];
    providerProps: readonly CarbonCatalogFeatureFlagProviderProp[];
  }>;
  inventories: Readonly<
    Record<
      string,
      Readonly<{
        cjs: readonly CarbonCatalogRuntimeEntry[];
        declarations?: Readonly<
          Record<string, readonly CarbonCatalogStaticDeclaration[]>
        >;
        esm: readonly CarbonCatalogRuntimeEntry[];
        kind?: string;
        sass?: CarbonCatalogSassModule;
      }>
    >
  >;
  provenance: Readonly<Record<string, unknown>>;
  react: Readonly<{
    cjs: readonly CarbonCatalogRuntimeEntry[];
    declarations: readonly CarbonCatalogNamespaceDeclaration[];
    esm: readonly CarbonCatalogRuntimeEntry[];
    namespaceMembers: readonly CarbonCatalogNamespaceMember[];
  }>;
  sass: readonly CarbonCatalogSassModule[];
  schemaVersion: number;
}>;

export const carbonCatalog = catalogMetadata as unknown as CarbonCatalog;

export function loadCarbonCatalog(): Promise<CarbonCatalog> {
  return Promise.resolve(carbonCatalog);
}
