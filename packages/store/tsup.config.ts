import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: {
    // tsconfig.base.json sets `composite: true` for `tsc -b`; tsup's DTS builder feeds an explicit file list,
    // which a composite project rejects (TS6307). Override just for the declaration bundle.
    compilerOptions: { composite: false, incremental: false, declarationMap: false },
  },
});
