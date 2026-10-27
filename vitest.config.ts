import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // apps/ is a separately deployed Node 24 service that runs on node:test via
    // `npm run test:github-connect`; Vitest would load it and report "No test suite found".
    exclude: ['apps/**', 'tests/e2e/**', 'node_modules/**', '**/*.e2e.spec.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
