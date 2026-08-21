import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  // The published binary must be directly executable on POSIX shells.
  banner: { js: '#!/usr/bin/env node' },
});
