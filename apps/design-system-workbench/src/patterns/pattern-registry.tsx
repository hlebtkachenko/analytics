import {
  Accordion,
  AccordionItem,
  Button,
  ButtonSet,
  Checkbox,
  ComposedModal,
  Content,
  ExpandableTile,
  Form,
  FormGroup,
  FluidForm,
  FluidSelect,
  FluidTextArea,
  FluidTextInput,
  Header,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  Heading,
  InlineNotification,
  ModalBody,
  ModalFooter,
  ModalHeader,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  SideNav,
  SideNavItems,
  SideNavLink,
  Stack,
  TextArea,
  TextInput,
  Tile,
  Toggle,
} from '@bap/design-system/react';
import type { ReactElement } from 'react';

import {
  componentEntryByName,
  renderCarbonComponent,
} from '../components/component-registry.js';

export type CarbonPattern = Readonly<{
  componentNames: readonly string[];
  documentationOnly: boolean;
  id: string;
  reason: string;
  sourcePath: string;
  title: string;
}>;

export const carbonPatterns: readonly CarbonPattern[] = [
  {
    componentNames: ['ButtonSet', 'Button', 'OverflowMenu'],
    documentationOnly: false,
    id: 'common-actions',
    reason:
      'A neutral action hierarchy can be demonstrated without product workflow rules.',
    sourcePath: 'common-actions/index.mdx',
    title: 'Common actions',
  },
  {
    componentNames: [
      'Modal',
      'ComposedModal',
      'ModalHeader',
      'ModalBody',
      'ModalFooter',
    ],
    documentationOnly: false,
    id: 'dialog-pattern',
    reason:
      'A neutral dialog composition demonstrates the public modal contracts.',
    sourcePath: 'dialog-pattern/index.mdx',
    title: 'Dialogs',
  },
  {
    componentNames: ['Button', 'TextInput', 'Toggle'],
    documentationOnly: false,
    id: 'disabled-states',
    reason:
      'The same controls can demonstrate disabled, invalid, and read-only states.',
    sourcePath: 'disabled-states/index.mdx',
    title: 'Disabled states',
  },
  {
    componentNames: ['Accordion', 'ExpandableTile', 'Toggletip', 'TreeView'],
    documentationOnly: false,
    id: 'disclosures-pattern',
    reason:
      'Carbon disclosure components have locally runnable neutral fixtures.',
    sourcePath: 'disclosures-pattern/index.mdx',
    title: 'Disclosures',
  },
  {
    componentNames: ['ContainedList', 'DataTable', 'InlineNotification'],
    documentationOnly: false,
    id: 'empty-states-pattern',
    reason:
      'Neutral absence messaging can use Carbon containers without invented records.',
    sourcePath: 'empty-states-pattern/index.mdx',
    title: 'Empty states',
  },
  {
    componentNames: ['Search', 'MultiSelect', 'Tag', 'DataTable'],
    documentationOnly: false,
    id: 'filtering',
    reason:
      'The public controls demonstrate clear and reversible filtering mechanics.',
    sourcePath: 'filtering/index.mdx',
    title: 'Filtering',
  },
  {
    componentNames: [
      'FluidForm',
      'FluidTextInput',
      'FluidSelect',
      'FluidTextArea',
    ],
    documentationOnly: false,
    id: 'fluid-styles',
    reason:
      'The installed fluid controls can be compared directly with neutral labels.',
    sourcePath: 'fluid-styles/index.mdx',
    title: 'Fluid styles',
  },
  {
    componentNames: ['Form', 'FormGroup', 'TextInput', 'Select', 'TextArea'],
    documentationOnly: false,
    id: 'forms-pattern',
    reason:
      'A neutral field group demonstrates labels, helper text, and boundary validation.',
    sourcePath: 'forms-pattern/index.mdx',
    title: 'Forms',
  },
  {
    componentNames: [
      'Header',
      'HeaderNavigation',
      'HeaderGlobalAction',
      'SideNav',
      'Content',
    ],
    documentationOnly: false,
    id: 'global-header',
    reason:
      'The UI Shell components provide a neutral navigation mechanics specimen.',
    sourcePath: 'global-header/index.mdx',
    title: 'Global header',
  },
  {
    componentNames: [
      'Loading',
      'InlineLoading',
      'ProgressBar',
      'ProgressIndicator',
      'SkeletonText',
    ],
    documentationOnly: false,
    id: 'loading-pattern',
    reason:
      'The installed progress and skeleton components model distinct work states.',
    sourcePath: 'loading-pattern/index.mdx',
    title: 'Loading',
  },
  {
    componentNames: [],
    documentationOnly: true,
    id: 'login-pattern',
    reason:
      'Authentication, recovery, rate limits, and session rules are product requirements, not a neutral Carbon fixture.',
    sourcePath: 'login-pattern/index.mdx',
    title: 'Login',
  },
  {
    componentNames: [
      'InlineNotification',
      'ToastNotification',
      'ActionableNotification',
    ],
    documentationOnly: false,
    id: 'notification-pattern',
    reason:
      'Carbon notification variants can be shown without application events or user data.',
    sourcePath: 'notification-pattern/index.mdx',
    title: 'Notifications',
  },
  {
    componentNames: ['OverflowMenu', 'Tooltip', 'Toggletip', 'ExpandableTile'],
    documentationOnly: false,
    id: 'overflow-content',
    reason:
      'Carbon overflow and disclosure components have keyboard-accessible neutral fixtures.',
    sourcePath: 'overflow-content/index.mdx',
    title: 'Overflow content',
  },
  {
    componentNames: ['TextInput', 'TextArea', 'Checkbox', 'Toggle'],
    documentationOnly: false,
    id: 'read-only-states-pattern',
    reason:
      'Public form controls expose read-only and disabled states for direct comparison.',
    sourcePath: 'read-only-states-pattern/index.mdx',
    title: 'Read-only states',
  },
  {
    componentNames: [
      'Search',
      'ExpandableSearch',
      'InlineLoading',
      'InlineNotification',
    ],
    documentationOnly: false,
    id: 'search-pattern',
    reason:
      'Search mechanics can be shown locally while relevance remains application-owned.',
    sourcePath: 'search-pattern/index.mdx',
    title: 'Search',
  },
  {
    componentNames: [
      'Tag',
      'OperationalTag',
      'ProgressBar',
      'InlineNotification',
      'preview__IconIndicator',
    ],
    documentationOnly: false,
    id: 'status-indicator-pattern',
    reason:
      'Carbon status components show text and shape together in a neutral specimen.',
    sourcePath: 'status-indicator-pattern/index.mdx',
    title: 'Status indicators',
  },
  {
    componentNames: [],
    documentationOnly: true,
    id: 'text-toolbar-pattern',
    reason:
      'A text toolbar needs editor commands, selection state, and shortcut policy before it can be implemented honestly.',
    sourcePath: 'text-toolbar-pattern/index.mdx',
    title: 'Text toolbar',
  },
  {
    componentNames: ['Grid', 'Row', 'Column', 'Stack', 'AspectRatio'],
    documentationOnly: false,
    id: 'overview',
    reason:
      'The overview uses the installed layout primitives as a neutral composition map.',
    sourcePath: 'overview.mdx',
    title: 'Patterns overview',
  },
];

