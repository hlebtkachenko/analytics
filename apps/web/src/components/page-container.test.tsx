import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PageContainer from './page-container.js';

describe('PageContainer', () => {
  it('renders children inside a Carbon grid scaffold', () => {
    const { container } = render(
      <PageContainer>
        <p>Body</p>
      </PageContainer>,
    );

    expect(screen.getByText('Body')).toBeTruthy();
    expect(
      container.querySelector('.cds--css-grid, .cds--grid'),
    ).not.toBeNull();
  });
});
