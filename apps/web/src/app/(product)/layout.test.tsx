import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProductLayout from './layout';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
  requestHeaders: new Headers(),
}));

vi.mock('../../lib/auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock('next/headers', () => ({
  headers: async () => mocks.requestHeaders,
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

vi.mock('../../lib/preferences/server', () => ({
  readRailPinned: async () => true,
}));

vi.mock('../../components/shell/product-shell', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="product-shell">{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.requestHeaders = new Headers();
  vi.clearAllMocks();
});

describe('ProductLayout', () => {
  it('redirects an unauthenticated request to sign in with the encoded return path', async () => {
    mocks.requestHeaders = new Headers({
      'x-bap-path': '/documents/analytics?organization=bap-operational',
    });
    mocks.getSession.mockResolvedValue(null);

    const result = await ProductLayout({ children: <p>Product page</p> });

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/sign-in?next=%2Fdocuments%2Fanalytics%3Forganization%3Dbap-operational',
    );
    expect(result).toBeNull();
  });

  it('redirects without a return path when the proxy header is missing', async () => {
    mocks.getSession.mockResolvedValue(null);

    await ProductLayout({ children: <p>Product page</p> });

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
  });

  it('refuses a return path that leaves this origin', async () => {
    mocks.requestHeaders = new Headers({ 'x-bap-path': '//evil.example' });
    mocks.getSession.mockResolvedValue(null);

    await ProductLayout({ children: <p>Product page</p> });

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
  });

  it('fails closed when the session read fails', async () => {
    mocks.requestHeaders = new Headers({ 'x-bap-path': '/documents' });
    mocks.getSession.mockRejectedValue(new Error('private session detail'));

    const result = await ProductLayout({ children: <p>Product page</p> });

    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in?next=%2Fdocuments');
    expect(result).toBeNull();
  });

  it('renders the page inside the product shell for a session', async () => {
    mocks.requestHeaders = new Headers({ 'x-bap-path': '/documents' });
    mocks.getSession.mockResolvedValue({
      user: { email: 'member@bap.invalid' },
    });

    render(await ProductLayout({ children: <p>Product page</p> }));

    expect(screen.getByTestId('product-shell')).toBeVisible();
    expect(screen.getByText('Product page')).toBeVisible();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
