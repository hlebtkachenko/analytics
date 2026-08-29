import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const generatorPath = resolve(
  import.meta.dirname,
  '../../scripts/generate-component-stories.mjs',
);

test('preserves stale generated stories and reads before replacement', async () => {
  const source = await readFile(generatorPath, 'utf8');
  expect(source).not.toMatch(/\b(?:rm|unlink)\s*\(/);
  expect(source).toContain('moveStaleGeneratedStories');
  expect(source).toContain('createArchiveRunDirectory');
  expect(source).toContain('await rename(');
  expect(source).toContain("file.name.endsWith('.stories.tsx')");
  expect(source).toContain('async function writeIfChanged');
  expect(source).toContain("await readFile(path, 'utf8')");
  expect(source).toContain("process.argv.includes('--check')");
  expect(source).toContain("error.code === 'ENOENT'");
});
