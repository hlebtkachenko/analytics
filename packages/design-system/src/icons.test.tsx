import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import * as icons from './icons.js';

const expectedNames = [
  'AiGenerate',
  'ArrowLeft',
  'ArrowRight',
  'Checkmark',
  'Close',
  'DataSet',
  'Download',
  'Email',
  'Launch',
  'Login',
  'Logout',
  'Password',
  'Security',
  'Send',
  'Upload',
  'UserFollow',
  'UserMultiple',
  'View',
] as const;

afterEach(cleanup);

describe('application icon facade', () => {
  it('exports only the reviewed application icons', () => {
    expect(Object.keys(icons).sort()).toEqual(expectedNames);
  });

  it.each([16, 20, 24, 32] as const)(
    'renders the supported %ipx artboard without making the SVG focusable',
    (size) => {
      const { container } = render(createElement(icons.Download, { size }));
      const icon = container.querySelector('svg');

      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('height', String(size));
      expect(icon).toHaveAttribute('width', String(size));
      expect(icon).not.toHaveAttribute('aria-label');
      expect(icon).not.toHaveAttribute('tabindex');
    },
  );
});