export const patternById = new Map(
  carbonPatterns.map((pattern) => [pattern.id, pattern]),
);

export const runnableCarbonPatternIds = [
  'common-actions',
  'dialog-pattern',
  'disabled-states',
  'disclosures-pattern',
  'empty-states-pattern',
  'filtering',
  'fluid-styles',
  'forms-pattern',
  'global-header',
  'loading-pattern',
  'notification-pattern',
  'overflow-content',
  'read-only-states-pattern',
  'search-pattern',
  'status-indicator-pattern',
  'overview',
] as const;

function globalHeaderPattern() {
  return (
    <Stack gap={5}>
      <Header aria-label="Global navigation">
        <HeaderName href="#" prefix="BAP">
          BAP
        </HeaderName>
        <HeaderNavigation aria-label="Primary navigation">
          <HeaderMenuItem href="#">Overview</HeaderMenuItem>
        </HeaderNavigation>
      </Header>
      <SideNav aria-label="Side navigation" expanded>
        <SideNavItems>
          <SideNavLink href="#">Overview</SideNavLink>
        </SideNavItems>
      </SideNav>
      <Content id="main-content">
        <p>Neutral application content.</p>
      </Content>
    </Stack>
  );
}

function commonActionsPattern() {
  return (
    <Stack gap={5}>
      <ButtonSet>
        <Button kind="primary">Primary action</Button>
        <Button kind="secondary">Secondary action</Button>
      </ButtonSet>
      <OverflowMenu aria-label="Additional actions">
        <OverflowMenuItem itemText="Additional action" />
      </OverflowMenu>
    </Stack>
  );
}

