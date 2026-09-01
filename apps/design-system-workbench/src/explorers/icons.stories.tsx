import * as icons from '@bap/design-system/icons';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { VirtualIconCatalog } from './virtual-catalog.js';
import '../shared/workbench.scss';

const meta = {
  component: VirtualIconCatalog,
  title: 'Explorers/Icons',
} satisfies Meta<typeof VirtualIconCatalog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllCarbonIcons: Story = {
  args: { iconSize: 24, items: icons, label: 'BAP application icons' },
  argTypes: {
    iconSize: { control: 'select', options: [16, 20, 24, 32] },
    items: { table: { disable: true } },
    label: { table: { disable: true } },
  },
  parameters: {
    docs: {
      description: {
        story:
          'The product facade exposes only the reviewed Carbon icons used by BAP application pages. The generated catalog retains the complete installed upstream inventory.',
      },
    },
  },
  name: 'Curated BAP Icons',
};

export const IconSize32: Story = {
  args: { iconSize: 32, items: icons, label: 'BAP application icons' },
};
