import {
  AILabel,
  AILabelActions,
  AILabelContent,
  AISkeletonIcon,
  AISkeletonPlaceholder,
  AISkeletonText,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  DatePickerInput,
  Dropdown,
  Form,
  FormGroup,
  Modal,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Theme,
  Tile,
} from '@bap/design-system/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';

export const carbonForAiFamilies = [
  'checkbox',
  'form',
  'select',
  'data-table',
  'modal',
  'tag',
  'date-picker',
  'number-input',
  'text-input',
  'dropdown',
  'radio-button',
  'tile',
] as const;

const options = [
  { id: 'option-one', text: 'Option one' },
  { id: 'option-two', text: 'Option two' },
];
const tableHeaders = [
  { header: 'Item', key: 'item' },
  { header: 'State', key: 'state' },
];
const tableRows = [{ id: 'row-one', item: 'Item one', state: 'Neutral' }];

type AiTheme = 'white' | 'g10' | 'g90' | 'g100';

function AiLabelFixture() {
  return (
    <AILabel aria-label="AI information" aiText="AI" kind="inline">
      <AILabelContent>
        <p>
          AI-provided context is identified without claiming a model result.
        </p>
        <AILabelActions>
          <Button kind="ghost" size="sm">
            View context
          </Button>
        </AILabelActions>
      </AILabelContent>
    </AILabel>
  );
}

function AiDecorator() {
  return <AiLabelFixture />;
}

