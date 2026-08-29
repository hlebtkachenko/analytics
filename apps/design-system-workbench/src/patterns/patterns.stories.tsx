import type { Meta, StoryObj } from '@storybook/react-vite';

import { renderCarbonPattern } from './pattern-registry.js';

const meta = {
  parameters: { layout: 'padded' },
  title: 'Patterns/Carbon Core',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: () => renderCarbonPattern('overview'),
};
export const CommonActions: Story = {
  render: () => renderCarbonPattern('common-actions'),
};
export const Dialogs: Story = {
  render: () => renderCarbonPattern('dialog-pattern'),
};
export const DisabledStates: Story = {
  render: () => renderCarbonPattern('disabled-states'),
};
export const Disclosures: Story = {
  render: () => renderCarbonPattern('disclosures-pattern'),
};
export const EmptyStates: Story = {
  render: () => renderCarbonPattern('empty-states-pattern'),
};
export const Filtering: Story = {
  render: () => renderCarbonPattern('filtering'),
};
export const FluidStyles: Story = {
  render: () => renderCarbonPattern('fluid-styles'),
};
export const Forms: Story = {
  render: () => renderCarbonPattern('forms-pattern'),
};
export const GlobalHeader: Story = {
  render: () => renderCarbonPattern('global-header'),
};
export const Loading: Story = {
  render: () => renderCarbonPattern('loading-pattern'),
};
export const Login: Story = {
  render: () => renderCarbonPattern('login-pattern'),
};
export const Notifications: Story = {
  render: () => renderCarbonPattern('notification-pattern'),
};
export const OverflowContent: Story = {
  render: () => renderCarbonPattern('overflow-content'),
};
export const ReadOnlyStates: Story = {
  render: () => renderCarbonPattern('read-only-states-pattern'),
};
export const Search: Story = {
  render: () => renderCarbonPattern('search-pattern'),
};
export const StatusIndicators: Story = {
  render: () => renderCarbonPattern('status-indicator-pattern'),
};
export const TextToolbar: Story = {
  render: () => renderCarbonPattern('text-toolbar-pattern'),
};
