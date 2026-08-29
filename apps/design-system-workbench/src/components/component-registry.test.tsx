import { describe, expect, it } from 'vitest';

import { generatedComponentCoverage } from './component-coverage.generated.js';
import {
  catalogEntryNames,
  componentEntries,
  componentStory,
  nonRenderableEntries,
  renderCarbonComponent,
  resolveCarbonComponent,
} from './component-registry.js';

const literalCoverageByName: Readonly<
  Record<
    string,
    readonly Readonly<{
      args: Readonly<Record<string, boolean | number | string>>;
      executionStatus: 'covered' | 'excluded';
      id: string;
      propertyName: string;
      reason: string;
      value: boolean | number | string;
    }>[]
  >
> = generatedComponentCoverage.literalCoverageByName;

describe('component catalog registry', () => {
  it('classifies every declaration and recursive namespace member once', () => {
    const expected = catalogEntryNames();
    const observed = [
      ...componentEntries.map((entry) => entry.name),
      ...nonRenderableEntries.map((entry) => entry.name),
    ];
    expect(new Set(observed)).toEqual(expected);
    expect(observed).toHaveLength(expected.size);
  });

  it('keeps required coverage for every renderable export', () => {
    for (const entry of componentEntries) {
      const story = componentStory(entry.name);
      expect(story.Default).toBeDefined();
      expect(story.Playground).toBeDefined();
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.specimens.every((specimen) => specimen.id.length > 0)).toBe(
        true,
      );
      expect(
        entry.excludedSpecimens.every(
          (exclusion) => exclusion.id.length > 0 && exclusion.reason.length > 0,
        ),
      ).toBe(true);
      expect(resolveCarbonComponent(entry.name)).toBeDefined();
      expect(renderCarbonComponent(entry.name)).toBeDefined();
    }
  });

  it('accounts for every declared public literal with a specimen or exclusion', () => {
    for (const entry of componentEntries) {
      for (const literal of literalCoverageByName[entry.name] ?? []) {
        if (literal.executionStatus === 'covered') {
          expect(entry.specimens).toContainEqual(
            expect.objectContaining({ args: literal.args, id: literal.id }),
          );
          continue;
        }
        expect(entry.excludedSpecimens).toContainEqual(
          expect.objectContaining({
            id: literal.id,
            propertyName: literal.propertyName,
            reason: literal.reason,
            value: literal.value,
          }),
        );
      }
    }
  });

  it('does not leave a non-renderable export unexplained', () => {
    expect(generatedComponentCoverage.allEntryNames.length).toBeGreaterThan(0);
    expect(nonRenderableEntries.every((entry) => entry.reason.length > 0)).toBe(
      true,
    );
  });

  it('keeps skeleton and menu defaults semantically valid', () => {
    for (const name of ['ButtonSkeleton', 'ToggleSkeleton']) {
      const skeleton = componentEntries.find((entry) => entry.name === name);
      expect(skeleton?.defaultArgs).not.toHaveProperty('aria-label');
      expect(skeleton?.playgroundArgs).not.toHaveProperty('aria-label');
    }
    const tableSkeleton = componentEntries.find(
      (entry) => entry.name === 'DataTableSkeleton',
    );
    expect(tableSkeleton?.defaultArgs).toEqual(
      expect.objectContaining({
        'aria-label': 'Loading data table',
        headers: [
          { header: 'Column 1' },
          { header: 'Column 2' },
          { header: 'Column 3' },
          { header: 'Column 4' },
          { header: 'Column 5' },
        ],
      }),
    );
    const radioGroup = componentEntries.find(
      (entry) => entry.name === 'MenuItemRadioGroup',
    );
    expect(
      (
        radioGroup?.defaultArgs.itemToString as
          ((item: { text: string }) => string) | undefined
      )?.({ text: 'Option one' }),
    ).toBe('Option one');
    expect(
      componentEntries.find((entry) => entry.name === 'IconTab')?.defaultArgs,
    ).toEqual(
      expect.objectContaining({ enterDelayMs: 5_000, leaveDelayMs: 0 }),
    );
  });

  it('records parent context for every known compound child', () => {
    const compoundNames = [
      'AccordionItem',
      'BreadcrumbItem',
      'ModalBody',
      'TableCell',
      'TabPanel',
      'preview__Card.CardBody',
      'preview__Dialog.DialogBody',
      'unstable__PageHeader.PageHeaderContent',
    ];
    for (const name of compoundNames) {
      expect(
        componentEntries.find((entry) => entry.name === name)?.parent,
      ).toBeTruthy();
    }
  });

  it('uses reviewed controlled contracts beyond value and checked inputs', () => {
    const expected = [
      ['ComposedModal', 'open'],
      ['Menu', 'open'],
      ['OverflowMenu', 'open'],
      ['Popover', 'open'],
      ['SideNav', 'expanded'],
      ['SelectableTag', 'selected'],
      ['SelectableTile', 'selected'],
      ['AccordionItem', 'open'],
      ['TableExpandRow', 'isExpanded'],
      ['RadioButton', 'checked'],
      ['RadioTile', 'checked'],
    ];
    for (const [name, property] of expected) {
      expect(
        componentEntries.find((entry) => entry.name === name)?.controlled,
      ).toEqual(expect.objectContaining({ property, reason: null }));
    }
  });

  it('documents a real responsive variation or an explicit exclusion', () => {
    for (const entry of componentEntries) {
      if (entry.responsive.property) {
        if (entry.responsive.kind === 'prop') {
          expect(Object.keys(entry.responsive.args)).toEqual([
            entry.responsive.property,
          ]);
        } else {
          expect(entry.responsive.kind).toBe('layout');
          expect(['Column', 'Grid', 'Row']).toContain(entry.name);
        }
        expect(entry.responsive.reason).toBeNull();
        continue;
      }
      expect(entry.responsive.kind).toBe('excluded');
      expect(entry.responsive.reason).toMatch(
        /responsive breakpoint or layout/i,
      );
    }
    expect(
      componentEntries
        .filter((entry) => entry.responsive.kind !== 'excluded')
        .map((entry) => entry.name),
    ).toEqual(['Column', 'Grid', 'Row']);
  });

  it('renders reviewed public Layer compositions inside the Layer provider', () => {
    const expected = [
      ['ContentSwitcher', 'IconOnlyWithLayer'],
      ['FluidTextArea', 'DefaultWithLayers'],
      ['MultiSelect', 'WithLayerMultiSelect'],
      ['ExpandableSearch', 'ExpandableWithLayer'],
      ['Tile', 'DefaultWithLayer'],
      ['ClickableTile', 'ClickableWithLayer'],
      ['RadioTile', 'RadioWithLayer'],
      ['ExpandableTile', 'ExpandableWithLayer'],
    ];
    for (const [name, label] of expected) {
      expect(
        componentEntries.find((entry) => entry.name === name)?.specimens,
      ).toContainEqual(
        expect.objectContaining({ fixture: 'layer', label, source: 'story' }),
      );
    }
  });

  it('applies source patches after base fixture defaults', () => {
    expect(
      componentEntries.find((entry) => entry.name === 'ProgressBar')?.specimens,
    ).toContainEqual(
      expect.objectContaining({
        label: 'Indeterminate',
        remove: ['value'],
        source: 'story',
      }),
    );
    const expected = new Map([
      ['ComposedModal', { isFullWidth: true }],
      ['Pagination', { pagesUnknown: true }],
      ['Tooltip', { align: 'bottom' }],
      ['preview__ShapeIndicator', { textSize: 14 }],
      ['SelectableTile', { selected: true }],
      ['RadioTile', { checked: true }],
      ['ExpandableTile', { expanded: true }],
    ]);
    for (const [name, args] of expected) {
      expect(
        componentEntries.find((entry) => entry.name === name)?.specimens,
      ).toContainEqual(expect.objectContaining({ args, source: 'story' }));
    }
  });

  it('keeps reviewed source compositions distinct from base fixtures', () => {
    const expected = [
      [
        'Grid',
        'packages/react/src/components/Grid/Grid.stories.js#Offset',
        'grid-offset',
      ],
      [
        'Tabs',
        'packages/react/src/components/Tabs/Tabs.stories.js#Contained',
        'tabs-contained',
      ],
      [
        'preview__Card.Card',
        'packages/react/src/components/Card/Card.stories.js#WithMedia',
        'card-withmedia',
      ],
      [
        'DataTable',
        'packages/react/src/components/DataTable/stories/DataTable-toolbar.stories.js#PersistentToolbar',
        'data-table-persistenttoolbar',
      ],
      [
        'Slider',
        'packages/react/src/components/Slider/Slider.stories.js#TwoHandleSlider',
        'slider-twohandleslider',
      ],
      [
        'Header',
        'packages/react/src/components/UIShell/UIShell.HeaderBase.stories.js#HeaderWNavigationActionsAndSideNav',
        'shell-headerwnavigationactionsandsidenav',
      ],
    ];
    for (const [name, sourceId, descriptor] of expected) {
      expect(
        componentEntries.find((entry) => entry.name === name)?.specimens,
      ).toContainEqual(
        expect.objectContaining({
          descriptor,
          fixture: 'source',
          source: 'story',
          sourceId,
        }),
      );
    }
  });
});
