import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@qa-brain/core': path.resolve(import.meta.dirname, 'packages/core/src/index.ts'),
  '@qa-brain/store': path.resolve(import.meta.dirname, 'packages/store/src/index.ts'),
  '@qa-brain/adapter-playwright': path.resolve(
    import.meta.dirname,
    'packages/adapter-playwright/src/index.ts',
  ),
  '@qa-brain/gateway': path.resolve(import.meta.dirname, 'packages/gateway/src/index.ts'),
  '@qa-brain/test-format': path.resolve(import.meta.dirname, 'packages/test-format/src/index.ts'),
  '@qa-brain/healing': path.resolve(import.meta.dirname, 'packages/healing/src/index.ts'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.e2e.test.ts', '**/node_modules/**', '**/dist/**'],
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'e2e',
          include: ['apps/*/test/**/*.e2e.test.ts', 'packages/*/test/**/*.e2e.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
