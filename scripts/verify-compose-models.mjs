import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const developmentFiles = [
  'compose.yaml',
  'compose.development.yaml',
  'compose.mailpit.yaml',
];
const productionFiles = ['compose.yaml', 'compose.production.yaml'];
const baseDevelopmentEnvironment = {
  BAP_PUBLIC_HOST: 'http://localhost',
  BAP_PUBLIC_ORIGIN: 'http://localhost:3000',
  MAILPIT_HTTP_PORT: '8025',
  POSTGRES_PORT: '5432',
  WEB_PORT: '3000',
};

function renderCompose(files, environment, profiles = []) {
  const arguments_ = [
    'compose',
    ...profiles.flatMap((profile) => ['--profile', profile]),
    ...files.flatMap((file) => ['--file', file]),
    'config',
    '--format',
    'json',
  ];
  const result = spawnSync('docker', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error('Could not render a Compose verification model.');
  }
  return result.stdout;
}

function runVerifier(mode, configuration) {
  return spawnSync(process.execPath, ['scripts/verify-compose.mjs', mode], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: configuration,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function verifyModel(label, mode, files, environment, profiles = []) {
  const result = runVerifier(mode, renderCompose(files, environment, profiles));
  if (result.status !== 0) {
    const summary = result.stderr
      .split('\n')
      .find((line) => line.includes('Error:'));
    throw new Error(`${label} failed: ${summary ?? 'unknown verifier error'}`);
  }
  process.stdout.write(`${label} verified.\n`);
}

function verifyPortCollision(label, environment, expectedPort) {
  const result = runVerifier(
    'development',
    renderCompose(developmentFiles, environment),
  );
  const expectedMessage = `Published TCP host port ${expectedPort} is reused`;
  if (result.status === 0 || !result.stderr.includes(expectedMessage)) {
    throw new Error(`${label} was not rejected by the Compose verifier.`);
  }
  process.stdout.write(`${label} rejection verified.\n`);
}

function verifyRejectedModel(
  label,
  mode,
  files,
  environment,
  profiles,
  mutate,
  expectedMessage,
) {
  const configuration = JSON.parse(renderCompose(files, environment, profiles));
  mutate(configuration);
  const result = runVerifier(mode, JSON.stringify(configuration));
  if (result.status === 0 || !result.stderr.includes(expectedMessage)) {
    throw new Error(`${label} was not rejected by the Compose verifier.`);
  }
  process.stdout.write(`${label} rejection verified.\n`);
}

verifyModel(
  'Compose development default contract',
  'development',
  developmentFiles,
  baseDevelopmentEnvironment,
);
verifyModel(
  'Compose development port-override contract',
  'development',
  developmentFiles,
  {
    ...baseDevelopmentEnvironment,
    MAILPIT_HTTP_PORT: '18025',
    POSTGRES_PORT: '15432',
    WEB_PORT: '18080',
  },
);
verifyPortCollision(
  'Compose Mailpit/Web port collision',
  {
    ...baseDevelopmentEnvironment,
    MAILPIT_HTTP_PORT: '18080',
    POSTGRES_PORT: '15432',
    WEB_PORT: '18080',
  },
  18080,
);
verifyPortCollision(
  'Compose Mailpit/PostgreSQL port collision',
  {
    ...baseDevelopmentEnvironment,
    MAILPIT_HTTP_PORT: '15432',
    POSTGRES_PORT: '15432',
    WEB_PORT: '18080',
  },
  15432,
);
verifyModel('Compose production contract', 'production', productionFiles, {
  BAP_PUBLIC_HOST: 'bap.invalid',
  BAP_PUBLIC_ORIGIN: 'https://bap.invalid',
});
verifyModel(
  'Compose operations contract',
  'operations',
  productionFiles,
  {
    BAP_PUBLIC_HOST: 'bap.invalid',
    BAP_PUBLIC_ORIGIN: 'https://bap.invalid',
  },
  ['operations'],
);
verifyRejectedModel(
  'Compose blob storage read-write backup',
  'operations',
  productionFiles,
  { BAP_PUBLIC_HOST: 'bap.invalid', BAP_PUBLIC_ORIGIN: 'https://bap.invalid' },
  ['operations'],
  (configuration) => {
    for (const mount of configuration.services.backup.volumes) {
      if (mount.source === 'blob_storage') {
        delete mount.read_only;
      }
    }
  },
  'backup must mount the blob storage volume read-only',
);
verifyRejectedModel(
  'Compose blob storage extra member',
  'operations',
  productionFiles,
  { BAP_PUBLIC_HOST: 'bap.invalid', BAP_PUBLIC_ORIGIN: 'https://bap.invalid' },
  ['operations'],
  (configuration) => {
    configuration.services['reporting-api'].volumes = [
      { type: 'volume', source: 'blob_storage', target: '/var/lib/bap/blobs' },
    ];
  },
  'Unexpected blob storage members: api,backup,reporting-api,restore,worker',
);
verifyModel(
  'Compose bootstrap contract',
  'bootstrap',
  ['compose.yaml', 'compose.development.yaml'],
  baseDevelopmentEnvironment,
  ['bootstrap'],
);
