import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(configDirectory, '../..'),
  sassOptions: {
    includePaths: [
      path.resolve(configDirectory, '../../node_modules/.pnpm/node_modules'),
    ],
  },
  transpilePackages: ['@bap/design-system'],
  typedRoutes: true,
};

export default nextConfig;
