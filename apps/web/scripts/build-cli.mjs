import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: workspace,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  bundle: true,
  entryPoints: [
    'src/cli/bootstrap-owner.ts',
    'src/cli/create-synthetic-account.ts',
  ],
  external: ['pg-native'],
  format: 'esm',
  legalComments: 'eof',
  logLevel: 'info',
  outbase: 'src',
  outdir: 'dist-cli',
  platform: 'node',
  target: 'node24',
  tsconfig: 'tsconfig.cli.json',
});