function dialogPattern() {
  return (
    <Stack gap={5}>
      <ComposedModal aria-label="Neutral dialog" open>
        <ModalHeader label="Neutral dialog" title="Confirm a neutral action" />
        <ModalBody>Neutral dialog content.</ModalBody>
        <ModalFooter primaryButtonText="Confirm" secondaryButtonText="Cancel">
          Dialog actions
        </ModalFooter>
      </ComposedModal>
    </Stack>
  );
}

function disabledStatesPattern() {
  return (
    <Form aria-label="Disabled states">
      <FormGroup legendText="Neutral controls">
        <TextInput disabled id="disabled-text" labelText="Disabled value" />
        <TextInput
          aria-describedby="invalid-text-error-msg"
          id="invalid-text"
          invalid
          invalidText="Validation message"
          labelText="Invalid value"
        />
        <Toggle disabled id="disabled-toggle" labelText="Disabled toggle" />
      </FormGroup>
    </Form>
  );
}

function disclosuresPattern() {
  return (
    <Stack gap={5}>
      <Accordion align="start">
        <AccordionItem title="Disclosure">
          Neutral disclosure content.
        </AccordionItem>
      </Accordion>
      <ExpandableTile
        tileCollapsedIconText="Expand"
        tileExpandedIconText="Collapse"
      >
        Neutral expandable content.
      </ExpandableTile>
      {renderCarbonComponent('Toggletip')}
      {renderCarbonComponent('TreeView')}
    </Stack>
  );
}

function emptyStatesPattern() {
  return (
    <Stack gap={5}>
      <InlineNotification
        kind="info"
        subtitle="No items match the current neutral view."
        title="Nothing to show"
      />
      <ButtonSet>
        <Button kind="secondary">Clear selection</Button>
        <Button kind="tertiary">Learn more</Button>
      </ButtonSet>
    </Stack>
  );
}

function filteringPattern() {
  return (
    <Form aria-label="Filtering controls">
      <FormGroup legendText="Filter">
        {renderCarbonComponent('Search')}
        {renderCarbonComponent('MultiSelect')}
        <Stack orientation="horizontal" gap={3}>
          {renderCarbonComponent('Tag', { filter: true, type: 'blue' })}
          <Button kind="tertiary">Clear filters</Button>
        </Stack>
      </FormGroup>
      {renderCarbonComponent('DataTable')}
    </Form>
  );
}

function fluidStylesPattern() {
  return (
    <FluidForm aria-label="Fluid form">
      <FluidTextInput id="fluid-text" labelText="Text" />
      <FluidSelect id="fluid-select" labelText="Selection">
        <SelectItem text="Choose an option" value="" />
        <SelectItem text="Option one" value="one" />
      </FluidSelect>
      <FluidTextArea id="fluid-area" labelText="Details" />
    </FluidForm>
  );
}

