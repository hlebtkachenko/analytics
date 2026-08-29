import preview from './preview.js';

const a11y = preview.parameters?.a11y as
  Readonly<{ test?: unknown }> | undefined;

if (a11y?.test !== 'error') {
  throw new Error('Storybook accessibility tests must fail on violations.');
}
