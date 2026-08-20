import type {
  ActionLogQuery,
  ActionLogRepository,
  ActionLogRow,
  HandleKind,
  HandleRecord,
  HandleRepository,
  Run,
  RunRepository,
  RunStatus,
  StoreAdapter,
} from '@qa-brain/core';
import { mintHandle } from '@qa-brain/core';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { RunTriggerValue } from './schema/enums.js';
import * as schema from './schema/pg.js';
import {
  fromActionLogRow,
  fromHandleRow,
  fromRunRow,
  isHandleUsable,
  normalizeLogQuery,
  normalizeTtlMs,
  resolveMigrationsFolder,
  TERMINAL_RUN_STATUSES,
  toActionLogInsert,
} from './shared.js';

export interface PgStoreOptions {
  /** Postgres connection string. */
  url: string;
  /** Pool size; default 10 (matches `StoreConfigSchema.poolMax`). */
  poolMax?: number;
}

export type PgDb = NodePgDatabase<typeof schema>;

/**
 * Postgres store on `pg` Pool + `drizzle-orm/node-postgres`. Semantics are identical to the SQLite
 * adapter; the only dialect differences are column types (see `schema/pg.ts`).
 *
 * Note: `run.id` is a `uuid` column — callers must pass the bare UUIDv7 (`newId()` / `parseHandle().id`),
 * not the `rn_…` handle string. `action_log.run_id` is text and accepts either.
 */
export async function createPgStore(opts: PgStoreOptions): Promise<StoreAdapter> {
  const pool = new pg.Pool({ connectionString: opts.url, max: opts.poolMax ?? 10 });
  // `pg` returns int8 (bigint) as strings; our epoch-ms columns fit in a JS number, so parse them.
  // Type OID 20 = int8. This is process-global in `pg`, which is acceptable for a single-store process.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const db: PgDb = drizzle(pool, { schema });
  const migrationsFolder = resolveMigrationsFolder('pg', import.meta.url);

  return {
    driver: 'pg',
    async migrate() {
      await migrate(db, { migrationsFolder });
    },
    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    actionLog: pgActionLogRepository(db),
    runs: pgRunRepository(db),
    handles: pgHandleRepository(db),
    async close() {
      await pool.end();
    },
  };
}

/* ---------------------------------------------------------------- action_log */

export function pgActionLogRepository(db: PgDb): ActionLogRepository {
  const t = schema.actionLog;
  return {
    async insert(row: ActionLogRow): Promise<void> {
      await db.insert(t).values(toActionLogInsert(row));
    },
    async query(q: ActionLogQuery): Promise<ActionLogRow[]> {
      const n = normalizeLogQuery(q);
      const conds = [];
      if (n.runId !== undefined) conds.push(eq(t.runId, n.runId));
      if (n.tool !== undefined) conds.push(eq(t.tool, n.tool));
      if (n.since !== undefined) conds.push(gte(t.tsStart, n.since));
      const rows = await db
        .select()
        .from(t)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(t.tsStart), desc(t.id))
        .limit(n.limit)
        .offset(n.offset);
      return rows.map(fromActionLogRow);
    },
    async count(runId: string): Promise<{ total: number; errors: number }> {
      const [row] = await db
        .select({
          total: count(),
          errors: sql<number>`coalesce(sum(case when ${t.isError} then 1 else 0 end), 0)`,
        })
        .from(t)
        .where(eq(t.runId, runId));
      return { total: Number(row?.total ?? 0), errors: Number(row?.errors ?? 0) };
    },
  };
}

/* ---------------------------------------------------------------- run */

export function pgRunRepository(db: PgDb): RunRepository {
  const t = schema.run;
  return {
    /** See the SQLite adapter: the run is live immediately (`running`, `started_at = created_at`). */
    async create(input): Promise<Run> {
      const now = Date.now();
      const [row] = await db
        .insert(t)
        .values({
          id: input.id,
          name: input.name ?? null,
          status: 'running',
          trigger: (input.trigger ?? 'manual') as RunTriggerValue,
          meta: input.meta ?? null,
          summary: null,
          principal: input.principal,
          createdAt: now,
          startedAt: now,
          finishedAt: null,
        })
        .returning();
      if (!row) throw new Error('run insert returned no row');
      return fromRunRow(row);
    },
    async finish(id: string, patch: { status: RunStatus; summary?: unknown }): Promise<Run | null> {
      const now = Date.now();
      const values: Partial<typeof t.$inferInsert> = { status: patch.status };
      if (patch.summary !== undefined) values.summary = patch.summary;
      if (TERMINAL_RUN_STATUSES.has(patch.status)) values.finishedAt = now;
      const [row] = await db.update(t).set(values).where(eq(t.id, id)).returning();
      return row ? fromRunRow(row) : null;
    },
    async get(id: string): Promise<Run | null> {
      const [row] = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return row ? fromRunRow(row) : null;
    },
  };
}

/* ---------------------------------------------------------------- handle */

export function pgHandleRepository(db: PgDb): HandleRepository {
  const t = schema.handle;
  return {
    async mint(kind: HandleKind, owner: string, ttlMs: number, state?: unknown): Promise<HandleRecord> {
      const now = Date.now();
      const ttl = normalizeTtlMs(ttlMs);
      const [row] = await db
        .insert(t)
        .values({
          handle: mintHandle(kind),
          kind,
          owner,
          state: state ?? null,
          ttlS: Math.floor(ttl / 1000),
          createdAt: now,
          expiresAt: now + ttl,
          lastUsedAt: null,
          revokedAt: null,
        })
        .returning();
      if (!row) throw new Error('handle insert returned no row');
      return fromHandleRow(row);
    },
    async resolve(handleId: string, owner: string): Promise<HandleRecord | null> {
      const now = Date.now();
      const [row] = await db.select().from(t).where(eq(t.handle, handleId)).limit(1);
      if (!row || !isHandleUsable(row, owner, now)) return null;
      await db.update(t).set({ lastUsedAt: now }).where(eq(t.handle, handleId));
      return fromHandleRow({ ...row, lastUsedAt: now });
    },
    async revoke(handleId: string): Promise<void> {
      await db
        .update(t)
        .set({ revokedAt: Date.now() })
        .where(and(eq(t.handle, handleId), sql`${t.revokedAt} IS NULL`));
    },
    async sweep(now = Date.now()): Promise<number> {
      const gone = await db.delete(t).where(lte(t.expiresAt, now)).returning({ handle: t.handle });
      return gone.length;
    },
  };
}
