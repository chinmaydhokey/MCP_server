import { defineConfig } from 'drizzle-kit';

/** `pnpm db:generate:sqlite` — writes SQL + meta snapshots to ./migrations/sqlite (committed). */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/sqlite.ts',
  out: './migrations/sqlite',
  strict: true,
  verbose: true,
});
