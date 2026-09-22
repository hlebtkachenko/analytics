// A list's "New" baseline per browser, scope and organization; reading it advances it to now.

// The storage key for one scope and organization, e.g. bap.documents.lastSeen.<org>.
export function lastSeenKey(scope: string, organizationId: string): string {
  return `bap.${scope}.lastSeen.${organizationId}`;
}

export function inboxLastSeenKey(organizationId: string): string {
  return lastSeenKey('inbox', organizationId);
}

// New means arrived after the baseline; no baseline yet marks nothing.
export function isNewSince(
  baseline: string | null,
  receivedAt: string,
): boolean {
  if (baseline === null) {
    return false;
  }
  const base = Date.parse(baseline);
  const received = Date.parse(receivedAt);
  return Number.isFinite(base) && Number.isFinite(received) && received > base;
}