function Family({
  children,
  id,
  title,
}: Readonly<{
  children: ReactNode;
  id: (typeof carbonForAiFamilies)[number];
  title: string;
}>) {
  return (
    <section data-ai-family={id} id={id}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AiDataTable({ aiEnabled }: Readonly<{ aiEnabled: boolean }>) {
  return (
    <DataTable headers={tableHeaders} rows={tableRows}>
      {({ getHeaderProps, getRowProps, getTableProps, headers, rows }) => (
        <TableContainer
          {...(aiEnabled
            ? { aiEnabled: true, decorator: <AiDecorator /> }
            : {})}
          title={aiEnabled ? 'AI presence table' : 'Standard table'}
        >
          <Table
            aria-label={aiEnabled ? 'AI presence table' : 'Standard table'}
            {...getTableProps()}
          >
            <TableHead>
              <TableRow>
                {headers.map((header) => {
                  const { isSortable, ...headerProps } = getHeaderProps({
                    header,
                  });
                  return (
                    <TableHeader
                      {...headerProps}
                      {...(isSortable === undefined ? {} : { isSortable })}
                      key={header.key}
                    >
                      {header.header}
                    </TableHeader>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow {...getRowProps({ row })} key={row.id}>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.id}>{cell.value}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  );
}

function AiModalSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open AI presence modal</Button>
      {open ? (
        <Modal
          decorator={<AiDecorator />}
          modalHeading="AI presence modal"
          modalLabel="AI presence"
          onRequestClose={() => setOpen(false)}
          open
          passiveModal
        >
          This neutral modal demonstrates the supported AI label decorator.
        </Modal>
      ) : null}
    </>
  );
}

function StandardAndAi() {
  return (
    <Stack gap={7}>
      <Family id="checkbox" title="Checkbox">
        <Stack gap={3}>
          <Checkbox id="ai-standard-checkbox" labelText="Standard checkbox" />
          <Checkbox
            decorator={<AiDecorator />}
            id="ai-checkbox"
            labelText="AI presence checkbox"
          />
        </Stack>
      </Family>
      <Family id="form" title="Form">
        <Stack gap={5}>
          <Form aria-label="Standard form">
            <FormGroup legendText="Standard form group">
              <TextInput id="ai-standard-form-text" labelText="Standard text" />
            </FormGroup>
          </Form>
          <Form aria-label="AI presence form">
            <FormGroup legendText="AI presence form group">
              <TextInput
                decorator={<AiDecorator />}
                id="ai-form-text"
                labelText="AI presence text"
              />
            </FormGroup>
          </Form>
        </Stack>
      </Family>
      <Family id="select" title="Select">
        <Stack gap={3}>
          <Select id="ai-standard-select" labelText="Standard selection">
            <SelectItem text="Choose an option" value="" />
            <SelectItem text="Option one" value="one" />
          </Select>
          <Select
            decorator={<AiDecorator />}
            id="ai-select"
            labelText="AI presence selection"
          >
            <SelectItem text="Choose an option" value="" />
            <SelectItem text="Option one" value="one" />
          </Select>
        </Stack>
      </Family>
      <Family id="data-table" title="DataTable">
        <Stack gap={5}>
          <AiDataTable aiEnabled={false} />
          <AiDataTable aiEnabled />
        </Stack>
      </Family>
      <Family id="modal" title="Modal">
        <AiModalSpecimen />
      </Family>
      <Family id="tag" title="Tag">
        <Stack gap={3} orientation="horizontal">
          <Tag type="blue">Standard tag</Tag>
          <Tag decorator={<AiDecorator />} type="blue">
            AI presence tag
          </Tag>
        </Stack>
      </Family>
      <Family id="date-picker" title="DatePicker">
        <Stack gap={3}>
          <DatePicker datePickerType="single">
            <DatePickerInput
              id="ai-standard-date"
              labelText="Standard date"
              placeholder="mm/dd/yyyy"
            />
          </DatePicker>
          <DatePicker datePickerType="single">
            <DatePickerInput
              decorator={<AiDecorator />}
              id="ai-date"
              labelText="AI presence date"
              placeholder="mm/dd/yyyy"
            />
          </DatePicker>
        </Stack>
      </Family>
      <Family id="number-input" title="NumberInput">
        <Stack gap={3}>
          <NumberInput
            id="ai-standard-number"
            label="Standard number"
            value={1}
          />
          <NumberInput
            decorator={<AiDecorator />}
            id="ai-number"
            label="AI presence number"
            value={1}
          />
        </Stack>
      </Family>
      <Family id="text-input" title="TextInput">
        <Stack gap={3}>
          <TextInput id="ai-standard-text" labelText="Standard text" />
          <TextInput
            decorator={<AiDecorator />}
            id="ai-text"
            labelText="AI presence text"
          />
        </Stack>
      </Family>
      <Family id="dropdown" title="Dropdown">
        <Stack gap={3}>
          <Dropdown
            id="ai-standard-dropdown"
            itemToString={(item: (typeof options)[number] | null) =>
              item?.text ?? ''
            }
            items={options}
            label="Standard dropdown"
            titleText="Standard dropdown"
          />
          <Dropdown
            decorator={<AiDecorator />}
            id="ai-dropdown"
            itemToString={(item: (typeof options)[number] | null) =>
              item?.text ?? ''
            }
            items={options}
            label="AI presence dropdown"
            titleText="AI presence dropdown"
          />
        </Stack>
      </Family>
      <Family id="radio-button" title="RadioButton">
        <Stack gap={5}>
          <RadioButtonGroup
            legendText="Standard radio options"
            name="ai-standard-radio"
          >
            <RadioButton
              id="ai-standard-radio-one"
              labelText="Option one"
              value="one"
            />
          </RadioButtonGroup>
          <RadioButtonGroup
            legendText="AI presence radio options"
            name="ai-radio"
          >
            <RadioButton
              decorator={<AiDecorator />}
              id="ai-radio-one"
              labelText="Option one"
              value="one"
            />
          </RadioButtonGroup>
        </Stack>
      </Family>
      <Family id="tile" title="Tile">
        <Stack gap={3}>
          <Tile>Standard tile.</Tile>
          <Tile decorator={<AiDecorator />} hasRoundedCorners>
            AI presence tile.
          </Tile>
        </Stack>
      </Family>
      <Stack gap={3} orientation="horizontal">
        <AISkeletonText />
        <AISkeletonPlaceholder />
        <AISkeletonIcon />
      </Stack>
    </Stack>
  );
}

export function CarbonForAi({ theme }: Readonly<{ theme: AiTheme }>) {
  return (
    <Theme theme={theme}>
      <Stack data-ai-theme={theme} gap={7}>
        <h2>Carbon for AI, {theme}</h2>
        <p>
          Paired standard and AI-presence specimens use supported APIs. Modal
          opens a single AI-presence dialog on demand.
        </p>
        <StandardAndAi />
      </Stack>
    </Theme>
  );
}

const meta = {
  component: CarbonForAi,
  parameters: {
    docs: {
      description: {
        component:
          'Neutral Carbon AI-presence comparisons for the documented core families and themes.',
      },
    },
  },
  tags: ['autodocs'],
  title: 'Patterns/Carbon for AI',
} satisfies Meta<typeof CarbonForAi>;

export default meta;
type Story = StoryObj<typeof meta>;

export const White: Story = { args: { theme: 'white' } };
export const G10: Story = { args: { theme: 'g10' } };
export const G90: Story = { args: { theme: 'g90' } };
export const G100: Story = { args: { theme: 'g100' } };
