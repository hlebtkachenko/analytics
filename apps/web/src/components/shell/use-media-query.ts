'use client';

import { useEffect, useState } from 'react';

// Carbon's large breakpoint; above it the rail can stay pinned open.
export const largeViewportQuery = '(min-width: 66rem)';

// SSR-safe: renders with the given initial match, then syncs after mount.
export function useMediaQuery(query: string, initialMatches = false): boolean {
  const [matches, setMatches] = useState(initialMatches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
