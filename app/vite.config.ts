import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // UI tests opt in with a `// @vitest-environment happy-dom` comment at the top of the file
  },
});
