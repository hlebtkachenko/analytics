import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import axe from 'axe-core';

// What the axe source exposes on the page once it has been evaluated there.
type AxeWindow = Window &
  typeof globalThis & {
    axe: {
      run: (document: Document) => Promise<{
        violations: ReadonlyArray<{
          id: string;
          impact: string | null;
          nodes: ReadonlyArray<Readonly<{ target: ReadonlyArray<string> }>>;
        }>;
      }>;
    };
  };

// The one accessibility expectation every operational spec shares; the optional label names the state that failed.
export async function expectNoAccessibilityViolations(
  page: Page,
  label?: string,
): Promise<void> {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const results = await (window as AxeWindow).axe.run(document);
    return results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(
    violations,
    label === undefined ? undefined : `${label}: ${JSON.stringify(violations)}`,
  ).toEqual([]);
}
