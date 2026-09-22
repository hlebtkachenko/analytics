import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './status-indicator.js';

describe('StatusIndicator', () => {
  it('renders a success indicator with a decorative icon', () => {
    const { container } = render(
      <StatusIndicator label="Active" severity="success" />,
    );

    expect(screen.getByText('Active')).toBeTruthy();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders an error indicator with a decorative icon', () => {
    const { container } = render(
      <StatusIndicator label="Failed" severity="error" />,
    );

    expect(screen.getByText('Failed')).toBeTruthy();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
