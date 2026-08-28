import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChartFrame } from './chart-frame.js';

describe('ChartFrame', () => {
  it('renders an equivalent accessible table', () => {
    render(
      <ChartFrame
        table={{
          columns: [{ key: 'value', label: 'Value' }],
          label: 'Reference values',
          rows: [{ id: 'row-1', values: { value: 'Available' } }],
        }}
        title="Reference chart"
      >
        <div aria-label="Reference chart graphic" role="img" />
      </ChartFrame>,
    );

    expect(
      screen.getByRole('table', { name: 'Reference values' }),
    ).toBeVisible();
    expect(screen.getByText('Available')).toBeVisible();
  });
});
