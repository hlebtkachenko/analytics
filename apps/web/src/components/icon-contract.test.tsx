import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const iconFacade = '@bap/design-system/icons';
const throwawayMarker =
  '// Throwaway milestone 2 UI: delete when the Carbon organization screens land.';

const reviewedImports = {
  'app/(identity)/forgot-password/page.tsx': ['Email'],
  'app/(identity)/reset-password/reset-password-form.tsx': ['Password'],
  'app/(identity)/sign-in/page.tsx': ['Login'],
  'app/(identity)/sign-in/two-factor/page.tsx': ['Checkmark'],
  'app/(identity)/sign-up/sign-up-form.tsx': ['UserFollow'],
  'app/access/page.tsx': [
    'AiGenerate',
    'DataSet',
    'Logout',
    'Security',
    'Upload',
    'UserMultiple',
  ],
  'app/datasets/page.tsx': ['Upload', 'View'],
  'app/invitation/[invitationId]/page.tsx': ['Checkmark'],
  'components/datasets/dataset-chat.tsx': ['Send'],
  'components/datasets/dataset-export.tsx': ['Download'],
  'components/datasets/dataset-view.tsx': ['ArrowLeft', 'ArrowRight', 'Close'],
  'components/design-system-reference.tsx': ['Launch'],
} as const;

const reviewedCallsites = [
  [
    'app/(identity)/forgot-password/page.tsx',
    'Button',
    'Email',
    "{t('forgotPassword.submit')}",
  ],
  [
    'app/(identity)/reset-password/reset-password-form.tsx',
    'Button',
    'Password',
    "{t('resetPassword.submit')}",
  ],
  ['app/(identity)/sign-in/page.tsx', 'Button', 'Login', "{t('auth.signIn')}"],
  [
    'app/(identity)/sign-in/two-factor/page.tsx',
    'Button',
    'Checkmark',
    "{t('twoFactor.verify')}",
  ],
  [
    'app/(identity)/sign-up/sign-up-form.tsx',
    'Button',
    'UserFollow',
    "{t('signUp.submit')}",
  ],
  ['app/access/page.tsx', 'Button', 'Logout', "{t('common.signOut')}"],
  ['app/access/page.tsx', 'Button', 'DataSet', "{t('access.datasets')}"],
  [
    'app/access/page.tsx',
    'Button',
    'UserMultiple',
    "{t('access.manageMembers')}",
  ],
  ['app/access/page.tsx', 'Button', 'Security', "{t('access.manageGrants')}"],
  ['app/access/page.tsx', 'Button', 'Upload', "{t('access.uploadData')}"],
  ['app/access/page.tsx', 'Button', 'AiGenerate', "{t('access.useAi')}"],
  ['app/datasets/page.tsx', 'Button', 'View', "{t('datasets.open')}"],
  ['app/datasets/page.tsx', 'Button', 'Upload', "{t('datasets.uploadSubmit')}"],
  [
    'app/invitation/[invitationId]/page.tsx',
    'Button',
    'Checkmark',
    "{t('invitation.accept')}",
  ],
  [
    'components/datasets/dataset-chat.tsx',
    'Button',
    'Send',
    "{t('datasets.chatSend')}",
  ],
  [
    'components/datasets/dataset-export.tsx',
    'Button',
    'Download',
    "{t('datasets.exportCsv')}",
  ],
  [
    'components/datasets/dataset-export.tsx',
    'Button',
    'Download',
    "{t('datasets.exportXlsx')}",
  ],
  [
    'components/datasets/dataset-view.tsx',
    'Button',
    'Close',
    "{t('datasets.close')}",
  ],
  [
    'components/datasets/dataset-view.tsx',
    'Button',
    'ArrowLeft',
    "{t('datasets.previousPage')}",
  ],
  [
    'components/datasets/dataset-view.tsx',
    'Button',
    'ArrowRight',
    "{t('datasets.nextPage')}",
  ],
  [
    'components/design-system-reference.tsx',
    'Button',
    'Launch',
    'Open Carbon React documentation',
  ],
] as const;

