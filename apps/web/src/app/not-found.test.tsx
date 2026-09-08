import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import NotFound from './not-found';

afterEach(() => {
  cleanup();
});

describe('NotFound', () => {
  it('renders a focusable main landmark with a heading and a link home', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Go to the start page' }),
    ).toHaveAttribute('href', '/');
  });
});
