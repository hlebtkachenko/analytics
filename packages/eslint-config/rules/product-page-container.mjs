// Requires every product page to render its content inside the shared
// PageContainer scaffold, so pages never hand-roll their own layout.
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require product pages to render inside the shared PageContainer.',
    },
    schema: [],
    messages: {
      missing:
        'Product pages must render their content inside <PageContainer> imported from the page-container component.',
    },
  },
  create(context) {
    let importedName;
    let used = false;

    return {
      ImportDeclaration(node) {
        if (
          typeof node.source.value === 'string' &&
          node.source.value.endsWith('/page-container')
        ) {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportDefaultSpecifier') {
              importedName = specifier.local.name;
            }
          }
        }
      },
      JSXOpeningElement(node) {
        if (
          importedName &&
          node.name.type === 'JSXIdentifier' &&
          node.name.name === importedName
        ) {
          used = true;
        }
      },
      'Program:exit'(node) {
        if (!used) {
          context.report({ node, messageId: 'missing' });
        }
      },
    };
  },
};

export default rule;
