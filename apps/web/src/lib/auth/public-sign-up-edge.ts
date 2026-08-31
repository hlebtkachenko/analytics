import { isIP } from 'node:net';

export const publicSignUpFallbackIdentity = 'shared-fallback';

function ipv6Prefix(address: string): string {
  let normalized = address.toLowerCase();
  const finalColon = normalized.lastIndexOf(':');
  const finalPart = normalized.slice(finalColon + 1);

  if (finalPart.includes('.')) {
    const octets = finalPart.split('.').map(Number);
    const high = (octets[0]! << 8) | octets[1]!;
    const low = (octets[2]! << 8) | octets[3]!;
    normalized = `${normalized.slice(0, finalColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const [left = '', right = ''] = normalized.split('::');
  const leftWords = left === '' ? [] : left.split(':');
  const rightWords = right === '' ? [] : right.split(':');
  const omittedWords = 8 - leftWords.length - rightWords.length;
  const words = [
    ...leftWords,
    ...Array.from({ length: omittedWords }, () => '0'),
    ...rightWords,
  ];

  return `${words
    .slice(0, 4)
    .map((word) => Number.parseInt(word, 16).toString(16).padStart(4, '0'))
    .join(':')}::/64`;
}

export function normalizePublicSignUpClientIdentity(
  headerValue: string | null,
): string {
  const value = headerValue?.trim();
  if (value === undefined || value === '' || value.includes('%')) {
    return publicSignUpFallbackIdentity;
  }

  const family = isIP(value);
  if (family === 4) {
    return `${value}/32`;
  }
  if (family === 6) {
    return ipv6Prefix(value);
  }

  return publicSignUpFallbackIdentity;
}
