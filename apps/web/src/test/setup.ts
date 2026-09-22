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

// jsdom ships no matchMedia, which the media-query hook reads on mount.
globalThis.matchMedia ??= (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
