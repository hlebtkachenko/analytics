import { describe, expect, it } from 'vitest';

import {
  carbonPatterns,
  renderCarbonPattern,
  runnableCarbonPatternIds,
  verifyPatternRegistry,
} from './pattern-registry.js';

describe('Carbon Core patterns', () => {
  it('maps all 18 pinned Carbon pattern pages exactly once', () => {
    expect(carbonPatterns).toHaveLength(18);
    expect(
      new Set(carbonPatterns.map((pattern) => pattern.sourcePath)).size,
    ).toBe(18);
    expect(() => verifyPatternRegistry()).not.toThrow();
  });

  it('has a runnable official Carbon composition or an explicit reason', () => {
    for (const pattern of carbonPatterns) {
      expect(pattern.reason.trim()).not.toBe('');
      if (!pattern.documentationOnly) {
        expect(pattern.componentNames.length).toBeGreaterThan(0);
      }
      expect(renderCarbonPattern(pattern.id)).toBeDefined();
    }
  });

  it('keeps an explicit composition for every runnable pattern', () => {
    expect(runnableCarbonPatternIds).toHaveLength(16);
    for (const id of runnableCarbonPatternIds) {
      expect(renderCarbonPattern(id)).toBeDefined();
    }
  });
});
