import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import turbo from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.next/**', 'coverage/**', 'dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: { turbo },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      'turbo/no-undeclared-env-vars': [
        'error',
        { allowList: ['^HOST$', '^NODE_ENV$', '^PORT$'] },
      ],
    },
  },
  prettier,
);
