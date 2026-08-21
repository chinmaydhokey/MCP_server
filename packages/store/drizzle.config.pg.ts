import { defineConfig } from 'drizzle-kit';

/** `pnpm db:generate:pg` — writes SQL + meta snapshots to ./migrations/pg (committed). */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/pg.ts',
  out: './migrations/pg',
  strict: true,
  verbose: true,
});
