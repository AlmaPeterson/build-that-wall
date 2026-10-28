import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
