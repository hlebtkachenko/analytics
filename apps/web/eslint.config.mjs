import nextConfig from '@bap/eslint-config/next';

const config = [{ ignores: ['_junk/**', 'dist-cli/**'] }, ...nextConfig];

export default config;