function formsPattern() {
  return (
    <Form aria-label="Neutral form">
      <FormGroup legendText="Neutral fields">
        <TextInput
          helperText="A neutral helper message."
          id="form-text"
          labelText="Text"
        />
        <Select id="form-select" labelText="Selection">
          <SelectItem text="Choose an option" value="" />
          <SelectItem text="Option one" value="one" />
        </Select>
        <TextArea id="form-area" labelText="Details" />
        <Checkbox id="form-check" labelText="Optional choice" />
      </FormGroup>
      <ButtonSet>
        <Button kind="primary" type="submit">
          Submit
        </Button>
        <Button kind="secondary" type="button">
          Cancel
        </Button>
      </ButtonSet>
    </Form>
  );
}

function loadingPattern() {
  return (
    <Stack gap={5}>
      {renderCarbonComponent('InlineLoading')}
      {renderCarbonComponent('ProgressBar')}
      {renderCarbonComponent('ProgressIndicator')}
      {renderCarbonComponent('SkeletonText')}
    </Stack>
  );
}

function notificationPattern() {
  return (
    <Stack gap={5}>
      {renderCarbonComponent('InlineNotification', {
        kind: 'info',
        subtitle: 'Neutral status message',
        title: 'Status',
      })}
      {renderCarbonComponent('ToastNotification', {
        kind: 'success',
        subtitle: 'Neutral status message',
        title: 'Status',
      })}
      {renderCarbonComponent('ActionableNotification', {
        kind: 'warning',
        subtitle: 'Neutral status message',
        title: 'Status',
      })}
    </Stack>
  );
}

function overflowContentPattern() {
  return (
    <Stack gap={5}>
      <OverflowMenu aria-label="Overflow actions">
        <OverflowMenuItem itemText="Neutral action" />
      </OverflowMenu>
      {renderCarbonComponent('Toggletip')}
      <ExpandableTile
        tileCollapsedIconText="Expand"
        tileExpandedIconText="Collapse"
      >
        Additional neutral content.
      </ExpandableTile>
    </Stack>
  );
}

function readOnlyStatesPattern() {
  return (
    <Form aria-label="Read-only controls">
      <FormGroup legendText="Read-only values">
        <TextInput
          id="readonly-text"
          labelText="Text"
          readOnly
          value="Neutral value"
        />
        <TextArea
          id="readonly-area"
          labelText="Details"
          readOnly
          value="Neutral details"
        />
        <Checkbox
          checked
          id="readonly-check"
          labelText="Selected choice"
          readOnly
        />
        <Toggle
          id="readonly-toggle"
          labelText="Enabled toggle"
          readOnly
          toggled
        />
      </FormGroup>
    </Form>
  );
}

function searchPattern() {
  return (
    <Stack gap={5}>
      {renderCarbonComponent('Search')}
      {renderCarbonComponent('ExpandableSearch')}
      {renderCarbonComponent('InlineLoading')}
      <InlineNotification
        kind="info"
        subtitle="Search results are intentionally neutral."
        title="Search state"
      />
    </Stack>
  );
}

function statusIndicatorPattern() {
  return (
    <Stack gap={5}>
      <Stack orientation="horizontal" gap={3}>
        {renderCarbonComponent('Tag', { type: 'green' })}
        {renderCarbonComponent('OperationalTag')}
        {renderCarbonComponent('preview__IconIndicator')}
      </Stack>
      {renderCarbonComponent('ProgressBar')}
      <InlineNotification
        kind="info"
        subtitle="A neutral status explanation."
        title="Status"
      />
    </Stack>
  );
}

function overviewPattern() {
  return (
    <Stack gap={5}>
      {renderCarbonComponent('Grid')}
      {renderCarbonComponent('Row')}
      {renderCarbonComponent('Column')}
      {renderCarbonComponent('AspectRatio')}
    </Stack>
  );
}

