import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('shows the platform foundation status', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: 'Business Analytics Platform' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Foundation status' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A service health endpoint is available.'),
    ).toBeInTheDocument();
  });
});
