import baseConfig from '@bap/eslint-config/base';

export default [
  ...baseConfig,
  { ignores: ['storybook-static/**'] },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
];
