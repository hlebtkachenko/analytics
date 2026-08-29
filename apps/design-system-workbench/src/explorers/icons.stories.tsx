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
  args: { iconSize: 24, items: icons, label: 'Carbon icons' },
  argTypes: {
    iconSize: { control: 'select', options: [16, 20, 24, 32] },
    items: { table: { disable: true } },
    label: { table: { disable: true } },
  },
  parameters: {
    docs: {
      description: {
        story:
          'The installed package exposes 2,763 runtime keys: 2,762 renderable icons plus its Icon helper.',
      },
    },
  },
};

export const IconSize32: Story = {
  args: { iconSize: 32, items: icons, label: 'Carbon icons' },
};
