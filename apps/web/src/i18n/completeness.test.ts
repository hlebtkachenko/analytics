import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resources } from './resources';

// The web application source root, resolved from the workspace working directory.
const sourceRoot = join(process.cwd(), 'src');

// Every translation key literal passed to t('<key>') in application source.
const translationKeyPattern = /\bt\(\s*['"]([A-Za-z0-9_.-]+)['"]/g;

function sourceFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name)) {
      continue;
    }
    if (/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function collectKeys(): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(sourceRoot)) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(translationKeyPattern)) {
      const key = match[1];
      if (key !== undefined && key.includes('.') && !keys.has(key)) {
        keys.set(key, file);
      }
    }
  }
  return keys;
}

function keyExists(key: string): boolean {
  const segments = key.split('.');
  const leaf = segments.pop()!;
  let node: unknown = resources['en-US'].translation;
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null) {
      return false;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  // A count key carries only its i18next plural forms, never the bare name.
  const parent = node as Record<string, unknown>;
  return (
    typeof parent[leaf] === 'string' ||
    typeof parent[`${leaf}_other`] === 'string'
  );
}

describe('translation key completeness', () => {
  it('resolves every t() key literal used in application source', () => {
    const missing: string[] = [];
    for (const [key, file] of collectKeys()) {
      if (!keyExists(key)) {
        missing.push(`${key} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
