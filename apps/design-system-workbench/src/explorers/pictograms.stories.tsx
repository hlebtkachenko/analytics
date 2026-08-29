import * as pictograms from '@bap/design-system/pictograms';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { VirtualIconCatalog } from './virtual-catalog.js';
import '../shared/workbench.scss';

const meta = {
  component: VirtualIconCatalog,
  title: 'Explorers/Pictograms',
} satisfies Meta<typeof VirtualIconCatalog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllCarbonPictograms: Story = {
  args: { items: pictograms, label: 'Carbon pictograms' },
  parameters: {
    docs: {
      description: {
        story:
          'Search every pictogram exported by the installed Carbon package.',
      },
    },
  },
};
