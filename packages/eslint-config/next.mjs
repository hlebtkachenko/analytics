import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import turbo from 'eslint-plugin-turbo';

export default [
  ...nextVitals,
  ...nextTypescript,
  {
    plugins: { turbo },
    rules: {
      'turbo/no-undeclared-env-vars': [
        'error',
        { allowList: ['^HOSTNAME$', '^NODE_ENV$', '^PORT$'] },
      ],
    },
  },
  prettier,
];
