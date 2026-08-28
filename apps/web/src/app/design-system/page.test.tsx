import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DesignSystemPage from './page';

describe('DesignSystemPage', () => {
  it('renders the Carbon implementation reference', () => {
    render(<DesignSystemPage />);

    expect(
      screen.getByRole('heading', { name: 'Carbon design system' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open Carbon React documentation' }),
    ).toHaveAttribute(
      'href',
      'https://carbondesignsystem.com/developing/frameworks/react/',
    );
  });
});
