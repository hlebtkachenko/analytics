import globals from 'globals';

import base from './base.mjs';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
];