const throwawayPages = [
  'app/(throwaway)/organizations/page.tsx',
  'app/(throwaway)/organizations/new/page.tsx',
  'app/[orgSlug]/page.tsx',
  'app/[orgSlug]/members/page.tsx',
  'app/[orgSlug]/settings/page.tsx',
] as const;

const intentionalPlainAccountSources = [
  'app/account/account-actions.tsx',
  'app/account/page.tsx',
] as const;

type IconImport = Readonly<{
  imported: string;
  local: string;
  module: string;
}>;

type IconCallsite = Readonly<{
  element: string;
  file: string;
  icon: string;
  iconOnlyProperties: readonly string[];
  label: string;
  selfClosing: boolean;
}>;

type ParsedSource = Readonly<{
  callsites: readonly IconCallsite[];
  file: string;
  imports: readonly IconImport[];
  importModules: readonly string[];
  sourceFile: ts.SourceFile;
}>;

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return productionTsxFiles(candidate);
    }

    if (
      !entry.isFile() ||
      !entry.name.endsWith('.tsx') ||
      entry.name.includes('.test.')
    ) {
      return [];
    }

    return [candidate];
  });
}

function normalizedJsxLabel(
  children: ts.NodeArray<ts.JsxChild>,
  sourceFile: ts.SourceFile,
): string {
  return children
    .flatMap((child): string[] => {
      if (ts.isJsxText(child)) {
        const text = child.getText(sourceFile).replaceAll(/\s+/g, ' ').trim();
        return text.length > 0 ? [text] : [];
      }

      if (ts.isJsxExpression(child) && child.expression) {
        return [`{${child.expression.getText(sourceFile)}}`];
      }

      if (ts.isJsxElement(child)) {
        const label = normalizedJsxLabel(child.children, sourceFile);
        return label.length > 0 ? [label] : [];
      }

      if (ts.isJsxFragment(child)) {
        const label = normalizedJsxLabel(child.children, sourceFile);
        return label.length > 0 ? [label] : [];
      }

      return [];
    })
    .join(' ');
}

function attributeName(attribute: ts.JsxAttributeLike): string | undefined {
  return ts.isJsxAttribute(attribute) ? attribute.name.getText() : undefined;
}

