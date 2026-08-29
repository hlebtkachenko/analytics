// Verifies that every Node.js version pin in the repository states the same version.
import { readFile, readdir } from 'node:fs/promises';
import { EOL } from 'node:os';

const wantedVersionPattern = /^\d+\.\d+\.\d+$/;
const pins = [];

async function readText(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function listFiles(directory, suffix) {
  const entries = await readdir(new URL(`../${directory}`, import.meta.url));
  return entries
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => `${directory}/${entry}`);
}

function record(source, version) {
  pins.push({ source, version });
}

function collect(source, text, pattern) {
  for (const match of text.matchAll(pattern)) {
    record(source, match[1]);
  }
}

const nvmrc = (await readText('.nvmrc')).trim();
record('.nvmrc', nvmrc);
record('.node-version', (await readText('.node-version')).trim());

const manifest = JSON.parse(await readText('package.json'));
const engines = manifest.engines.node;
const engineMatch = /^>=(\d+\.\d+\.\d+) <(\d+)$/.exec(engines);

for (const path of await listFiles('docker', '.Dockerfile')) {
  collect(path, await readText(path), /^FROM node:(\d+\.\d+\.\d+)-/gm);
}

for (const path of await listFiles('.github/workflows', '.yml')) {
  collect(path, await readText(path), /runtime: node@(\d+\.\d+\.\d+)/g);
}

for (const path of ['README.md', ...(await listFiles('docs', '.md'))]) {
  collect(path, await readText(path), /Node\.js (\d+\.\d+\.\d+)/g);
}

const problems = [];

if (!wantedVersionPattern.test(nvmrc)) {
  problems.push(`.nvmrc must hold an exact version, found "${nvmrc}"`);
}

if (!engineMatch) {
  problems.push(
    `package.json engines.node must read ">=<version> <major+1>", found "${engines}"`,
  );
} else {
  record('package.json engines.node', engineMatch[1]);
  const wantedCeiling = String(Number(nvmrc.split('.')[0]) + 1);
  if (engineMatch[2] !== wantedCeiling) {
    problems.push(
      `package.json engines.node ceiling must be ${wantedCeiling}, found ${engineMatch[2]}`,
    );
  }
}

for (const pin of pins) {
  if (pin.version !== nvmrc) {
    problems.push(`${pin.source} pins ${pin.version}, expected ${nvmrc}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Node.js version pins disagree:${EOL}${problems.map((problem) => `  - ${problem}`).join(EOL)}${EOL}`,
  );
  process.exit(1);
}

process.stdout.write(
  `Node.js ${nvmrc} pinned consistently across ${pins.length} locations.${EOL}`,
);
