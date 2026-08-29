import * as Carbon from '@bap/design-system/react';
import {
  createElement,
  useEffect,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { generatedComponentCoverage } from './component-coverage.generated.js';
import { renderSourceFixture as renderSourceComposition } from './source-fixture-renderer.js';

export type ComponentStatus = 'stable' | 'preview' | 'unstable' | 'deprecated';

type Primitive = boolean | number | string;

export type ComponentSpecimen = Readonly<{
  args: Readonly<Record<string, unknown>>;
  descriptor?: string;
  fixture?: 'layer' | 'source';
  id: string;
  label: string;
  remove?: readonly string[];
  source: 'api' | 'state' | 'story';
  sourceFingerprint?: string;
  sourceId?: string;
}>;

export type ComponentExclusion = Readonly<{
  id: string;
  propertyName: string;
  reason: string;
  value: Primitive;
}>;

export type ComponentSource = Readonly<{
  namedStories: readonly string[];
  path: string;
}>;

export type ComponentEntry = Readonly<{
  aliasOf: string | null;
  apiPath: string;
  canonicalName: string;
  controlled: Readonly<{
    callback:
      | 'onChange'
      | 'onClose'
      | 'onExpand'
      | 'onHeadingClick'
      | 'onRequestClose'
      | 'onToggle'
      | null;
    property:
      | 'checked'
      | 'expanded'
      | 'isExpanded'
      | 'open'
      | 'selected'
      | 'selectedIndex'
      | 'value'
      | null;
    reason: string | null;
  }>;
  defaultArgs: Readonly<Record<string, unknown>>;
  excludedSpecimens: readonly ComponentExclusion[];
  featureFlagged: boolean;
  id: string;
  name: string;
  parent: string | null;
  playgroundArgs: Readonly<Record<string, unknown>>;
  responsive: Readonly<{
    args: Readonly<Record<string, Primitive>>;
    kind: 'layout' | 'prop' | 'excluded';
    property: string | null;
    reason: string | null;
  }>;
  sources: readonly ComponentSource[];
  specimens: readonly ComponentSpecimen[];
  status: ComponentStatus;
}>;

export type NonRenderableEntry = Readonly<{
  id: string;
  name: string;
  reason: string;
}>;

type CatalogProperty = Readonly<{
  name: string;
  optional: boolean;
  type: string | null;
  values: readonly Primitive[] | null;
}>;

type LiteralCoverage = Readonly<{
  args: Readonly<Record<string, Primitive>>;
  componentName: string;
  executionStatus: 'covered' | 'excluded';
  id: string;
  propertyName: string;
  reason: string;
  value: Primitive;
}>;

type CompactCatalogEntry = Readonly<{
  aliasOf: string | null;
  apiPath: string;
  properties: readonly CatalogProperty[];
  requiredParent: string | null;
  status: ComponentStatus;
}>;

const namespaceComponents = new Set(
  generatedComponentCoverage.allEntryNames.filter((name) => name.includes('.')),
);
const generatedSourceByName: Readonly<
  Record<string, readonly ComponentSource[]>
> = generatedComponentCoverage.sourceByName;
const generatedSourceVariantKeysByName: Readonly<
  Record<
    string,
    readonly Readonly<{
      args: Readonly<Record<string, Primitive>>;
      descriptor?: string;
      fixture?: 'layer' | 'source';
      fingerprint?: string;
      key: string;
      label: string;
      remove?: readonly string[];
      reason: string;
      sourceId?: string;
    }>[]
  >
> = generatedComponentCoverage.sourceVariantDetailsByName;
const generatedLiteralCoverageByName: Readonly<
  Record<string, readonly LiteralCoverage[]>
> = generatedComponentCoverage.literalCoverageByName;
const declarationByName = new Map<string, CompactCatalogEntry>(
  Object.entries(generatedComponentCoverage.entries),
);
const componentNames = new Set<string>(generatedComponentCoverage.names);

const requiredParents: Readonly<Record<string, string>> = {
  AILabelActions: 'AILabel',
  AILabelContent: 'AILabel',
  AccordionItem: 'Accordion',
  BreadcrumbItem: 'Breadcrumb',
  ContainedListItem: 'ContainedList',
  DatePickerInput: 'DatePicker',
  FileUploaderButton: 'FileUploader',
  FileUploaderDropContainer: 'FileUploader',
  FileUploaderItem: 'FileUploader',
  FluidDatePickerInput: 'FluidDatePicker',
  FormGroup: 'Form',
  FormItem: 'Form',
  FormLabel: 'Form',
  GridSettings: 'Grid',
  HeaderContainer: 'Header',
  FluidTimePickerSelect: 'FluidTimePicker',
  HeaderGlobalAction: 'Header',
  HeaderGlobalBar: 'Header',
  HeaderMenu: 'Header',
  HeaderMenuButton: 'Header',
  HeaderMenuItem: 'Header',
  HeaderName: 'Header',
  HeaderNavigation: 'Header',
  HeaderPanel: 'Header',
  HeaderSideNavItems: 'Header',
  ListItem: 'UnorderedList',
  MenuItem: 'Menu',
  MenuItemDivider: 'Menu',
  MenuItemGroup: 'Menu',
  MenuItemRadioGroup: 'Menu',
  MenuItemSelectable: 'Menu',
  ModalBody: 'ComposedModal',
  ModalFooter: 'ComposedModal',
  ModalHeader: 'ComposedModal',
  ModalWrapper: 'Modal',
  NotificationActionButton: 'ActionableNotification',
  NotificationButton: 'ActionableNotification',
  ProgressStep: 'ProgressIndicator',
  PaginationNav: 'Pagination',
  PopoverContent: 'Popover',
  RadioButton: 'RadioButtonGroup',
  SelectItem: 'Select',
  SelectItemGroup: 'Select',
  SideNavDetails: 'SideNav',
  SideNavDivider: 'SideNav',
  SideNavFooter: 'SideNav',
  SideNavHeader: 'SideNav',
  SideNavIcon: 'SideNav',
  SideNavItem: 'SideNav',
  SideNavItems: 'SideNav',
  SideNavLink: 'SideNav',
  SideNavLinkText: 'SideNav',
  SideNavMenu: 'SideNav',
  SideNavMenuItem: 'SideNav',
  SideNavSwitcher: 'SideNav',
  StructuredListBody: 'StructuredListWrapper',
  StructuredListCell: 'StructuredListRow',
  StructuredListHead: 'StructuredListWrapper',
  StructuredListInput: 'StructuredListRow',
  StructuredListRow: 'StructuredListBody',
  SwitcherDivider: 'Switcher',
  SwitcherItem: 'Switcher',
  Tab: 'TabList',
  TabContent: 'Tabs',
  TabList: 'Tabs',
  TabListVertical: 'TabsVertical',
  TabPanel: 'TabPanels',
  TabPanels: 'Tabs',
  TableActionList: 'TableToolbar',
  TableBatchAction: 'TableBatchActions',
  TableBatchActions: 'TableToolbar',
  TableBody: 'Table',
  TableCell: 'TableRow',
  TableDecoratorRow: 'TableBody',
  TableExpandedRow: 'TableBody',
  TableExpandHeader: 'TableHead',
  TableExpandRow: 'TableBody',
  TableHead: 'Table',
  TableHeader: 'TableHead',
  TableRow: 'TableBody',
  TableSelectAll: 'TableHead',
  TableSelectRow: 'TableRow',
  TableSlugRow: 'TableBody',
  TableToolbarAction: 'TableToolbar',
  TableToolbarContent: 'TableToolbar',
  TableToolbarMenu: 'TableToolbar',
  TableToolbarSearch: 'TableToolbar',
  TimePickerSelect: 'TimePicker',
  TileAboveTheFoldContent: 'Tile',
  TileBelowTheFoldContent: 'Tile',
  TreeNode: 'TreeView',
  ToggletipActions: 'Toggletip',
  ToggletipButton: 'Toggletip',
  ToggletipContent: 'Toggletip',
  ToggletipLabel: 'Toggletip',
};

function namespaceParent(name: string) {
  if (name.startsWith('preview__Card.') && name !== 'preview__Card.Card') {
    return 'preview__Card.Card';
  }
  if (
    name.startsWith('preview__DatePicker.') &&
    name !== 'preview__DatePicker.DatePicker'
  )
    return 'preview__DatePicker.DatePicker';
  if (
    name.startsWith('preview__Dialog.') &&
    name !== 'preview__Dialog.Dialog'
  ) {
    return 'preview__Dialog.Dialog';
  }
  if (name.startsWith('preview__PageHeader.')) {
    if (name === 'preview__PageHeader.PageHeader') return null;
    return 'preview__PageHeader.PageHeader';
  }
  if (name.startsWith('unstable__PageHeader.')) {
    if (name === 'unstable__PageHeader.PageHeader') return null;
    return 'unstable__PageHeader.PageHeader';
  }
  return null;
}

function statusFor(
  name: string,
  declaration?: CompactCatalogEntry,
): ComponentStatus {
  if (declaration?.status) return declaration.status;
  if (name.startsWith('preview_')) return 'preview';
  if (name.startsWith('unstable_')) return 'unstable';
  return 'stable';
}

function defaultValue(property: CatalogProperty): unknown {
  if (property.values?.length) return property.values[0];
  if (property.name.startsWith('on')) return undefined;
  if (property.name === 'children') return undefined;
  if (property.name === 'id') return 'carbon-workbench-component';
  if (property.name === 'label') return 'Label';
  if (property.name === 'title') return 'Title';
  if (property.name === 'name') return 'carbon-component';
  if (property.name === 'value' || property.name === 'defaultValue')
    return 'Neutral value';
  if (property.name.includes('Text')) return 'Supporting text';
  if (property.name.includes('Description')) return 'Description';
  if (property.name.includes('placeholder')) return 'Placeholder';
  if (property.name === 'href') return '#component';
  if (property.name === 'items') {
    return [
      { id: 'option-one', text: 'Option one' },
      { id: 'option-two', text: 'Option two' },
    ];
  }
  if (property.name === 'options') return ['Option one', 'Option two'];
  if (property.name === 'open') return false;
  if (property.name === 'size') return 'md';
  return undefined;
}

function fixtureId(name: string) {
  return `carbon-workbench-${name.replaceAll(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
}

function dataTableChildren() {
  return createElement('div', { 'data-carbon-datatable': 'neutral-fixture' });
}

function defaultArgsFor(name: string, declaration?: CompactCatalogEntry) {
  if (!declaration) return {};
  const entries: [string, unknown][] = [];
  for (const property of declaration.properties) {
    if (property.optional) continue;
    const value = defaultValue(property);
    if (value !== undefined) entries.push([property.name, value]);
    else if (property.name.startsWith('on'))
      entries.push([property.name, () => undefined]);
  }
  const defaults = Object.fromEntries(entries);
  const propertyNames = new Set(
    declaration.properties.map((property) => property.name),
  );
  if (propertyNames.has('id')) defaults.id = fixtureId(name);
  if (propertyNames.has('aria-label')) defaults['aria-label'] = 'Label';
  if (['ButtonSkeleton', 'ToggleSkeleton'].includes(name))
    delete defaults['aria-label'];
  if (propertyNames.has('label')) defaults.label = 'Label';
  if (propertyNames.has('labelText')) defaults.labelText = 'Label';
  if (propertyNames.has('text')) defaults.text = 'Label';
  if (name === 'DataTable') {
    return {
      ...defaults,
      children: dataTableChildren,
      headers: [{ header: 'Label', key: 'label' }],
      rows: [{ id: 'row-one', label: 'Neutral value' }],
    };
  }
  if (name === 'HeaderContainer') {
    return {
      ...defaults,
      render: () =>
        createElement(resolveCarbonComponent('Header'), {
          'aria-label': 'Global navigation',
        }),
    };
  }
  if (name === 'Pagination' || declaration?.aliasOf === 'Pagination') {
    return {
      ...defaults,
      itemRangeText: (minimum: number, maximum: number, total: number) =>
        `${minimum}-${maximum} of ${total}`,
      itemText: (minimum: number, maximum: number) =>
        `${minimum}-${maximum} items`,
      page: 1,
      pageRangeText: (current: number, total: number) =>
        `${current} of ${total} pages`,
      pageSize: 10,
      pageSizes: [10],
      pageText: (page: number) => `Page ${page}`,
      totalItems: 10,
    };
  }
  if (name === 'SideNavHeader') {
    return {
      ...defaults,
      renderIcon: () => createElement('svg', { 'aria-hidden': true }),
    };
  }
  if (name.endsWith('FluidDatePickerInput')) {
    return {
      ...defaults,
      id: `carbon-workbench-${name.toLowerCase()}`,
      key: `${name}-input`,
      labelText: 'Date',
    };
  }
  if (name.includes('DatePickerSkeleton')) {
    return { ...defaults, key: `${name}-skeleton` };
  }
  if (
    name === 'DatePickerInput' ||
    name === 'preview__DatePicker.DatePickerInput'
  ) {
    return {
      ...defaults,
      id: `carbon-workbench-${name.toLowerCase()}`,
      key: `${name}-input`,
      labelText: 'Date',
    };
  }
  if (name === 'Copy') return { ...defaults, 'aria-label': 'Copy value' };
  if (name === 'DataTableSkeleton') {
    return {
      ...defaults,
      'aria-label': 'Loading data table',
      headers: Array.from({ length: 5 }, (_, index) => ({
        header: `Column ${index + 1}`,
      })),
    };
  }
  if (name === 'IconTab') {
    return { ...defaults, enterDelayMs: 5_000, leaveDelayMs: 0 };
  }
  if (name === 'MenuItemRadioGroup') {
    return {
      ...defaults,
      itemToString: (item: unknown) =>
        item && typeof item === 'object' && 'text' in item
          ? String(item.text)
          : String(item),
    };
  }
  if (name === 'ActionableNotification') {
    return {
      ...defaults,
      subtitle: 'Notification details',
      title: 'Notification',
    };
  }
  if (name === 'ComposedModal') return { 'aria-label': 'Dialog', open: true };
  if (name === 'ComposedModal') {
    return { ...defaults, 'aria-label': 'Dialog', open: true };
  }
  if (name === 'Menu') return { ...defaults, label: 'Actions', open: true };
  if (name === 'Modal') {
    return {
      ...defaults,
      closeButtonLabel: 'Close dialog',
      modalAriaLabel: 'Dialog',
      modalHeading: 'Dialog',
      modalLabel: 'Dialog',
      primaryButtonText: 'Confirm',
    };
  }
  if (name.includes('MultiSelect') && !name.endsWith('Skeleton')) {
    const items = [
      { id: 'option-one', label: 'Option one', text: 'Option one' },
      { id: 'option-two', label: 'Option two', text: 'Option two' },
    ];
    if (name.includes('FluidMultiSelect')) {
      return {
        ...defaults,
        itemToString: (item: (typeof items)[number] | null) => item?.text ?? '',
        items,
        label: 'Selection',
        titleText: 'Selection',
      };
    }
    return {
      ...defaults,
      itemToString: (item: (typeof items)[number] | null) => item?.text ?? '',
      items,
      label: 'Selection',
      titleText: 'Selection',
    };
  }
  if (name === 'Slider') {
    return {
      ...defaults,
      ariaLabelInput: 'Value',
      labelText: 'Value',
      max: 100,
      min: 0,
      value: 50,
    };
  }
  if (name === 'TableExpandRow') {
    return {
      ...defaults,
      'aria-label': 'Expand row',
      expandIconDescription: 'Expand row',
      onExpand: () => undefined,
    };
  }
  if (name.endsWith('FluidNumberInput')) {
    return {
      ...defaults,
      id: fixtureId(name),
      label: 'Value',
      value: 1,
    };
  }
  if (name === 'TableExpandHeader') {
    return { ...defaults, 'aria-label': 'Expand rows', id: 'expand' };
  }
  if (name === 'ExpandableSearch') {
    return {
      ...defaults,
      closeButtonLabelText: 'Clear search',
      labelText: 'Search',
    };
  }
  if (name === 'HeaderMenu') {
    return { ...defaults, menuLinkName: 'Menu' };
  }
  if (name.includes('PageHeader') && name.endsWith('.Content')) {
    return { ...defaults, title: 'Page title' };
  }
  if (name.endsWith('TimePickerSelect')) {
    return { ...defaults, 'aria-label': 'Time' };
  }
  return defaults;
}

function sourceSpecimens(name: string): ComponentSpecimen[] {
  return (generatedSourceVariantKeysByName[name] ?? []).map((variant) => ({
    args: variant.args,
    ...(variant.descriptor ? { descriptor: variant.descriptor } : {}),
    ...(variant.fixture ? { fixture: variant.fixture } : {}),
    id: variant.key,
    label: variant.label,
    ...(variant.remove ? { remove: variant.remove } : {}),
    source: 'story' as const,
    ...(variant.sourceId ? { sourceId: variant.sourceId } : {}),
    ...(variant.fingerprint ? { sourceFingerprint: variant.fingerprint } : {}),
  }));
}

function stateSpecimens(
  name: string,
  declaration?: CompactCatalogEntry,
): ComponentSpecimen[] {
  if (!declaration) return [];
  const names = new Set<string>(
    declaration.properties.map((property) => property.name),
  );
  const states: ComponentSpecimen[] = [];
  if (
    !['DismissibleTag', 'FluidTimePickerSelect', 'Link', 'Tag'].includes(
      name,
    ) &&
    names.has('disabled')
  ) {
    states.push({
      args: { disabled: true },
      id: 'state-disabled',
      label: 'Disabled',
      source: 'state',
    });
  }
  if (names.has('invalid')) {
    const id = fixtureId(name);
    states.push({
      args: {
        invalid: true,
        'aria-describedby': `${id}-error-msg`,
      },
      id: 'state-invalid',
      label: 'Invalid',
      source: 'state',
    });
  }
  if (names.has('readOnly') && name !== 'CheckboxGroup') {
    states.push({
      args: { readOnly: true },
      id: 'state-read-only',
      label: 'Read only',
      source: 'state',
    });
  }
  if (names.has('open')) {
    states.push({
      args: { open: true },
      id: 'state-open',
      label: 'Open',
      source: 'state',
    });
  }
  if (names.has('loading')) {
    states.push({
      args: { loading: true },
      id: 'state-loading',
      label: 'Loading',
      source: 'state',
    });
  }
  if (names.has('value') && names.has('onChange')) {
    states.push({
      args: { value: name === 'Slider' ? 50 : 'Controlled value' },
      id: 'state-controlled',
      label: 'Controlled',
      source: 'state',
    });
  }
  return states;
}

function apiSpecimens(name: string): ComponentSpecimen[] {
  return (generatedLiteralCoverageByName[name] ?? [])
    .filter((record) => record.executionStatus === 'covered')
    .map((record) => ({
      args: record.args,
      id: record.id,
      label: `${record.propertyName}: ${String(record.value)}`,
      source: 'api' as const,
    }));
}

function excludedSpecimens(name: string): ComponentExclusion[] {
  return (generatedLiteralCoverageByName[name] ?? [])
    .filter((record) => record.executionStatus === 'excluded')
    .map((record) => ({
      id: record.id,
      propertyName: record.propertyName,
      reason: record.reason,
      value: record.value,
    }));
}

function sourcesFor(
  name: string,
  declaration?: CompactCatalogEntry,
): readonly ComponentSource[] {
  const sources = generatedSourceByName[name] ?? [];
  if (sources.length) return sources;
  if (declaration) {
    return [{ namedStories: [], path: declaration.apiPath }];
  }
  return [{ namedStories: [], path: `namespace:${name}` }];
}

function canonicalNameFor(name: string, declaration?: CompactCatalogEntry) {
  return declaration?.aliasOf ?? name;
}

function parentFor(name: string, declaration?: CompactCatalogEntry) {
  if (name.endsWith('DatePickerSkeleton')) return null;
  const canonicalParent = declaration?.aliasOf
    ? declarationByName.get(declaration.aliasOf)?.requiredParent
    : null;
  const parent =
    declaration?.requiredParent ??
    canonicalParent ??
    requiredParents[name] ??
    namespaceParent(name);
  if (!parent) return null;
  if (
    name.startsWith('preview__') &&
    componentNames.has(`preview__${parent}`)
  ) {
    return `preview__${parent}`;
  }
  if (
    name.startsWith('unstable__') &&
    componentNames.has(`unstable__${parent}`)
  ) {
    return `unstable__${parent}`;
  }
  return parent;
}

function responsiveCoverage(name: string, declaration?: CompactCatalogEntry) {
  if (['Column', 'Grid', 'Row'].includes(name)) {
    return {
      args: {},
      kind: 'layout' as const,
      property: 'layout-context',
      reason: null,
    };
  }
  const properties = declaration?.properties ?? [];
  for (const propertyName of ['breakpoint', 'sm', 'md', 'lg', 'xlg']) {
    const property = properties.find(({ name }) => name === propertyName);
    const value = property?.values?.[0];
    if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return {
        args: { [propertyName]: value },
        kind: 'prop' as const,
        property: propertyName,
        reason: null,
      };
    }
  }
  return {
    args: {},
    kind: 'excluded' as const,
    property: null,
    reason:
      'The public props do not expose a reviewed responsive breakpoint or layout contract.',
  };
}

function controlledCoverage(declaration?: CompactCatalogEntry) {
  const properties = new Set(
    declaration?.properties.map((property) => property.name),
  );
  if (properties.has('checked') && properties.has('onChange')) {
    return {
      callback: 'onChange' as const,
      property: 'checked' as const,
      reason: null,
    };
  }
  if (properties.has('selectedIndex') && properties.has('onChange')) {
    return {
      callback: 'onChange' as const,
      property: 'selectedIndex' as const,
      reason: null,
    };
  }
  if (properties.has('open') && properties.has('onClose')) {
    return {
      callback: 'onClose' as const,
      property: 'open' as const,
      reason: null,
    };
  }
  if (properties.has('open') && properties.has('onRequestClose')) {
    return {
      callback: 'onRequestClose' as const,
      property: 'open' as const,
      reason: null,
    };
  }
  if (properties.has('open') && properties.has('onHeadingClick')) {
    return {
      callback: 'onHeadingClick' as const,
      property: 'open' as const,
      reason: null,
    };
  }
  if (properties.has('expanded') && properties.has('onToggle')) {
    return {
      callback: 'onToggle' as const,
      property: 'expanded' as const,
      reason: null,
    };
  }
  if (properties.has('selected') && properties.has('onChange')) {
    return {
      callback: 'onChange' as const,
      property: 'selected' as const,
      reason: null,
    };
  }
  if (properties.has('isExpanded') && properties.has('onExpand')) {
    return {
      callback: 'onExpand' as const,
      property: 'isExpanded' as const,
      reason: null,
    };
  }
  if (properties.has('value') && properties.has('onChange')) {
    return {
      callback: 'onChange' as const,
      property: 'value' as const,
      reason: null,
    };
  }
  return {
    callback: null,
    property: null,
    reason:
      'The public props do not expose a supported controlled value contract.',
  };
}

function uniqueSpecimens(specimens: readonly ComponentSpecimen[]) {
  const identifiers = new Set<string>();
  return specimens.filter((specimen) => {
    if (identifiers.has(specimen.id)) return false;
    identifiers.add(specimen.id);
    return true;
  });
}

export const componentEntries: readonly ComponentEntry[] = [...componentNames]
  .sort((left, right) => left.localeCompare(right))
  .map((name) => {
    const declaration = declarationByName.get(name);
    const defaultArgs = defaultArgsFor(name, declaration);
    return {
      aliasOf: declaration?.aliasOf ?? null,
      apiPath:
        declaration?.apiPath ??
        `namespace:${name.slice(0, name.lastIndexOf('.'))}`,
      canonicalName: canonicalNameFor(name, declaration),
      controlled: controlledCoverage(declaration),
      defaultArgs,
      excludedSpecimens: excludedSpecimens(name),
      featureFlagged:
        name.startsWith('preview_') || name.startsWith('unstable_'),
      id: name,
      name,
      parent: name === 'HeaderContainer' ? null : parentFor(name, declaration),
      playgroundArgs: defaultArgs,
      responsive: responsiveCoverage(name, declaration),
      sources: sourcesFor(name, declaration),
      specimens: uniqueSpecimens([
        ...apiSpecimens(name),
        ...stateSpecimens(name, declaration),
        ...sourceSpecimens(name),
      ]),
      status: statusFor(name, declaration),
    };
  });

export const nonRenderableEntries: readonly NonRenderableEntry[] =
  generatedComponentCoverage.nonRenderableEntries.map((entry) => ({
    id: entry.name,
    name: entry.name,
    reason: entry.reason,
  }));

export const componentEntryByName = new Map(
  componentEntries.map((entry) => [entry.name, entry]),
);

function resolveValue(path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    )
      return undefined;
    return (value as Record<string, unknown>)[segment];
  }, Carbon as unknown);
}

function isCarbonElementType(value: unknown): value is ElementType {
  if (typeof value === 'function') return true;
  if (value === null || typeof value !== 'object') return false;
  return '$$typeof' in value;
}

export function resolveCarbonComponent(name: string): ElementType {
  const resolved = resolveValue(name);
  if (!isCarbonElementType(resolved)) {
    throw new Error(
      `Catalog entry ${name} does not resolve to a React element type.`,
    );
  }
  return resolved;
}

function datePickerInputChildren(
  inputName: string,
  idPrefix: string,
  datePickerType: unknown,
  supportsDatePickerType = true,
): ReactNode {
  const Input = resolveCarbonComponent(inputName);
  const input = (id: string, labelText: string) =>
    createElement(Input, {
      ...(supportsDatePickerType
        ? { datePickerType: datePickerType === 'range' ? 'range' : 'single' }
        : {}),
      id,
      key: id,
      labelText,
    });
  return datePickerType === 'range'
    ? [
        input(`${idPrefix}-start`, 'Start date'),
        input(`${idPrefix}-end`, 'End date'),
      ]
    : input(idPrefix, 'Date');
}

function componentChildren(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactNode {
  if (name === 'DataTable') return undefined;
  if (name.includes('DatePickerSkeleton')) return undefined;
  if (name === 'RadioButton') return undefined;
  if (name === 'Heading') return 'Heading';
  if (name.endsWith('Button')) return 'Action';
  if (name === 'DatePicker') {
    return datePickerInputChildren(
      'DatePickerInput',
      'carbon-workbench-date',
      props.datePickerType,
    );
  }
  if (name === 'preview__DatePicker.DatePicker') {
    return datePickerInputChildren(
      'preview__DatePicker.DatePickerInput',
      'carbon-workbench-preview-date',
      props.datePickerType,
      false,
    );
  }
  if (name === 'FluidDatePicker') {
    return datePickerInputChildren(
      'FluidDatePickerInput',
      'carbon-workbench-fluid-date',
      props.datePickerType,
    );
  }
  if (name === 'preview__FluidDatePicker') {
    return datePickerInputChildren(
      'preview__FluidDatePickerInput',
      'carbon-workbench-preview-fluid-date',
      props.datePickerType,
    );
  }
  if (name === 'unstable__FluidDatePicker') {
    return datePickerInputChildren(
      'unstable__FluidDatePickerInput',
      'carbon-workbench-unstable-fluid-date',
      props.datePickerType,
    );
  }
  if (name === 'TimePicker') {
    return [
      createElement(
        resolveCarbonComponent('TimePickerSelect'),
        { id: 'carbon-workbench-time', key: 'time' },
        createElement('option', { value: '09' }, '09'),
      ),
      createElement(
        resolveCarbonComponent('TimePickerSelect'),
        { id: 'carbon-workbench-time-zone', key: 'zone' },
        createElement('option', { value: 'UTC' }, 'UTC'),
      ),
    ];
  }
  if (name === 'FluidTimePicker') {
    return createElement(
      resolveCarbonComponent('FluidTimePickerSelect'),
      { id: 'carbon-workbench-fluid-time', labelText: 'Time' },
      createElement('option', { value: '09' }, '09'),
    );
  }
  if (name.endsWith('TimePickerSelect')) {
    return createElement('option', { value: '09' }, '09');
  }
  if (name === 'Tooltip') {
    return createElement('button', { type: 'button' }, 'Tooltip target');
  }
  const declaration = declarationByName.get(name);
  if (
    !declaration?.properties.some((property) => property.name === 'children')
  ) {
    return undefined;
  }
  if (name.includes('TableHeader')) return 'Column heading';
  if (name.includes('TableCell')) return 'Cell value';
  if (name.includes('TableRow')) return createElement('td', null, 'Cell value');
  if (name.includes('Tab')) return 'Tab label';
  if (name === 'MenuItemGroup') {
    return createElement(resolveCarbonComponent('MenuItem'), {
      label: 'Menu item',
    });
  }
  if (name.includes('Menu')) return 'Menu item';
  return 'Neutral Carbon specimen';
}

function polymorphicHostFixture(
  name: string,
  Component: ElementType,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (!['AspectRatio', 'preview__Card.CardMedia'].includes(name)) return null;
  const host = props.as;
  if (typeof host !== 'string') return null;
  const target = (children?: ReactNode, extra: Record<string, unknown> = {}) =>
    createElement(Component, { ...props, ...extra }, children);
  const text = 'Neutral Carbon specimen';
  const image = createElement('img', {
    alt: 'Neutral illustration',
    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  });
  if (['li'].includes(host)) return createElement('ul', null, target(text));
  if (['ol', 'ul', 'menu'].includes(host))
    return target(createElement('li', null, text));
  if (host === 'dl')
    return target(
      createElement(
        'div',
        null,
        createElement('dt', null, 'Term'),
        createElement('dd', null, text),
      ),
    );
  if (['dt', 'dd'].includes(host))
    return createElement('dl', null, target(text));
  if (host === 'datalist')
    return target(createElement('option', { value: 'Neutral value' }));
  if (host === 'select')
    return target(createElement('option', { value: 'neutral' }, text));
  if (host === 'optgroup')
    return createElement(
      'select',
      null,
      target(createElement('option', { value: 'neutral' }, text)),
    );
  if (host === 'option')
    return createElement('select', null, target(text, { value: 'neutral' }));
  if (host === 'details')
    return target(
      createElement(
        'div',
        null,
        createElement('summary', null, 'Details'),
        text,
      ),
    );
  if (host === 'summary') return createElement('details', null, target(text));
  if (host === 'legend') return createElement('fieldset', null, target(text));
  if (host === 'hgroup') return target(createElement('h2', null, text));
  if (host === 'ruby')
    return target(
      createElement(
        'span',
        null,
        'Neutral',
        createElement('rt', null, 'specimen'),
      ),
    );
  if (['rp', 'rt'].includes(host))
    return createElement('ruby', null, target(text));
  if (host === 'caption') return createElement('table', null, target(text));
  if (host === 'table')
    return target(
      createElement(
        'tbody',
        null,
        createElement('tr', null, createElement('td', null, text)),
      ),
    );
  if (['thead', 'tbody', 'tfoot'].includes(host))
    return createElement(
      'table',
      null,
      target(
        createElement(
          'tr',
          null,
          createElement(host === 'thead' ? 'th' : 'td', null, text),
        ),
      ),
    );
  if (host === 'tr')
    return createElement(
      'table',
      null,
      createElement('tbody', null, target(createElement('td', null, text))),
    );
  if (['td', 'th'].includes(host))
    return createElement(
      'table',
      null,
      createElement('tbody', null, createElement('tr', null, target(text))),
    );
  if (host === 'colgroup')
    return createElement('table', null, target(createElement('col')));
  if (host === 'picture') return target(image);
  if (host === 'img')
    return target(undefined, {
      alt: 'Neutral illustration',
      src: image.props.src,
    });
  if (host === 'textarea') return target(undefined, { defaultValue: text });
  if (host === 'map')
    return target(createElement('area', { alt: '', shape: 'rect' }));
  return null;
}

function parentArgs(name: string) {
  if (name === 'Accordion') return { align: 'start' };
  if (name === 'Breadcrumb') return { noTrailingSlash: true };
  if (name === 'DatePicker') return { datePickerType: 'single' };
  if (name.endsWith('FluidTimePicker')) {
    return { id: 'carbon-workbench-fluid-time-picker', labelText: 'Time' };
  }
  if (name === 'Header') return { 'aria-label': 'Global navigation' };
  if (name === 'ActionableNotification') {
    return { subtitle: 'Notification details', title: 'Notification' };
  }
  if (name === 'Menu') return { label: 'Actions', open: true };
  if (name === 'RadioButtonGroup')
    return { legendText: 'Options', name: 'option' };
  if (name === 'Select') return { id: 'select', labelText: 'Selection' };
  if (name === 'SideNav')
    return { 'aria-label': 'Side navigation', expanded: true };
  if (name === 'Tabs' || name === 'TabsVertical') return { selectedIndex: 0 };
  if (name === 'Table') return { 'aria-label': 'Neutral table' };
  if (name === 'TreeView') return { 'aria-label': 'Neutral tree' };
  if (name === 'Toggletip') return {};
  if (name === 'preview__Dialog.Dialog') return { open: true };
  if (name.endsWith('.Card')) return {};
  if (name.endsWith('.PageHeader')) return { title: 'Neutral page title' };
  return {};
}

function withRequiredParent(
  name: string,
  child: ReactElement,
  props: Readonly<Record<string, unknown>>,
): ReactElement {
  if (name === 'RadioButton' && 'defaultChecked' in props) return child;
  const parent = componentEntryByName.get(name)?.parent;
  if (!parent) return child;
  return createElement(
    resolveCarbonComponent(parent),
    parentArgs(parent),
    child,
  );
}

function tableFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (!name.startsWith('Table')) return null;
  const Table = resolveCarbonComponent('Table');
  const TableBody = resolveCarbonComponent('TableBody');
  const TableCell = resolveCarbonComponent('TableCell');
  const TableExpandHeader = resolveCarbonComponent('TableExpandHeader');
  const TableHead = resolveCarbonComponent('TableHead');
  const TableHeader = resolveCarbonComponent('TableHeader');
  const TableRow = resolveCarbonComponent('TableRow');
  const Component = resolveCarbonComponent(name);
  const cell = () => createElement(TableCell, null, 'Cell value');
  const body = (row: ReactElement) => createElement(TableBody, null, row);
  const head = (row: ReactElement) => createElement(TableHead, null, row);
  const withTable = (children: ReactNode) =>
    createElement(Table, { 'aria-label': 'Neutral table' }, children);
  const bodyRow = (children: ReactNode) =>
    createElement(TableRow, null, children);
  const headRow = (children: ReactNode) =>
    createElement(TableRow, null, children);
  const targetProps =
    name === 'TableExpandedRow'
      ? { ...props, colSpan: 1 }
      : name === 'TableSelectRow' || name === 'TableSelectAll'
        ? { ...props, 'aria-label': 'Select row' }
        : props;
  const target = (children?: ReactNode) =>
    children === undefined
      ? createElement(Component, targetProps)
      : createElement(Component, targetProps, children);

  if (name === 'Table') {
    return createElement(
      Component,
      props,
      head(headRow(createElement(TableHeader, null, 'Column heading'))),
      body(bodyRow(cell())),
    );
  }
  if (name === 'TableHead') {
    return withTable(
      target(headRow(createElement(TableHeader, null, 'Column heading'))),
    );
  }
  if (name === 'TableBody') return withTable(target(bodyRow(cell())));
  if (name === 'TableRow') return withTable(body(target(cell())));
  if (name === 'TableHeader')
    return withTable(head(headRow(target('Column heading'))));
  if (name === 'TableCell')
    return withTable(body(bodyRow(target('Cell value'))));
  if (name === 'TableExpandHeader') {
    return withTable(head(headRow(target('Expand'))));
  }
  if (name === 'TableSelectAll') {
    return withTable(head(headRow(target())));
  }
  if (
    name === 'TableDecoratorRow' ||
    name === 'TableSelectRow' ||
    name === 'TableSlugRow'
  ) {
    return withTable(body(bodyRow(target())));
  }
  if (name === 'TableExpandRow') {
    return createElement(
      Table,
      { 'aria-label': 'Neutral table' },
      head(
        headRow(createElement(TableExpandHeader, { id: 'expand' }, 'Expand')),
      ),
      body(target(cell())),
    );
  }
  if (name === 'TableExpandedRow') {
    return withTable(body(target('Expanded content')));
  }
  return null;
}

function compositionFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  const Component = resolveCarbonComponent(name);
  if (name === 'ComposedModalPresence') {
    return createElement(
      Component,
      props,
      createElement(
        resolveCarbonComponent('ComposedModal'),
        { 'aria-label': 'Dialog', open: true },
        'Neutral Carbon specimen',
      ),
    );
  }
  if (name === 'ModalPresence') {
    return createElement(
      Component,
      props,
      createElement(resolveCarbonComponent('Modal'), {
        closeButtonLabel: 'Close dialog',
        modalAriaLabel: 'Dialog',
        modalHeading: 'Dialog',
        open: true,
        primaryButtonText: 'Confirm',
      }),
    );
  }
  if (['ModalBody', 'ModalFooter', 'ModalHeader'].includes(name)) {
    const ModalHeader = resolveCarbonComponent('ModalHeader');
    const ModalBody = resolveCarbonComponent('ModalBody');
    const ModalFooter = resolveCarbonComponent('ModalFooter');
    const target =
      name === 'ModalHeader'
        ? createElement(Component, {
            ...props,
            label: 'Dialog',
            title: 'Dialog',
          })
        : name === 'ModalFooter'
          ? createElement(Component, props, 'Footer action')
          : createElement(Component, props, 'Neutral Carbon specimen');
    return createElement(
      resolveCarbonComponent('ComposedModal'),
      { 'aria-label': 'Dialog', open: true },
      name === 'ModalHeader'
        ? target
        : createElement(ModalHeader, { label: 'Dialog', title: 'Dialog' }),
      name === 'ModalBody' ? target : createElement(ModalBody, null, 'Content'),
      name === 'ModalFooter'
        ? target
        : createElement(ModalFooter, null, 'Action'),
    );
  }
  if (name === 'Accordion') {
    return createElement(
      Component,
      props,
      createElement(
        resolveCarbonComponent('AccordionItem'),
        { title: 'Item' },
        'Content',
      ),
    );
  }
  if (name === 'ContainedList') {
    return createElement(
      Component,
      { ...props, label: 'List' },
      createElement(resolveCarbonComponent('ContainedListItem'), null, 'Item'),
    );
  }
  if (name === 'TreeView') {
    return createElement(
      Component,
      { ...props, 'aria-label': 'Tree' },
      createElement(resolveCarbonComponent('TreeNode'), { label: 'Item' }),
    );
  }
  if (name === 'Menu') {
    return createElement(
      Component,
      { ...props, label: 'Actions' },
      createElement(resolveCarbonComponent('MenuItem'), { label: 'Item' }),
    );
  }
  if (name === 'Switcher') {
    return createElement(
      Component,
      { ...props, 'aria-label': 'Switcher' },
      createElement(
        resolveCarbonComponent('SwitcherItem'),
        { href: '#' },
        'Item',
      ),
    );
  }
  if (name === 'OverflowMenuItem') {
    return createElement(
      resolveCarbonComponent('OverflowMenu'),
      { 'aria-label': 'Actions' },
      createElement(Component, props, 'Item'),
    );
  }
  if (name === 'HeaderMenuItem') {
    return createElement(
      'ul',
      null,
      createElement(Component, { ...props, href: '#' }, 'Item'),
    );
  }
  if (name === 'HeaderMenu') {
    return createElement(
      resolveCarbonComponent('Header'),
      { 'aria-label': 'Global navigation' },
      createElement(
        resolveCarbonComponent('HeaderNavigation'),
        { 'aria-label': 'Primary navigation' },
        createElement(
          Component,
          { ...props, menuLinkName: 'Menu' },
          createElement(
            resolveCarbonComponent('HeaderMenuItem'),
            { href: '#' },
            'Item',
          ),
        ),
      ),
    );
  }
  return null;
}

function tabFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (!/^(IconTab|Tab|Tabs)/.test(name)) return null;
  if (name === 'TabsSkeleton') return null;
  const Tabs = resolveCarbonComponent('Tabs');
  const Tab = resolveCarbonComponent('Tab');
  const TabList = resolveCarbonComponent('TabList');
  const TabListVertical = resolveCarbonComponent('TabListVertical');
  const TabPanel = resolveCarbonComponent('TabPanel');
  const TabPanels = resolveCarbonComponent('TabPanels');
  const Component = resolveCarbonComponent(name);
  const vertical = name === 'TabsVertical' || name === 'TabListVertical';
  const Root = vertical ? resolveCarbonComponent('TabsVertical') : Tabs;
  const List = vertical ? TabListVertical : TabList;
  const target = (children: ReactNode) =>
    createElement(Component, props, children);
  const selectedTab =
    name === 'Tab'
      ? target('Tab label')
      : name === 'IconTab'
        ? target(createElement('svg', { 'aria-hidden': true }))
        : createElement(Tab, null, 'Tab label');
  const selectedPanel =
    name === 'TabPanel'
      ? target('Panel content')
      : createElement(TabPanel, null, 'Panel content');
  const list =
    name === 'TabList' || name === 'TabListVertical'
      ? target(selectedTab)
      : createElement(List, null, selectedTab);
  const panels =
    name === 'TabPanels'
      ? target(selectedPanel)
      : createElement(TabPanels, null, selectedPanel);
  if (name === 'TabContent') {
    return createElement(
      Tabs,
      { selectedIndex: 0 },
      createElement(TabList, null, createElement(Tab, null, 'Tab label')),
      createElement(
        TabPanels,
        null,
        createElement(
          TabPanel,
          null,
          createElement(Component, props, 'Panel content'),
        ),
      ),
    );
  }
  if (name === 'Tabs' || name === 'TabsVertical')
    return createElement(
      Component,
      { ...props, selectedIndex: 0 },
      list,
      panels,
    );
  return createElement(Root, { selectedIndex: 0 }, list, panels);
}

function structuredListFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (!name.startsWith('StructuredList')) return null;
  const Body = resolveCarbonComponent('StructuredListBody');
  const Cell = resolveCarbonComponent('StructuredListCell');
  const Row = resolveCarbonComponent('StructuredListRow');
  const Wrapper = resolveCarbonComponent('StructuredListWrapper');
  const Component = resolveCarbonComponent(name);
  const target = (children: ReactNode, targetProps = props) =>
    createElement(Component, targetProps, children);
  const bodyCell = () => createElement(Cell, null, 'Cell value');
  const bodyRow = (children: ReactNode) => createElement(Row, null, children);
  const body = (children: ReactNode) => createElement(Body, null, children);
  const wrap = (children: ReactNode) =>
    createElement(Wrapper, { 'aria-label': 'Structured list' }, children);
  if (name === 'StructuredListWrapper')
    return target(body(bodyRow(bodyCell())));
  if (name === 'StructuredListBody') return wrap(target(bodyRow(bodyCell())));
  if (name === 'StructuredListHead') {
    return wrap(
      target(
        createElement(
          Row,
          { head: true },
          createElement(Cell, { head: true }, 'Heading'),
        ),
      ),
    );
  }
  if (name === 'StructuredListRow') return wrap(body(target(bodyCell())));
  if (name === 'StructuredListCell')
    return wrap(body(bodyRow(target('Cell value'))));
  if (name === 'StructuredListInput') {
    const inputId = 'carbon-workbench-structured-list-input';
    return wrap(
      body(
        bodyRow(
          createElement(
            Cell,
            null,
            createElement('label', { htmlFor: inputId }, 'Select row'),
            target(undefined, { ...props, id: inputId, title: 'Select row' }),
          ),
        ),
      ),
    );
  }
  return null;
}

function toolbarActionFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (name !== 'TableToolbarAction') return null;
  const OverflowMenu = resolveCarbonComponent('OverflowMenu');
  const TableToolbar = resolveCarbonComponent('TableToolbar');
  const Component = resolveCarbonComponent(name);
  return createElement(
    TableToolbar,
    null,
    createElement(
      OverflowMenu,
      { 'aria-label': 'Table actions' },
      createElement(Component, props, 'Action'),
    ),
  );
}

function contentSwitcherFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (!['ContentSwitcher', 'IconSwitch', 'Switch'].includes(name)) return null;
  const ContentSwitcher = resolveCarbonComponent('ContentSwitcher');
  const Switch = resolveCarbonComponent('Switch');
  const Component = resolveCarbonComponent(name);
  const change = () => undefined;
  const switchProps = { text: 'Option' };
  if (name === 'ContentSwitcher') {
    return createElement(
      Component,
      { ...props, onChange: change },
      createElement(Switch, switchProps),
    );
  }
  const targetProps =
    name === 'IconSwitch' ? { ...props, text: 'Option' } : switchProps;
  return createElement(
    ContentSwitcher,
    { onChange: change },
    createElement(Component, targetProps),
  );
}

function sideNavFixture(
  name: string,
  props: Readonly<Record<string, unknown>>,
): ReactElement | null {
  if (
    ![
      'SideNavDivider',
      'SideNavItem',
      'SideNavItems',
      'SideNavLink',
      'SideNavLinkText',
      'SideNavMenu',
      'SideNavMenuItem',
    ].includes(name)
  ) {
    return null;
  }
  const SideNav = resolveCarbonComponent('SideNav');
  const SideNavItems = resolveCarbonComponent('SideNavItems');
  const SideNavLink = resolveCarbonComponent('SideNavLink');
  const SideNavMenu = resolveCarbonComponent('SideNavMenu');
  const Component = resolveCarbonComponent(name);
  const root = (children: ReactNode) =>
    createElement(
      SideNav,
      { 'aria-label': 'Side navigation', expanded: true },
      children,
    );
  const items = (children: ReactNode) =>
    createElement(SideNavItems, null, children);
  const link = () => createElement(SideNavLink, { href: '#' }, 'Item');
  const target = (children?: ReactNode) =>
    children === undefined
      ? createElement(Component, props)
      : createElement(Component, props, children);
  if (name === 'SideNavItems') {
    return root(target(link()));
  }
  if (name === 'SideNavItem') {
    return root(items(target(createElement('a', { href: '#' }, 'Item'))));
  }
  if (name === 'SideNavLink') return root(items(target('Item')));
  if (name === 'SideNavLinkText') {
    return root(
      items(createElement(SideNavLink, { href: '#' }, target('Item'))),
    );
  }
  if (name === 'SideNavMenu') {
    return root(
      items(
        target(
          createElement(
            resolveCarbonComponent('SideNavMenuItem'),
            null,
            'Item',
          ),
        ),
      ),
    );
  }
  if (name === 'SideNavMenuItem') {
    return root(
      items(createElement(SideNavMenu, { title: 'Menu' }, target('Item'))),
    );
  }
  return root(items(target()));
}

export function renderCarbonComponent(
  name: string,
  args: Readonly<Record<string, unknown>> = {},
  remove: readonly string[] = [],
): ReactElement {
  const entry = componentEntryByName.get(name);
  if (!entry) throw new Error(`Unknown Carbon component entry: ${name}`);
  const Component = resolveCarbonComponent(name);
  const props: Record<string, unknown> = {
    ...entry.defaultArgs,
    ...args,
    ...(name === 'preview__Card.Card' && args.clickable === true
      ? { 'aria-label': 'Clickable card' }
      : {}),
  };
  if ('defaultChecked' in args) delete props.checked;
  if ('defaultValue' in args) delete props.value;
  for (const property of remove) delete props[property];
  if (
    ['Modal', 'ModalWrapper'].includes(name) &&
    args.preventCloseOnClickOutside === false
  ) {
    props.passiveModal = true;
  }
  if (name === 'Tabs' && args.dismissable === true) {
    props.onTabCloseRequest = () => undefined;
  }
  const polymorphic = polymorphicHostFixture(name, Component, props);
  if (polymorphic) return withRequiredParent(name, polymorphic, props);
  const table = tableFixture(name, props);
  if (table) return table;
  const tabs = tabFixture(name, props);
  if (tabs) return tabs;
  const structuredList = structuredListFixture(name, props);
  if (structuredList) return structuredList;
  const toolbarAction = toolbarActionFixture(name, props);
  if (toolbarAction) return toolbarAction;
  const composition = compositionFixture(name, props);
  if (composition) return composition;
  const contentSwitcher = contentSwitcherFixture(name, props);
  if (contentSwitcher) return contentSwitcher;
  const sideNav = sideNavFixture(name, props);
  if (sideNav) return sideNav;
  const children = componentChildren(name, props);
  const rendered = withRequiredParent(
    name,
    children === undefined
      ? createElement(Component, props)
      : createElement(Component, props, children),
    props,
  );
  return name.endsWith('Skeleton') && name !== 'ToggleSmallSkeleton'
    ? createElement(
        'div',
        { 'aria-label': 'Loading specimen', role: 'status' },
        rendered,
      )
    : rendered;
}

function controlledInitialValue(entry: ComponentEntry) {
  if (entry.name === 'Slider') return 50;
  if (entry.controlled.property === 'checked') return false;
  if (entry.controlled.property === 'selected') return true;
  if (entry.controlled.property === 'open') return true;
  if (entry.controlled.property === 'expanded') return true;
  if (entry.controlled.property === 'isExpanded') return true;
  if (entry.controlled.property === 'selectedIndex') return 0;
  return 'Controlled value';
}

function nextControlledValue(current: Primitive, values: readonly unknown[]) {
  for (const value of values) {
    if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return value;
    }
    if (value && typeof value === 'object') {
      const target = 'target' in value ? value.target : value;
      if (target && typeof target === 'object') {
        const record = target as Record<string, unknown>;
        if (typeof record.checked === 'boolean') return record.checked;
        if (typeof record.selectedIndex === 'number')
          return record.selectedIndex;
        if (
          typeof record.value === 'string' ||
          typeof record.value === 'number'
        ) {
          return record.value;
        }
      }
    }
  }
  if (typeof current === 'boolean') return !current;
  if (typeof current === 'number') return current + 1;
  return `${current} updated`;
}

function ControlledSpecimen({ entry }: Readonly<{ entry: ComponentEntry }>) {
  const [value, setValue] = useState<Primitive>(() =>
    controlledInitialValue(entry),
  );
  if (!entry.controlled.property) {
    return createElement(
      'section',
      { 'data-controlled-exclusion': entry.name },
      createElement('p', null, entry.controlled.reason),
      renderCarbonComponent(entry.name),
    );
  }
  const update = (...values: unknown[]) => {
    if (
      entry.controlled.callback === 'onClose' ||
      entry.controlled.callback === 'onRequestClose'
    ) {
      setValue(false);
      return;
    }
    if (
      entry.controlled.callback === 'onExpand' ||
      entry.controlled.callback === 'onHeadingClick' ||
      entry.controlled.callback === 'onToggle'
    ) {
      const next = values.find((candidate) => typeof candidate === 'boolean');
      setValue(typeof next === 'boolean' ? next : value !== true);
      return;
    }
    setValue(nextControlledValue(value, values));
  };
  return createElement(
    'section',
    null,
    createElement(
      'p',
      { 'aria-live': 'polite' },
      `Controlled value: ${String(value)}`,
    ),
    renderCarbonComponent(entry.name, {
      [entry.controlled.property]: value,
      [entry.controlled.callback!]: update,
    }),
  );
}

function renderSpecimen(
  entry: ComponentEntry,
  args: Readonly<Record<string, unknown>> = {},
  fixture?: ComponentSpecimen['fixture'],
  remove: readonly string[] = [],
  sourceId?: string,
  descriptor?: string,
  sourceFingerprint?: string,
) {
  const rendered =
    fixture === 'source' && sourceId && descriptor
      ? renderSourceFixture(entry, args, remove, descriptor, sourceId)
      : renderCarbonComponent(entry.name, args, remove);
  const sourceComposition =
    fixture === 'source' && sourceId && descriptor
      ? createElement(
          'section',
          {
            'aria-label': `${entry.name} ${descriptor} source specimen`,
            'data-source-composition': descriptor,
            ...(sourceFingerprint
              ? { 'data-source-fingerprint': sourceFingerprint }
              : {}),
            'data-source-specimen': sourceId,
          },
          rendered,
        )
      : rendered;
  const contextual =
    fixture === 'layer'
      ? createElement(
          'div',
          { 'data-layered-specimen': entry.name },
          createElement(resolveCarbonComponent('Layer'), null, rendered),
        )
      : sourceComposition;
  const describedBy = args['aria-describedby'];
  if (args.invalid === true && typeof describedBy === 'string') {
    return createElement(
      'div',
      null,
      contextual,
      createElement(
        'span',
        { id: describedBy, role: 'alert' },
        'Validation message',
      ),
    );
  }
  return contextual;
}

function renderSourceFixture(
  entry: ComponentEntry,
  args: Readonly<Record<string, unknown>>,
  remove: readonly string[],
  descriptor: string,
  sourceId: string,
) {
  return renderSourceComposition(
    {
      datePickerInputChildren,
      declarationHasProperty: (name, property) =>
        declarationByName
          .get(name)
          ?.properties.some((candidate) => candidate.name === property) ??
        false,
      renderCarbonComponent,
      resolveCarbonComponent,
    },
    entry,
    args,
    remove,
    descriptor,
    sourceId,
  );
}
function SpecimenSelector({
  entry,
  source,
  specimens,
}: Readonly<{
  entry: ComponentEntry;
  source: ComponentSpecimen['source'];
  specimens: readonly ComponentSpecimen[];
}>) {
  const fallback =
    specimens.find((specimen) => specimen.id !== 'state-disabled') ??
    specimens[0];
  if (!fallback) return createElement('p', null, 'No specimen is available.');
  const linkedSpecimen = () => {
    const hash = window.location.hash.slice(1);
    return (
      specimens.find((specimen) => specimen.id === hash)?.id ?? fallback.id
    );
  };
  const [selectedId, setSelectedId] = useState(linkedSpecimen);
  useEffect(() => {
    const selectLinkedSpecimen = () => setSelectedId(linkedSpecimen());
    window.addEventListener('hashchange', selectLinkedSpecimen);
    return () => window.removeEventListener('hashchange', selectLinkedSpecimen);
  });
  const selected =
    specimens.find((specimen) => specimen.id === selectedId) ?? fallback;
  const controlId = `${entry.id}-${source}-specimen`;
  return createElement(
    'section',
    { 'aria-label': `${entry.name} ${source} specimen` },
    createElement('label', { htmlFor: controlId }, 'Specimen'),
    createElement(
      'select',
      {
        id: controlId,
        onChange: (event: ChangeEvent<HTMLSelectElement>) =>
          setSelectedId(event.target.value),
        value: selected.id,
      },
      specimens.map((specimen) =>
        createElement(
          'option',
          { key: specimen.id, value: specimen.id },
          specimen.label,
        ),
      ),
    ),
    createElement('strong', null, selected.label),
    createElement(
      'div',
      { 'data-specimen-id': selected.id, id: selected.id },
      renderSpecimen(
        entry,
        selected.args,
        selected.fixture,
        selected.remove,
        selected.sourceId,
        selected.descriptor,
        selected.sourceFingerprint,
      ),
    ),
  );
}

function SpecimenList({
  entry,
  source,
}: Readonly<{ entry: ComponentEntry; source: ComponentSpecimen['source'] }>) {
  const specimens = entry.specimens.filter(
    (specimen) => specimen.source === source,
  );
  if (!specimens.length) {
    return createElement(
      'section',
      { [`data-${source}-exclusion`]: entry.name },
      createElement(
        'p',
        null,
        `No distinct public ${source} specimen is documented for this export.`,
      ),
      renderSpecimen(entry),
    );
  }
  return createElement(SpecimenSelector, { entry, source, specimens });
}

function VariantSpecimen({ entry }: Readonly<{ entry: ComponentEntry }>) {
  const specimens = entry.specimens.filter(
    (specimen) => specimen.source === 'api' || specimen.source === 'story',
  );
  if (!specimens.length) {
    return createElement(
      'section',
      { 'data-variant-exclusion': entry.name },
      createElement(
        'p',
        null,
        'No distinct public variant specimen is documented for this export.',
      ),
      renderSpecimen(entry),
    );
  }
  return createElement(SpecimenSelector, { entry, source: 'api', specimens });
}

function ResponsiveSpecimen({ entry }: Readonly<{ entry: ComponentEntry }>) {
  if (!entry.responsive.property) {
    return createElement(
      'section',
      { 'data-responsive-exclusion': entry.name },
      createElement('p', null, entry.responsive.reason),
      renderCarbonComponent(entry.name),
    );
  }
  if (entry.responsive.kind === 'layout') {
    const Grid = resolveCarbonComponent('Grid');
    const Row = resolveCarbonComponent('Row');
    const Column = resolveCarbonComponent('Column');
    const column = createElement(
      Column,
      { lg: 8, max: 8, md: 4, sm: 4, xlg: 8 },
      'Neutral Carbon specimen',
    );
    const row = createElement(Row, null, column);
    return createElement(Grid, null, row);
  }
  return createElement(
    'div',
    { style: { maxWidth: '20rem' } },
    renderCarbonComponent(entry.name, entry.responsive.args),
  );
}

export type GeneratedComponentStory = Readonly<{
  Controlled: StoryObj;
  Default: StoryObj;
  Playground: StoryObj;
  Responsive: StoryObj;
  States: StoryObj;
  Variants: StoryObj;
  meta: Meta;
}>;

export function componentStory(name: string): GeneratedComponentStory {
  const entry = componentEntryByName.get(name);
  if (!entry) throw new Error(`Unknown Carbon story: ${name}`);
  const category =
    entry.status === 'stable' ? 'Components' : `Components/${entry.status}`;
  return {
    Controlled: {
      render: () => createElement(ControlledSpecimen, { entry }),
    },
    Default: {
      render: () => renderCarbonComponent(entry.name),
    },
    Playground: {
      args: entry.playgroundArgs,
      render: (args) => renderCarbonComponent(entry.name, args),
    },
    Responsive: {
      render: () => createElement(ResponsiveSpecimen, { entry }),
    },
    States: {
      render: () => createElement(SpecimenList, { entry, source: 'state' }),
    },
    Variants: {
      render: () => createElement(VariantSpecimen, { entry }),
    },
    meta: {
      component: resolveCarbonComponent(entry.name) as ComponentType<
        Record<string, unknown>
      >,
      parameters: {
        carbon: {
          aliasOf: entry.aliasOf,
          apiPath: entry.apiPath,
          canonicalName: entry.canonicalName,
          exclusions: entry.excludedSpecimens,
          parent: entry.parent,
          sources: entry.sources,
          status: entry.status,
        },
        docs: {
          description: {
            component: `${entry.name} is an installed Carbon ${entry.status} export.`,
          },
        },
      },
      tags: [entry.status],
      title: `${category}/${entry.name}`,
    },
  };
}

export function catalogEntryNames() {
  return new Set([
    ...generatedComponentCoverage.allEntryNames,
    ...namespaceComponents,
  ]);
}
