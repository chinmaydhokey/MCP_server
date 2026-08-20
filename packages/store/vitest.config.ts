import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // libsql opens a native handle per client; keep tests in one process to avoid file locks on Windows.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
