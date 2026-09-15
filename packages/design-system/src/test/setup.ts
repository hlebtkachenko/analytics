import '@testing-library/jest-dom/vitest';

// jsdom ships no ResizeObserver, which Carbon form controls observe on mount.
class TestResizeObserver implements ResizeObserver {
  disconnect(): void {
    return undefined;
  }

  observe(): void {
    return undefined;
  }

  unobserve(): void {
    return undefined;
  }
}

globalThis.ResizeObserver ??= TestResizeObserver;
