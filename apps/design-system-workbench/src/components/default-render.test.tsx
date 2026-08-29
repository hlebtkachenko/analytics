import { FeatureFlags } from '@bap/design-system/react';
import { DesignSystemProvider } from '@bap/design-system/theme';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  componentEntries,
  componentStory,
  renderCarbonComponent,
} from './component-registry.js';
import { generatedComponentCoverage } from './component-coverage.generated.js';
import { sourceCompositionContract } from './source-composition-contracts.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  disconnect() {}

  observe() {}

  unobserve() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  writable: true,
});
window.matchMedia ??= () => ({
  addEventListener() {},
  addListener() {},
  dispatchEvent: () => false,
  matches: false,
  media: '',
  onchange: null,
  removeEventListener() {},
  removeListener() {},
});
HTMLDialogElement.prototype.close ??= () => undefined;
HTMLDialogElement.prototype.show ??= () => undefined;
HTMLDialogElement.prototype.showModal ??= () => undefined;
HTMLElement.prototype.scrollIntoView ??= () => undefined;
HTMLCanvasElement.prototype.getContext = () => null;

function isJsdomSearchHostWarning(
  name: string,
  literal: Readonly<{ propertyName: string; value: unknown }>,
  calls: readonly unknown[][],
) {
  return (
    ['AspectRatio', 'preview__Card.CardMedia'].includes(name) &&
    literal.propertyName === 'as' &&
    literal.value === 'search' &&
    calls.length === 1 &&
    calls[0]?.[0] ===
      'The tag <%s> is unrecognized in this browser. If you meant to render a React component, start its name with an uppercase letter.' &&
    calls[0]?.[1] === 'search'
  );
}

function isUpstreamPaginationDeprecationWarning(
  name: string,
  calls: readonly unknown[][],
) {
  return (
    ['preview_Pagination', 'unstable_Pagination'].includes(name) &&
    calls.length === 1 &&
    calls[0]?.[0] ===
      '[Carbon] `unstable_Pagination` / `preview_Pagination` is deprecated and will be removed in v12. Use the stable `Pagination` component with the `renderPageSelect` prop instead.'
  );
}

function isUpstreamTagFilterDeprecationWarning(
  name: string,
  literal: Readonly<{ propertyName: string; value: unknown }>,
  calls: readonly unknown[][],
) {
  return (
    name === 'Tag' &&
    literal.propertyName === 'filter' &&
    literal.value === true &&
    calls.length === 1 &&
    calls[0]?.[0] ===
      'The `filter` prop for Tag has been deprecated and will be removed in the next major version. Use DismissibleTag instead.'
  );
}

function isIntentionallyCollapsedLiteral(
  literal: Readonly<{ propertyName: string; value: unknown }>,
) {
  return (
    literal.value === false &&
    ['expanded', 'isExpanded', 'open'].includes(literal.propertyName)
  );
}

function isRenderlessProvider(name: string) {
  return name.endsWith('FeatureFlags') || name === 'GlobalTheme';
}

afterEach(() => vi.restoreAllMocks());

