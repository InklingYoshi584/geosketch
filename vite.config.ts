import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/geosketch/
  base: '/geosketch/',
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
