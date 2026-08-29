import {
  createElement,
  Fragment,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from 'react';

import { sourceCompositionContract } from './source-composition-contracts.js';

export type SourceFixtureEntry = Readonly<{ name: string }>;

export type SourceFixtureDependencies = Readonly<{
  datePickerInputChildren: (
    inputName: string,
    id: string,
    type: 'range' | 'single',
  ) => ReactNode;
  declarationHasProperty: (name: string, property: string) => boolean;
  renderCarbonComponent: (
    name: string,
    args: Readonly<Record<string, unknown>>,
    remove?: readonly string[],
  ) => ReactElement;
  resolveCarbonComponent: (name: string) => ElementType;
}>;

export function renderSourceFixture(
  dependencies: SourceFixtureDependencies,
  entry: SourceFixtureEntry,
  args: Readonly<Record<string, unknown>>,
  remove: readonly string[],
  descriptor: string,
  sourceId: string,
) {
  const {
    datePickerInputChildren,
    declarationHasProperty,
    renderCarbonComponent,
    resolveCarbonComponent,
  } = dependencies;
  sourceCompositionContract(sourceId, descriptor);
  const sourceName = sourceId.split('#')[1] ?? '';
  const normalized = sourceName.replaceAll(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  const label = sourceName.replaceAll(/([a-z])([A-Z])/g, '$1 $2');
  const target = (
    extra: Readonly<Record<string, unknown>> = {},
    targetRemove = remove,
  ) => renderCarbonComponent(entry.name, { ...args, ...extra }, targetRemove);
  const icon = createElement(
    'svg',
    {
      'aria-label': `${label} icon`,
      height: 16,
      role: 'img',
      viewBox: '0 0 16 16',
      width: 16,
    },
    createElement('circle', { cx: 8, cy: 8, r: 5 }),
  );

  if (descriptor.startsWith('grid-')) {
    const Root = resolveCarbonComponent(
      entry.name === 'FlexGrid' ? 'FlexGrid' : 'Grid',
    );
    const Row = resolveCarbonComponent('Row');
    const Column = resolveCarbonComponent('Column');
    const base = (
      children: ReactNode,
      rootArgs: Record<string, unknown> = {},
    ) => createElement(Root, rootArgs, children);
    if (normalized.includes('subgrid')) {
      return base(
        createElement(
          Column,
          { lg: 10, md: 4, sm: 2 },
          createElement('p', null, 'Subgrid parent column'),
          createElement(
            resolveCarbonComponent('Grid'),
            { condensed: normalized.includes('rowgap') },
            createElement(Column, { lg: 4, md: 2, sm: 1 }, 'Nested column one'),
            createElement(Column, { lg: 4, md: 2, sm: 1 }, 'Nested column two'),
          ),
        ),
        normalized.includes('rowgap') ? { withRowGap: true } : {},
      );
    }
    if (normalized.includes('offset')) {
      return base(
        createElement(
          Row,
          null,
          createElement(
            Column,
            { sm: { offset: 2, span: 2 } },
            'Small offset 2',
          ),
          createElement(
            Column,
            { sm: { offset: 1, span: 3 } },
            'Small offset 1',
          ),
        ),
      );
    }
    if (normalized.includes('autocolumn')) {
      return base(
        createElement(
          Row,
          null,
          createElement(Column, null, 'Auto column one'),
          createElement(Column, null, 'Auto column two'),
          createElement(Column, null, 'Auto column three'),
          createElement(Column, null, 'Auto column four'),
        ),
      );
    }
    if (normalized.includes('mixedgutter')) {
      return base(
        createElement(
          Column,
          { span: 8 },
          createElement('p', null, 'Mixed gutter parent'),
          createElement(
            resolveCarbonComponent('Grid'),
            { narrow: true },
            createElement(Column, null, 'Narrow gutter'),
            createElement(Column, null, 'Narrow gutter'),
          ),
        ),
      );
    }
    if (normalized.includes('gridsettings')) {
      return base(
        createElement(
          resolveCarbonComponent('GridSettings'),
          null,
          createElement(
            Column,
            { sm: 4, md: 8, lg: 16 },
            'Grid settings column',
          ),
        ),
      );
    }
    return base(
      createElement(
        Row,
        null,
        createElement(
          Column,
          { sm: 2, md: 4, lg: 6 },
          'Small span 2, medium span 4, large span 6',
        ),
        createElement(
          Column,
          { sm: 2, md: 2, lg: 3 },
          'Small span 2, medium span 2, large span 3',
        ),
      ),
    );
  }

  if (descriptor.startsWith('tabs-')) {
    const vertical = entry.name === 'TabsVertical' || normalized === 'vertical';
    const Root = resolveCarbonComponent(vertical ? 'TabsVertical' : 'Tabs');
    const List = resolveCarbonComponent(
      vertical ? 'TabListVertical' : 'TabList',
    );
    const Tab = resolveCarbonComponent('Tab');
    const IconTab = resolveCarbonComponent('IconTab');
    const Panels = resolveCarbonComponent('TabPanels');
    const Panel = resolveCarbonComponent('TabPanel');
    const contained = normalized.includes('contained');
    const withIcons = normalized.includes('icon');
    const withSecondary = normalized.includes('secondary');
    const fullWidth = normalized.includes('fullwidth');
    const makeTab = (name: string, index: number) => {
      if (withIcons && normalized.includes('only')) {
        const iconSize = normalized.includes('20') ? 20 : 16;
        return createElement(
          IconTab,
          { disabled: index === 0, key: name, label: name },
          createElement(
            'svg',
            {
              'aria-label': `${name} icon`,
              height: iconSize,
              role: 'img',
              viewBox: '0 0 16 16',
              width: iconSize,
            },
            createElement('circle', { cx: 8, cy: 8, r: 5 }),
          ),
        );
      }
      return createElement(
        Tab,
        {
          ...(withIcons ? { renderIcon: () => icon } : {}),
          ...(withSecondary ? { secondaryLabel: `(${index + 1}/4)` } : {}),
          key: name,
        },
        name,
      );
    };
    const tabs = ['Overview', 'Details', 'Activity', 'Settings'];
    return createElement(
      Root,
      { selectedIndex: 0 },
      createElement(
        List,
        {
          activation: normalized.includes('manual') ? 'manual' : 'automatic',
          ...(contained ? { contained: true } : {}),
          ...(fullWidth ? { fullWidth: true } : {}),
          ...(withIcons && normalized.includes('only')
            ? { iconSize: normalized.includes('20') ? 'lg' : 'default' }
            : {}),
        },
        tabs.map(makeTab),
      ),
      createElement(
        Panels,
        null,
        tabs.map((name) =>
          createElement(Panel, { key: name }, `${name} panel`),
        ),
      ),
    );
  }

  if (descriptor.startsWith('card-')) {
    const Card = resolveCarbonComponent('preview__Card.Card');
    const Header = resolveCarbonComponent('preview__Card.CardHeader');
    const Body = resolveCarbonComponent('preview__Card.CardBody');
    const Footer = resolveCarbonComponent('preview__Card.CardFooter');
    const Title = resolveCarbonComponent('preview__Card.CardTitle');
    const Media = resolveCarbonComponent('preview__Card.CardMedia');
    const Actions = resolveCarbonComponent('preview__Card.CardActions');
    const Action = resolveCarbonComponent('preview__Card.CardAction');
    const AILabel = resolveCarbonComponent('AILabel');
    const AILabelContent = resolveCarbonComponent('AILabelContent');
    const AILabelActions = resolveCarbonComponent('AILabelActions');
    const IconButton = resolveCarbonComponent('IconButton');
    const withMedia = /media|video/.test(normalized);
    const withActions = normalized.includes('headeractions');
    const titleProps: Record<string, unknown> = {
      ...(normalized.includes('truncated') ? { titleTruncate: true } : {}),
    };
    const title = createElement(
      Title,
      titleProps,
      normalized.includes('leadingicon') ? icon : null,
      'Card title',
    );
    const header = createElement(
      Header,
      null,
      title,
      withActions
        ? createElement(
            Actions,
            null,
            createElement(
              Action,
              null,
              createElement(IconButton, { label: 'Card action' }, icon),
            ),
          )
        : null,
    );
    const media = withMedia
      ? createElement(
          Media,
          { ratio: normalized.includes('video') ? '16x9' : '1x1' },
          createElement(
            'span',
            null,
            normalized.includes('video') ? 'Video media' : 'Card media',
          ),
        )
      : null;
    const body = createElement(
      Body,
      { ...(normalized.includes('flush') ? { isFlush: true } : {}) },
      normalized.includes('minimal') ? 'Minimal card content' : 'Card content',
    );
    const card = createElement(
      Card,
      {
        clickable: normalized.includes('clickable'),
        ...(normalized.includes('ailabel')
          ? {
              decorator: createElement(
                AILabel,
                { 'aria-label': 'AI information' },
                createElement(AILabelContent, null, 'AI-assisted card'),
                createElement(
                  AILabelActions,
                  null,
                  createElement(IconButton, { label: 'View AI details' }, icon),
                ),
              ),
            }
          : {}),
        ...(normalized.includes('horizontal') ? { horizontal: true } : {}),
      },
      normalized.includes('headermedia') ? media : null,
      header,
      normalized.includes('headermedia') ? null : media,
      body,
      normalized.includes('icon') && !withActions
        ? createElement(
            Footer,
            null,
            createElement(IconButton, { label: 'Card icon' }, icon),
          )
        : null,
    );
    return card;
  }

  if (descriptor.startsWith('data-table-')) {
    const DataTable = resolveCarbonComponent(entry.name);
    const TableContainer = resolveCarbonComponent('TableContainer');
    const TableToolbar = resolveCarbonComponent('TableToolbar');
    const TableToolbarContent = resolveCarbonComponent('TableToolbarContent');
    const TableToolbarSearch = resolveCarbonComponent('TableToolbarSearch');
    const TableToolbarMenu = resolveCarbonComponent('TableToolbarMenu');
    const TableToolbarAction = resolveCarbonComponent('TableToolbarAction');
    const Table = resolveCarbonComponent('Table');
    const TableHead = resolveCarbonComponent('TableHead');
    const TableRow = resolveCarbonComponent('TableRow');
    const TableHeader = resolveCarbonComponent('TableHeader');
    const TableBody = resolveCarbonComponent('TableBody');
    const TableCell = resolveCarbonComponent('TableCell');
    const TableDecoratorRow = resolveCarbonComponent('TableDecoratorRow');
    const TableExpandRow = resolveCarbonComponent('TableExpandRow');
    const TableExpandHeader = resolveCarbonComponent('TableExpandHeader');
    const TableExpandedRow = resolveCarbonComponent('TableExpandedRow');
    const TableSelectAll = resolveCarbonComponent('TableSelectAll');
    const TableSelectRow = resolveCarbonComponent('TableSelectRow');
    const AILabel = resolveCarbonComponent('AILabel');
    const AILabelContent = resolveCarbonComponent('AILabelContent');
    const AILabelActions = resolveCarbonComponent('AILabelActions');
    const Button = resolveCarbonComponent('Button');
    const hasToolbar = /toolbar|overflow/.test(normalized);
    const expansion = normalized.includes('expansion');
    const selection = /selection|batchexpansion/.test(normalized);
    const ai =
      normalized.includes('ailabel') || normalized.includes('fulltableai');
    const columnAI = normalized.includes('columnailabel');
    const fullTableAI = normalized.includes('fulltableai');
    const aiLabel = createElement(
      AILabel,
      { 'aria-label': 'AI column information', align: 'bottom' },
      createElement(AILabelContent, null, 'AI-assisted column'),
      createElement(
        AILabelActions,
        null,
        createElement(Button, { size: 'sm' }, 'View details'),
      ),
    );
    const headers = [
      { header: 'Name', key: 'name' },
      {
        header: columnAI ? 'AI column' : 'Status',
        key: 'status',
        ...(columnAI ? { decorator: aiLabel } : {}),
      },
    ];
    const rows = [
      { id: 'source-row-one', name: 'Table row', status: 'Ready' },
      { id: 'source-row-two', name: 'Second row', status: 'Pending' },
    ];
    const toolbar = hasToolbar
      ? createElement(
          TableToolbar,
          { 'aria-label': 'Data table toolbar' },
          createElement(
            TableToolbarContent,
            null,
            createElement(TableToolbarSearch, {
              labelText: 'Search table',
              onChange: () => undefined,
              persistent: normalized.includes('persistent'),
            }),
            createElement(
              TableToolbarMenu,
              { 'aria-label': 'Table actions' },
              createElement(
                TableToolbarAction,
                { onClick: () => undefined },
                'Table action',
              ),
            ),
          ),
        )
      : null;
    const content = (renderProps: unknown) => {
      const api = renderProps as Readonly<{
        getCellProps?: (input: unknown) => Record<string, unknown>;
        getExpandHeaderProps?: () => Record<string, unknown>;
        getExpandedRowProps?: (input: unknown) => Record<string, unknown>;
        getHeaderProps?: (input: unknown) => Record<string, unknown>;
        getRowProps?: (input: unknown) => Record<string, unknown>;
        getSelectionProps?: (input?: unknown) => Record<string, unknown>;
        getTableContainerProps?: () => Record<string, unknown>;
        getTableProps?: () => Record<string, unknown>;
        headers: readonly Readonly<{
          decorator?: unknown;
          header: string;
          key: string;
        }>[];
        rows: readonly Readonly<{
          cells: readonly Readonly<{ id: string; value: unknown }>[];
          id: string;
        }>[];
      }>;
      const headerProps = (header: Readonly<{ decorator?: unknown }>) =>
        api.getHeaderProps?.({
          header,
          isSortable: normalized.includes('sort') && !header.decorator,
        }) ?? {};
      const rowProps = (row: unknown) => api.getRowProps?.({ row }) ?? {};
      const cellProps = (cell: unknown) => api.getCellProps?.({ cell }) ?? {};
      const selectionProps = (row?: unknown) =>
        api.getSelectionProps?.(row ? { row } : undefined) ?? {};
      const bodyRows = api.rows.map((row) => {
        const cells = row.cells.map((cell) =>
          createElement(
            TableCell,
            { key: cell.id, ...cellProps(cell) },
            cell.value as ReactNode,
          ),
        );
        const rowChildren = [
          ai
            ? createElement(TableDecoratorRow, {
                decorator: aiLabel,
                key: 'decorator',
              })
            : null,
          selection
            ? createElement(TableSelectRow, {
                key: 'selection',
                ...selectionProps(row),
              })
            : null,
          ...cells,
        ];
        if (!expansion) {
          return createElement(
            TableRow,
            { key: row.id, ...rowProps(row) },
            rowChildren,
          );
        }
        return createElement(
          Fragment,
          { key: row.id },
          createElement(
            TableExpandRow,
            { ...rowProps(row), key: `row-${row.id}` },
            rowChildren,
          ),
          createElement(
            TableExpandedRow,
            {
              colSpan: api.headers.length + (selection ? 3 : 2),
              key: `expanded-${row.id}`,
              ...((api.getExpandedRowProps?.({ row }) ?? {}) as Record<
                string,
                unknown
              >),
            },
            'Expandable row content',
          ),
        );
      });
      return createElement(
        TableContainer,
        {
          ...(api.getTableContainerProps?.() ?? {}),
          ...(fullTableAI ? { aiEnabled: true, decorator: aiLabel } : {}),
          description: ai ? 'AI-assisted table' : 'Neutral table composition',
          title: hasToolbar ? 'Data table toolbar' : 'Data table',
        },
        toolbar,
        createElement(
          Table,
          {
            ...(api.getTableProps?.() ?? {}),
            'aria-label': 'Source table structure',
          },
          createElement(
            TableHead,
            null,
            createElement(
              TableRow,
              null,
              expansion
                ? createElement(TableExpandHeader, {
                    enableToggle: true,
                    ...(api.getExpandHeaderProps?.() ?? {}),
                  })
                : null,
              ai ? createElement('th', { scope: 'col' }) : null,
              selection
                ? createElement(TableSelectAll, selectionProps())
                : null,
              api.headers.map((header) =>
                createElement(
                  TableHeader,
                  { key: header.key, ...headerProps(header) },
                  header.header,
                ),
              ),
            ),
          ),
          createElement(TableBody, null, bodyRows),
        ),
      );
    };
    return createElement(
      DataTable,
      {
        ...args,
        headers,
        isSortable: normalized.includes('sort'),
        radio: false,
        rows,
        useZebraStyles: expansion,
      },
      content as unknown as ReactNode,
    );
  }
  if (descriptor.startsWith('slider-')) {
    return target(
      {
        hideTextInput: normalized.includes('hiddeninputs'),
        labelText: normalized.includes('customvaluelabel')
          ? 'Value level'
          : 'Range value',
        unstable_valueUpper: normalized.includes('twohandle') ? 75 : undefined,
        value: 25,
        ...(normalized.includes('customvaluelabel')
          ? { formatLabel: (value: number) => (value < 50 ? 'Low' : 'High') }
          : {}),
      },
      normalized.includes('twohandle')
        ? remove
        : [...remove, 'unstable_valueUpper'],
    );
  }

  if (descriptor.startsWith('shell-')) {
    const Header = resolveCarbonComponent('Header');
    const HeaderName = resolveCarbonComponent('HeaderName');
    const HeaderNavigation = resolveCarbonComponent('HeaderNavigation');
    const HeaderMenuItem = resolveCarbonComponent('HeaderMenuItem');
    const HeaderGlobalBar = resolveCarbonComponent('HeaderGlobalBar');
    const HeaderGlobalAction = resolveCarbonComponent('HeaderGlobalAction');
    const HeaderPanel = resolveCarbonComponent('HeaderPanel');
    const SideNav = resolveCarbonComponent('SideNav');
    const SideNavItems = resolveCarbonComponent('SideNavItems');
    const SideNavLink = resolveCarbonComponent('SideNavLink');
    const SideNavDivider = resolveCarbonComponent('SideNavDivider');
    const SideNavIcon = resolveCarbonComponent('SideNavIcon');
    const Switcher = resolveCarbonComponent('Switcher');
    const SwitcherItem = resolveCarbonComponent('SwitcherItem');
    const sideNav = normalized.includes('sidenav');
    const actions = normalized.includes('actions');
    const fixed = normalized.includes('fixed');
    const rail = normalized.includes('rail');
    if (sideNav && entry.name === 'SideNav') {
      return createElement(
        SideNav,
        {
          'aria-label': 'Source side navigation',
          expanded: true,
          isFixedNav: fixed,
          isRail: rail,
        },
        createElement(
          SideNavItems,
          null,
          createElement(
            SideNavLink,
            { href: '#' },
            normalized.includes('icons')
              ? createElement(
                  'span',
                  null,
                  createElement(SideNavIcon, null, icon),
                  'Icon navigation',
                )
              : 'Navigation item',
          ),
          normalized.includes('divider')
            ? createElement(SideNavDivider, null)
            : null,
          normalized.includes('large')
            ? createElement(SideNavLink, { href: '#' }, 'Additional item')
            : null,
        ),
      );
    }
    return createElement(
      Header,
      { 'aria-label': 'Source global navigation' },
      createElement(HeaderName, { href: '#' }, 'BAP'),
      normalized.includes('navigation')
        ? createElement(
            HeaderNavigation,
            { 'aria-label': 'Primary navigation' },
            createElement(HeaderMenuItem, { href: '#' }, 'Section'),
          )
        : null,
      actions
        ? createElement(
            HeaderGlobalBar,
            null,
            createElement(
              HeaderGlobalAction,
              { 'aria-label': 'Search', onClick: () => undefined },
              icon,
            ),
          )
        : null,
      normalized.includes('rightpanel')
        ? createElement(
            HeaderPanel,
            { 'aria-label': 'Source panel', expanded: true },
            'Right panel',
          )
        : null,
      normalized.includes('sidenav')
        ? createElement(
            SideNav,
            { 'aria-label': 'Header side navigation', expanded: true },
            createElement(
              SideNavItems,
              null,
              createElement(SideNavLink, { href: '#' }, 'Section'),
            ),
          )
        : null,
      normalized.includes('switcher')
        ? createElement(
            Switcher,
            { 'aria-label': 'Source switcher' },
            createElement(SwitcherItem, { href: '#' }, 'Workspace'),
          )
        : null,
    );
  }

  if (descriptor.startsWith('modal-')) {
    if (entry.name === 'ComposedModal') {
      const ModalHeader = resolveCarbonComponent('ModalHeader');
      const ModalBody = resolveCarbonComponent('ModalBody');
      const ModalFooter = resolveCarbonComponent('ModalFooter');
      return createElement(
        resolveCarbonComponent('ComposedModal'),
        {
          ...args,
          isFullWidth: normalized.includes('fullwidth'),
          open: true,
          preventCloseOnClickOutside: !normalized.includes('passive'),
        },
        createElement(ModalHeader, { label: 'Dialog', title: 'Source modal' }),
        createElement(
          ModalBody,
          { hasScrollingContent: normalized.includes('scrolling') },
          normalized.includes('inlineloading')
            ? renderCarbonComponent('InlineLoading', {
                description: 'Loading source content',
                status: 'active',
              })
            : 'Modal content',
        ),
        normalized.includes('passive')
          ? null
          : createElement(ModalFooter, { primaryButtonText: 'Confirm' }),
      );
    }
    return renderCarbonComponent(
      entry.name,
      {
        ...args,
        ...(normalized.includes('fullwidth') ? { isFullWidth: true } : {}),
        ...(normalized.includes('scrolling')
          ? { hasScrollingContent: true }
          : {}),
      },
      remove,
    );
  }

  if (descriptor.startsWith('tile-')) {
    const Tile = resolveCarbonComponent(entry.name);
    const Button = resolveCarbonComponent('Button');
    const tileProps: Record<string, unknown> = {
      ...args,
      ...(entry.name === 'SelectableTile'
        ? {
            selected:
              normalized.includes('selectable') ||
              normalized.includes('multiselect'),
          }
        : {}),
      ...(entry.name === 'RadioTile'
        ? { checked: true, value: 'source-tile' }
        : {}),
      ...(entry.name === 'ExpandableTile'
        ? { expanded: true, tileMaxHeight: 100 }
        : {}),
    };
    return createElement(
      Tile,
      tileProps,
      'Tile content',
      normalized.includes('interactive')
        ? createElement(Button, { kind: 'ghost', size: 'sm' }, 'Tile action')
        : null,
    );
  }

  if (descriptor.startsWith('contained-list-')) {
    const ContainedList = resolveCarbonComponent('ContainedList');
    const Item = resolveCarbonComponent('ContainedListItem');
    const Button = resolveCarbonComponent('Button');
    const Search = resolveCarbonComponent('Search');
    return createElement(
      ContainedList,
      {
        label: normalized.includes('titledecorators')
          ? 'Decorated list'
          : 'Source list',
        action: normalized.includes('actions')
          ? createElement(Button, { kind: 'ghost', size: 'sm' }, 'List action')
          : undefined,
      },
      normalized.includes('search')
        ? createElement(Search, {
            closeButtonLabelText: 'Clear list search',
            labelText: 'List search',
          })
        : null,
      createElement(
        Item,
        {
          action: normalized.includes('interactive')
            ? createElement(Button, { kind: 'ghost', size: 'sm' }, 'Open item')
            : undefined,
        },
        normalized.includes('icons')
          ? createElement('span', null, icon, ' Item with icon')
          : 'List item',
      ),
      createElement(Item, null, 'Second list item'),
    );
  }

  if (descriptor === 'ai-decoration') {
    const AILabel = resolveCarbonComponent('AILabel');
    const AILabelContent = resolveCarbonComponent('AILabelContent');
    const AILabelActions = resolveCarbonComponent('AILabelActions');
    const Button = resolveCarbonComponent('Button');
    const decorator = createElement(
      AILabel,
      { 'aria-label': 'AI information' },
      createElement(AILabelContent, null, 'AI-assisted input'),
      createElement(
        AILabelActions,
        null,
        createElement(Button, { size: 'sm' }, 'View details'),
      ),
    );
    const supportsDecorator = declarationHasProperty(entry.name, 'decorator');
    if (supportsDecorator) return target({ decorator });
    if (entry.name === 'DatePicker') {
      const DatePicker = resolveCarbonComponent('DatePicker');
      const Input = resolveCarbonComponent('DatePickerInput');
      return createElement(
        DatePicker,
        { datePickerType: 'single' },
        createElement(Input, {
          datePickerType: 'single',
          decorator,
          id: 'source-ai-date',
          labelText: 'AI-assisted date',
        }),
      );
    }
    if (entry.name === 'FluidSelect') return target({ decorator });
    if (entry.name === 'Form') {
      return createElement(
        resolveCarbonComponent('Form'),
        { 'aria-label': 'AI-assisted form' },
        createElement(resolveCarbonComponent('TextInput'), {
          decorator,
          id: 'source-ai-form-input',
          labelText: 'AI-assisted field',
        }),
      );
    }
    throw new Error(`No supported AI decorator contract for ${sourceId}.`);
  }

  if (descriptor === 'toggletip-decoration') {
    const Toggletip = resolveCarbonComponent('Toggletip');
    const ToggletipButton = resolveCarbonComponent('ToggletipButton');
    const ToggletipContent = resolveCarbonComponent('ToggletipContent');
    return createElement(
      'div',
      null,
      target(),
      createElement(
        Toggletip,
        { defaultOpen: true },
        createElement(ToggletipButton, null, 'More information'),
        createElement(ToggletipContent, null, 'Toggletip content'),
      ),
    );
  }

  if (descriptor === 'overflow-content') {
    const Breadcrumb = resolveCarbonComponent('Breadcrumb');
    const BreadcrumbItem = resolveCarbonComponent('BreadcrumbItem');
    const OverflowMenu = resolveCarbonComponent('OverflowMenu');
    const OverflowMenuItem = resolveCarbonComponent('OverflowMenuItem');
    return createElement(
      Breadcrumb,
      { 'aria-label': 'Source breadcrumb' },
      createElement(BreadcrumbItem, { href: '#' }, 'Home'),
      createElement(
        OverflowMenu,
        { 'aria-label': 'More breadcrumbs' },
        createElement(OverflowMenuItem, { itemText: 'Archived section' }),
      ),
      createElement(
        BreadcrumbItem,
        { href: '#' },
        normalized.includes('visualsnapshot')
          ? 'Visual snapshot breadcrumb'
          : 'Overflow breadcrumb',
      ),
    );
  }

  if (descriptor === 'range-control') {
    return target({
      labelText: 'Range value',
      unstable_valueUpper: 75,
      value: 25,
    });
  }

  if (descriptor === 'selection-data') {
    if (entry.name.includes('MultiSelect')) {
      return target({
        open: true,
        ...(normalized.includes('selectall')
          ? { selectedItems: [{ id: 'option-one', text: 'Option one' }] }
          : {}),
      });
    }
    if (entry.name === 'Pagination') {
      return target({
        ...(normalized.includes('unknownpages') ? { pagesUnknown: true } : {}),
        ...(normalized.includes('custompagesizes')
          ? { pageSizes: [10, 20] }
          : {}),
      });
    }
    return target({ isSortable: true });
  }

  if (descriptor === 'tree-hierarchy' || descriptor === 'link-hierarchy') {
    const TreeView = resolveCarbonComponent('TreeView');
    const TreeNode = resolveCarbonComponent('TreeNode');
    return createElement(
      TreeView,
      { 'aria-label': 'Source tree' },
      createElement(
        TreeNode,
        {
          label: normalized.includes('link')
            ? createElement('a', { href: '#' }, 'Linked parent')
            : 'Parent node',
        },
        createElement(TreeNode, { label: 'Nested child' }),
      ),
    );
  }

  if (descriptor === 'layout-context') {
    if (entry.name === 'RadioButton') {
      const Group = resolveCarbonComponent('RadioButtonGroup');
      const Radio = resolveCarbonComponent('RadioButton');
      return createElement(
        Group,
        {
          legendText: 'Vertical options',
          name: 'source-radio',
          orientation: normalized.includes('vertical')
            ? 'vertical'
            : 'horizontal',
        },
        createElement(Radio, {
          id: 'source-radio-one',
          labelText: 'Option one',
          value: 'one',
        }),
        createElement(Radio, {
          id: 'source-radio-two',
          labelText: 'Option two',
          value: 'two',
        }),
      );
    }
    return createElement(
      'div',
      { dir: normalized.includes('direction') ? 'rtl' : undefined },
      target(),
    );
  }

  if (descriptor === 'theme-context') {
    const Theme = resolveCarbonComponent('Theme');
    return createElement(
      Theme,
      { theme: normalized.includes('dark') ? 'g100' : 'g10' },
      target(),
    );
  }

  if (descriptor === 'fluid-layout') {
    const FluidTextInput = resolveCarbonComponent('FluidTextInput');
    return createElement(FluidTextInput, {
      id: 'source-fluid-text',
      labelText: 'Fluid text input',
    });
  }

  if (descriptor === 'skeleton-layout') {
    const Skeleton = resolveCarbonComponent('StructuredListSkeleton');
    return createElement(Skeleton, { 'aria-label': 'Structured list loading' });
  }

  if (descriptor === 'overlay-state') {
    return target({
      active: true,
      description: 'Loading source content',
      withOverlay: true,
    });
  }

  if (descriptor === 'validation-state') {
    return target({
      invalid: true,
      invalidText: 'Custom validation message',
      label: 'Validated number',
    });
  }

  if (descriptor === 'heading-level') {
    if (entry.name === 'Heading') {
      const Heading = resolveCarbonComponent('Heading');
      const Section = resolveCarbonComponent('Section');
      return createElement(
        'div',
        null,
        createElement(Heading, null, 'Project overview'),
        createElement(
          Section,
          { level: 2 },
          createElement(Heading, null, 'Program area'),
        ),
        createElement(
          Section,
          { level: 3 },
          createElement(Heading, null, 'Delivery phase'),
        ),
        createElement(
          Section,
          { level: 4 },
          createElement(Heading, null, 'Work item'),
        ),
        createElement(
          Section,
          { level: 5 },
          createElement(Heading, null, 'Release readiness'),
        ),
      );
    }
    return target({ level: 1 });
  }

  if (descriptor === 'direction-context') {
    return createElement('div', { dir: 'rtl' }, target());
  }

  if (descriptor === 'condensed-density') {
    return target({ isCondensed: true });
  }

  if (descriptor === 'accessible-label') {
    return target({
      labelA: 'Disabled',
      labelB: 'Enabled',
      labelText: 'Accessible toggle',
    });
  }

  if (descriptor === 'tooltip-behavior') {
    return target({
      pageText: (page: number) => `Page ${page}`,
      pageRangeText: (page: number, total: number) =>
        `${page} of ${total} pages`,
    });
  }

  if (descriptor === 'expanded-state') {
    return target({ isExpanded: true });
  }

  if (descriptor === 'action-menu') {
    return target({
      menuAlignment: normalized.includes('alignment')
        ? 'top-end'
        : 'bottom-start',
    });
  }

  if (descriptor === 'icon-composition') {
    if (entry.name === 'ContentSwitcher') {
      const Switch = resolveCarbonComponent('IconSwitch');
      return createElement(
        resolveCarbonComponent('ContentSwitcher'),
        { onChange: () => undefined },
        createElement(Switch, { name: 'source-one', text: 'First view' }, icon),
        createElement(
          Switch,
          { name: 'source-two', text: 'Second view' },
          icon,
        ),
      );
    }
    if (entry.name === 'Link') {
      return target({ renderIcon: () => icon });
    }
    if (entry.name === 'OverflowMenu') {
      const Item = resolveCarbonComponent('OverflowMenuItem');
      return createElement(
        resolveCarbonComponent('OverflowMenu'),
        { 'aria-label': 'Icon menu', renderIcon: () => icon },
        createElement(Item, { itemText: 'Icon menu action' }),
      );
    }
    if (entry.name === 'TreeView') {
      const Node = resolveCarbonComponent('TreeNode');
      return createElement(
        resolveCarbonComponent('TreeView'),
        { 'aria-label': 'Icon tree' },
        createElement(Node, { label: 'Icon node', renderIcon: () => icon }),
      );
    }
    if (['ComboButton', 'MenuButton'].includes(entry.name)) {
      const Item = resolveCarbonComponent('MenuItem');
      return createElement(
        resolveCarbonComponent(entry.name),
        { label: 'Source actions' },
        createElement(Item, { label: 'First action', renderIcon: () => icon }),
        createElement(Item, { label: 'Second action', renderIcon: () => icon }),
      );
    }
    throw new Error(`No supported icon composition contract for ${sourceId}.`);
  }

  if (descriptor === 'badge-indicator') {
    return target({
      badgeCount: 2,
      hasIconOnly: true,
      kind: 'ghost',
      size: 'lg',
    });
  }

  if (descriptor === 'loading-state') {
    return target({ description: 'Loading source content', status: 'active' });
  }

  if (
    descriptor === 'component-alignment' ||
    descriptor === 'component-duration'
  ) {
    return target({
      ...(descriptor === 'component-alignment'
        ? { align: 'bottom' }
        : { enterDelayMs: 500 }),
    });
  }

  if (descriptor === 'component-defaultwithsize20') {
    return target({ size: 20 });
  }

  if (descriptor === 'component-defaultwithtextsize14') {
    return target({ textSize: 14 });
  }

  if (descriptor === 'component-determinate') {
    return target({ value: 75 });
  }

  if (descriptor === 'component-expandable') {
    return target({ isExpanded: true });
  }

  if (descriptor.startsWith('component-draganddropupload')) {
    const DropContainer = resolveCarbonComponent('FileUploaderDropContainer');
    return createElement(DropContainer, {
      accept: ['.txt'],
      labelText: 'Drop a neutral file',
    });
  }

  if (descriptor === 'component-experimentalautoalign') {
    return target(
      entry.name === 'Tooltip'
        ? { autoAlign: true }
        : { menuAlignment: 'top-end' },
    );
  }

  if (descriptor === 'component-interactive') {
    return target({ currentIndex: 1 });
  }

  if (descriptor === 'component-operational') {
    return target({ type: 'blue' });
  }

  if (descriptor === 'component-rangewithcalendar') {
    return createElement(
      resolveCarbonComponent('FluidDatePicker'),
      null,
      datePickerInputChildren(
        'FluidDatePickerInput',
        'source-fluid-range',
        'range',
      ),
    );
  }

  if (descriptor === 'component-selectable') {
    return target({ type: 'outline' });
  }

  if (
    descriptor === 'component-selectall' ||
    descriptor === 'component-selectallwithdynamicitems'
  ) {
    return target({
      open: true,
      selectedItems: [{ id: 'option-one', text: 'Option one' }],
    });
  }

  if (descriptor === 'component-simple' || descriptor === 'component-single') {
    if (entry.name === 'FluidDatePicker') {
      return createElement(
        resolveCarbonComponent('FluidDatePicker'),
        null,
        datePickerInputChildren(
          'FluidDatePickerInput',
          'source-fluid-single',
          'single',
        ),
      );
    }
    return target({ defaultChecked: true });
  }

  if (descriptor === 'component-specificelement') {
    const Menu = resolveCarbonComponent('Menu');
    const MenuItem = resolveCarbonComponent('MenuItem');
    return createElement(
      Menu,
      { label: 'Context actions', open: true },
      createElement(MenuItem, { label: 'Specific element action' }),
    );
  }

  if (descriptor === 'component-tabtip') {
    const Popover = resolveCarbonComponent('Popover');
    return createElement(
      Popover,
      { isTabTip: true, open: true },
      createElement('button', { type: 'button' }, 'Tab tip target'),
    );
  }

  if (descriptor === 'component-usageexamples') {
    return target({ as: 'p' });
  }

  if (descriptor === 'component-uselayer') {
    return createElement(
      resolveCarbonComponent('Layer'),
      { level: 1 },
      'Layered source content',
    );
  }

  if (descriptor === 'component-useprefersdarkscheme') {
    return createElement(
      resolveCarbonComponent('Theme'),
      { theme: 'g100' },
      target(),
    );
  }

  if (descriptor === 'component-uxexample') {
    return target({
      description: 'Loading neutral source content',
      status: 'active',
    });
  }

  if (descriptor === 'component-withbackgroundlayer') {
    return createElement(
      resolveCarbonComponent('Layer'),
      { withBackground: true },
      target({ isCondensed: true }),
    );
  }

  if (descriptor === 'component-withcustomcontext') {
    return createElement(
      resolveCarbonComponent('ErrorBoundary'),
      { fallback: createElement('p', null, 'Neutral fallback') },
      createElement('p', null, 'Context-aware source content'),
    );
  }

  if (descriptor === 'component-withdanger') {
    return target({ kind: 'danger' });
  }

  if (descriptor === 'component-withdividers') {
    return target({ menuBorder: true });
  }

  if (descriptor === 'component-withinitialselecteditems') {
    return target({
      initialSelectedItems: [{ id: 'option-one', text: 'Option one' }],
    });
  }

  if (descriptor === 'component-withinteractiveelements') {
    return target({
      actionButtonLabel: 'Continue',
      onActionButtonClick: () => undefined,
      subtitle: 'Contains an action',
      title: 'Interactive callout',
    });
  }

  if (descriptor === 'component-withlargetext') {
    return target({
      definition: 'A longer neutral definition provides additional detail.',
      tooltipText: 'A longer neutral definition provides additional detail.',
    });
  }

  if (descriptor === 'component-withoutpagesizes') {
    return target({ pageSizes: [] });
  }

  if (descriptor === 'component-withrenderpageselect') {
    return target({
      renderPageSelect: () =>
        createElement('span', null, 'Custom page selector'),
    });
  }

  throw new Error(
    `No reviewed source fixture renderer for ${sourceId} (${descriptor}).`,
  );
}
