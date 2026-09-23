import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import turbo from 'eslint-plugin-turbo';

import productPageContainer from './rules/product-page-container.mjs';

const bap = { rules: { 'product-page-container': productPageContainer } };

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
  {
    // Product UI uses the design-system scaffolding, never inline layout styles.
    files: ['src/app/(product)/**/*.tsx', 'src/components/**/*.tsx'],
    ignores: ['src/components/shell/**', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Use design-system tokens and CSS modules, not inline styles, in product UI.',
        },
      ],
    },
  },
  {
    // Every product page renders inside the shared PageContainer scaffold.
    files: [
      'src/app/(product)/**/page.tsx',
      'src/app/(product)/**/not-found.tsx',
    ],
    ignores: [
      'src/app/(product)/[[]orgSlug[]]/**',
      // The access page only redirects to /account/access, so it renders no PageContainer.
      'src/app/(product)/access/**',
      // The inbox settings page only redirects to /inbox/rules, so it renders no PageContainer.
      'src/app/(product)/inbox/settings/**',
    ],
    plugins: { bap },
    rules: {
      'bap/product-page-container': 'error',
    },
  },
  prettier,
];