describe('generated Default component stories', () => {
  it('mounts and unmounts every installed renderable export without React errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    for (const entry of componentEntries) {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            <DesignSystemProvider theme="white">
              <FeatureFlags>{renderCarbonComponent(entry.name)}</FeatureFlags>
            </DesignSystemProvider>,
          );
        });
        await act(async () => root.unmount());
        if (consoleError.mock.calls.length) {
          throw new Error(
            `${entry.name}: React error ${JSON.stringify(consoleError.mock.calls[0])}`,
          );
        }
      } catch (error) {
        throw new Error(
          `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      container.remove();
      consoleError.mockClear();
    }
  });

  it('mounts every executable declared literal without React errors', async () => {
    const entriesByName = new Map(
      componentEntries.map((entry) => [entry.name, entry]),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    for (const [name, literals] of Object.entries(
      generatedComponentCoverage.literalCoverageByName,
    )) {
      if (!entriesByName.has(name)) continue;
      for (const literal of literals) {
        if (literal.executionStatus === 'excluded') continue;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
          await act(async () => {
            root.render(
              <DesignSystemProvider theme="white">
                <FeatureFlags>
                  {renderCarbonComponent(name, literal.args)}
                </FeatureFlags>
              </DesignSystemProvider>,
            );
          });
          const roots = [
            ...container.children,
            ...[...document.body.children].filter(
              (element) => element !== container,
            ),
          ];
          const visibleRoot = roots.some(
            (element) =>
              !element.hasAttribute('hidden') &&
              element.getAttribute('aria-hidden') !== 'true',
          );
          if (
            !visibleRoot &&
            !isIntentionallyCollapsedLiteral(literal) &&
            !isRenderlessProvider(name)
          ) {
            throw new Error(
              'Covered literal has no visible or accessible specimen root.',
            );
          }
          await act(async () => root.unmount());
          const hasReactError =
            consoleError.mock.calls.length &&
            !isJsdomSearchHostWarning(name, literal, consoleError.mock.calls);
          const hasWarning =
            consoleWarn.mock.calls.length &&
            !isUpstreamPaginationDeprecationWarning(
              name,
              consoleWarn.mock.calls,
            ) &&
            !isUpstreamTagFilterDeprecationWarning(
              name,
              literal,
              consoleWarn.mock.calls,
            );
          if (hasReactError || hasWarning) {
            throw new Error(
              `React console output ${JSON.stringify(
                consoleError.mock.calls[0] ?? consoleWarn.mock.calls[0],
              )}`,
            );
          }
        } catch (error) {
          throw new Error(
            `${name}.${literal.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        container.remove();
        consoleError.mockClear();
        consoleWarn.mockClear();
      }
    }
  }, 15_000);

  it('selects a literal specimen from its story hash target', async () => {
    const previousHash = window.location.hash;
    window.location.hash = '#api-kind-1';
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = componentStory('Button').Variants.render;
    if (!render) throw new Error('Button Variants needs a render function.');
    try {
      await act(async () => {
        root.render(
          <DesignSystemProvider theme="white">
            <FeatureFlags>{render({}, {} as never)}</FeatureFlags>
          </DesignSystemProvider>,
        );
      });
      expect(container.querySelector('#api-kind-1')).not.toBeNull();
      expect(
        container.querySelector('option[value="api-kind-1"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      window.location.hash = previousHash;
    }
  });

  it('mounts every executable source-story specimen at its deep link', async () => {
    const previousHash = window.location.hash;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    for (const entry of componentEntries) {
      for (const specimen of entry.specimens.filter(
        (candidate) => candidate.source === 'story',
      )) {
        window.location.hash = `#${specimen.id}`;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const render = componentStory(entry.name).Variants.render;
        if (!render) throw new Error(`${entry.name}: missing Variants render.`);
        try {
          await act(async () => {
            root.render(
              <DesignSystemProvider theme="white">
                <FeatureFlags>{render({}, {} as never)}</FeatureFlags>
              </DesignSystemProvider>,
            );
          });
          expect(container.querySelector(`#${specimen.id}`)).not.toBeNull();
          if (specimen.fixture === 'source') {
            const sourceElement = [
              ...container.querySelectorAll('[data-source-specimen]'),
            ].find(
              (element) =>
                element.getAttribute('data-source-specimen') ===
                specimen.sourceId,
            );
            expect(sourceElement).toBeDefined();
            expect(sourceElement?.getAttribute('data-source-composition')).toBe(
              specimen.descriptor,
            );
            const contract = sourceCompositionContract(
              specimen.sourceId!,
              specimen.descriptor!,
            );
            const sourceQuery = (selector: string) => [
              ...(sourceElement?.querySelectorAll(selector) ?? []),
              ...document.body.querySelectorAll(selector),
            ];
            for (const fingerprint of contract.fingerprints) {
              const matches = sourceQuery(fingerprint.selector);
              expect(matches.length).toBeGreaterThanOrEqual(
                fingerprint.minimum ?? 1,
              );
              if (fingerprint.text) {
                expect(
                  `${sourceElement?.textContent ?? ''}${document.body.textContent ?? ''}`,
                ).toContain(fingerprint.text);
              }
            }
            if (specimen.descriptor?.startsWith('grid-')) {
              expect(container.textContent).toMatch(
                /span|offset|gutter|settings|column/i,
              );
            }
            if (specimen.descriptor?.startsWith('tabs-')) {
              expect(
                container.querySelector('[role="tablist"]'),
              ).not.toBeNull();
              expect(
                container.querySelector('[role="tabpanel"]'),
              ).not.toBeNull();
            }
            if (specimen.descriptor?.startsWith('card-')) {
              expect(container.textContent).toContain('Card title');
              expect(container.textContent).toMatch(
                /Card content|Minimal card content/,
              );
            }
            if (specimen.descriptor?.startsWith('data-table-')) {
              expect(container.querySelector('table')).not.toBeNull();
            }
            if (specimen.descriptor?.startsWith('slider-')) {
              expect(container.querySelector('input')).not.toBeNull();
            }
            if (
              specimen.descriptor?.startsWith('modal-') &&
              entry.name === 'ComposedModal'
            ) {
              expect(container.textContent).toContain(
                specimen.sourceId?.endsWith('#WithInlineLoading')
                  ? 'Loading source content'
                  : 'Modal content',
              );
              if (!specimen.sourceId?.endsWith('#PassiveModal')) {
                expect(container.textContent).toContain('Confirm');
              }
            }
          }
          if (specimen.fixture === 'layer') {
            expect(
              container.querySelector('[data-layered-specimen]'),
            ).not.toBeNull();
          }
          await act(async () => root.unmount());
          if (consoleError.mock.calls.length || consoleWarn.mock.calls.length) {
            throw new Error(
              `React console output ${JSON.stringify(
                consoleError.mock.calls[0] ?? consoleWarn.mock.calls[0],
              )}`,
            );
          }
        } catch (error) {
          throw new Error(
            `${entry.name}.${specimen.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        container.remove();
        consoleError.mockClear();
        consoleWarn.mockClear();
      }
    }
    window.location.hash = previousHash;
  }, 15_000);
});
