import type { StoreAdapter } from '@qa-brain/core';
import { createPgStore, type PgStoreOptions } from './pg-adapter.js';
import { createSqliteStore, type SqliteStoreOptions } from './sqlite-adapter.js';

export { createPgStore, type PgDb, type PgStoreOptions } from './pg-adapter.js';
export * from './schema/enums.js';
export * as pgSchema from './schema/pg.js';
export * as sqliteSchema from './schema/sqlite.js';
export { DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT, resolveMigrationsFolder } from './shared.js';
export { createSqliteStore, type SqliteDb, type SqliteStoreOptions } from './sqlite-adapter.js';

/** Mirrors `StoreConfigSchema` from @qa-brain/core (`poolMax` optional here; defaults to 10). */
export type StoreConfig = ({ driver: 'sqlite' } & SqliteStoreOptions) | ({ driver: 'pg' } & PgStoreOptions);

/** Opens the store selected by `config.driver`. Call `migrate()` on the result before first use. */
export async function createStore(config: StoreConfig): Promise<StoreAdapter> {
  switch (config.driver) {
    case 'sqlite':
      return createSqliteStore({ url: config.url });
    case 'pg':
      return createPgStore({ url: config.url, poolMax: config.poolMax });
    default: {
      const never: never = config;
      throw new Error(`unknown store driver: ${JSON.stringify(never)}`);
    }
  }
}