function patternContent(id: string): ReactElement {
  switch (id) {
    case 'common-actions':
      return commonActionsPattern();
    case 'dialog-pattern':
      return dialogPattern();
    case 'disabled-states':
      return disabledStatesPattern();
    case 'disclosures-pattern':
      return disclosuresPattern();
    case 'empty-states-pattern':
      return emptyStatesPattern();
    case 'filtering':
      return filteringPattern();
    case 'fluid-styles':
      return fluidStylesPattern();
    case 'forms-pattern':
      return formsPattern();
    case 'global-header':
      return globalHeaderPattern();
    case 'loading-pattern':
      return loadingPattern();
    case 'notification-pattern':
      return notificationPattern();
    case 'overflow-content':
      return overflowContentPattern();
    case 'read-only-states-pattern':
      return readOnlyStatesPattern();
    case 'search-pattern':
      return searchPattern();
    case 'status-indicator-pattern':
      return statusIndicatorPattern();
    case 'overview':
      return overviewPattern();
    default:
      throw new Error(`No runnable composition for Carbon pattern: ${id}`);
  }
}

export function renderCarbonPattern(id: string): ReactElement {
  const pattern = patternById.get(id);
  if (!pattern) throw new Error(`Unknown Carbon pattern: ${id}`);
  if (pattern.documentationOnly) {
    return (
      <Stack gap={5}>
        <Heading>{pattern.title}</Heading>
        <InlineNotification
          kind="info"
          subtitle={pattern.reason}
          title="Documentation only"
        />
      </Stack>
    );
  }
  return (
    <Stack gap={5}>
      <Heading>{pattern.title}</Heading>
      <p>{pattern.reason}</p>
      <Tile>{patternContent(id)}</Tile>
    </Stack>
  );
}

export function verifyPatternRegistry() {
  const expectedPaths = new Set([
    'common-actions/index.mdx',
    'dialog-pattern/index.mdx',
    'disabled-states/index.mdx',
    'disclosures-pattern/index.mdx',
    'empty-states-pattern/index.mdx',
    'filtering/index.mdx',
    'fluid-styles/index.mdx',
    'forms-pattern/index.mdx',
    'global-header/index.mdx',
    'loading-pattern/index.mdx',
    'login-pattern/index.mdx',
    'notification-pattern/index.mdx',
    'overflow-content/index.mdx',
    'overview.mdx',
    'read-only-states-pattern/index.mdx',
    'search-pattern/index.mdx',
    'status-indicator-pattern/index.mdx',
    'text-toolbar-pattern/index.mdx',
  ]);
  const paths = new Set(carbonPatterns.map((pattern) => pattern.sourcePath));
  if (
    paths.size !== expectedPaths.size ||
    [...paths].some((path) => !expectedPaths.has(path))
  ) {
    throw new Error('Carbon pattern source coverage is incomplete.');
  }
  for (const pattern of carbonPatterns) {
    if (!pattern.reason.trim())
      throw new Error(`Pattern ${pattern.id} needs a reason.`);
    if (pattern.documentationOnly || pattern.componentNames.length) continue;
    throw new Error(`Runnable pattern ${pattern.id} needs Carbon components.`);
  }
  const runnableIds = new Set(
    carbonPatterns
      .filter((pattern) => !pattern.documentationOnly)
      .map((pattern) => pattern.id),
  );
  if (
    runnableIds.size !== runnableCarbonPatternIds.length ||
    runnableCarbonPatternIds.some((id) => !runnableIds.has(id))
  ) {
    throw new Error('Carbon runnable pattern compositions are incomplete.');
  }
  for (const componentName of carbonPatterns.flatMap(
    (pattern) => pattern.componentNames,
  )) {
    if (!componentEntryByName.has(componentName)) {
      throw new Error(
        `Pattern references an unregistered component: ${componentName}`,
      );
    }
  }
}

verifyPatternRegistry();