function parseSource(file: string): ParsedSource {
  const sourceText = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const relativeFile = path.relative(sourceRoot, file);
  const imports: IconImport[] = [];
  const importModules: string[] = [];
  const callsites: IconCallsite[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    importModules.push(moduleSpecifier);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      imports.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
        module: moduleSpecifier,
      });
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const renderIcon = opening.attributes.properties.find(
        (attribute) => attributeName(attribute) === 'renderIcon',
      );

      if (renderIcon && ts.isJsxAttribute(renderIcon)) {
        const initializer = renderIcon.initializer;
        const expression =
          initializer && ts.isJsxExpression(initializer)
            ? initializer.expression
            : undefined;
        const iconOnlyProperties = opening.attributes.properties
          .map(attributeName)
          .filter(
            (name): name is string =>
              name !== undefined && name.toLowerCase().includes('icononly'),
          );
        callsites.push({
          element: opening.tagName.getText(sourceFile),
          file: relativeFile,
          icon: expression?.getText(sourceFile) ?? '',
          iconOnlyProperties,
          label: ts.isJsxElement(node)
            ? normalizedJsxLabel(node.children, sourceFile)
            : '',
          selfClosing: ts.isJsxSelfClosingElement(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { callsites, file: relativeFile, imports, importModules, sourceFile };
}

function leadingComments(sourceFile: ts.SourceFile): string[] {
  return (ts.getLeadingCommentRanges(sourceFile.text, 0) ?? []).map((range) =>
    sourceFile.text.slice(range.pos, range.end),
  );
}

function publicCallsite(callsite: IconCallsite) {
  return [callsite.file, callsite.element, callsite.icon, callsite.label];
}

const parsedSources = productionTsxFiles(sourceRoot).map(parseSource);

describe('Carbon application icon AST contract', () => {
  it('allows reviewed named icon imports only through the BAP facade', () => {
    const actualImports = Object.fromEntries(
      parsedSources
        .map(
          (source) =>
            [
              source.file,
              source.imports
                .filter((binding) => binding.module === iconFacade)
                .map((binding) => binding.imported)
                .sort(),
            ] as const,
        )
        .filter(([, names]) => names.length > 0),
    );

    expect(actualImports).toEqual(
      Object.fromEntries(
        Object.entries(reviewedImports).map(([file, names]) => [
          file,
          [...names].sort(),
        ]),
      ),
    );

    for (const source of parsedSources) {
      expect(
        source.importModules.filter((module) =>
          module.startsWith('@carbon/icons-react'),
        ),
        source.file,
      ).toEqual([]);
      for (const binding of source.imports.filter(
        (candidate) => candidate.module === iconFacade,
      )) {
        expect(binding.local, `${source.file}: ${binding.imported}`).toBe(
          binding.imported,
        );
      }
    }
  });

  it('pins the exact production JSX callsite and visible-label inventory', () => {
    const actualCallsites = parsedSources.flatMap((source) => source.callsites);

    expect(actualCallsites.map(publicCallsite)).toEqual(reviewedCallsites);
    for (const callsite of actualCallsites) {
      expect(callsite.selfClosing, `${callsite.file}: ${callsite.icon}`).toBe(
        false,
      );
      expect(callsite.label, `${callsite.file}: ${callsite.icon}`).not.toBe('');
      expect(
        callsite.iconOnlyProperties,
        `${callsite.file}: ${callsite.icon}`,
      ).toEqual([]);

      const source = parsedSources.find(
        (candidate) => candidate.file === callsite.file,
      );
      const binding = source?.imports.find(
        (candidate) => candidate.local === callsite.icon,
      );
      expect(binding, `${callsite.file}: ${callsite.icon}`).toEqual({
        imported: callsite.icon,
        local: callsite.icon,
        module: iconFacade,
      });
    }
  });

  it('keeps every Phase 10 route marker and import exclusion exact', () => {
    for (const relativeFile of throwawayPages) {
      const source = parsedSources.find(
        (candidate) => candidate.file === relativeFile,
      );

      expect(source, relativeFile).toBeDefined();
      expect(leadingComments(source!.sourceFile), relativeFile).toContain(
        throwawayMarker,
      );
      expect(
        source!.importModules.filter(
          (module) =>
            module.startsWith('@bap/design-system') ||
            module.startsWith('@carbon/') ||
            module.endsWith('.css') ||
            module.endsWith('.scss'),
        ),
        relativeFile,
      ).toEqual([]);
    }

    const form = parsedSources.find(
      (source) =>
        source.file ===
        'app/(throwaway)/organizations/new/organization-form.tsx',
    );
    expect(form).toBeDefined();
    expect(
      form!.importModules.filter(
        (module) =>
          module.startsWith('@bap/design-system') ||
          module.startsWith('@carbon/') ||
          module.endsWith('.css') ||
          module.endsWith('.scss'),
      ),
    ).toEqual([]);
  });

  it('keeps the temporary account implementation intentionally icon-free', () => {
    for (const relativeFile of intentionalPlainAccountSources) {
      const source = parsedSources.find(
        (candidate) => candidate.file === relativeFile,
      );

      expect(source, relativeFile).toBeDefined();
      expect(
        source!.importModules.filter(
          (module) =>
            module === iconFacade || module.startsWith('@carbon/icons-react'),
        ),
        relativeFile,
      ).toEqual([]);
    }

    const page = parsedSources.find(
      (source) => source.file === 'app/account/page.tsx',
    );
    expect(leadingComments(page!.sourceFile)).toContain(
      '// Temporary account UI: delete when the Carbon account screen lands.',
    );
  });
});
