import { createClient } from '@libsql/client';
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
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { RunTriggerValue } from './schema/enums.js';
import * as schema from './schema/sqlite.js';
import {
  ensureSqliteFileDir,
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

export interface SqliteStoreOptions {
  /**
   * libsql URL: `file:./.qa-brain/qa-brain.db`, `file:/abs/path.db`, `:memory:` or `file::memory:`.
   * Parent directories of `file:` URLs are created on open.
   */
  url: string;
}

export type SqliteDb = LibSQLDatabase<typeof schema>;

/**
 * SQLite store on `@libsql/client` + `drizzle-orm/libsql`. One connection per process; libsql serialises
 * writes internally, which is all the stdio gateway needs.
 */
export async function createSqliteStore(opts: SqliteStoreOptions): Promise<StoreAdapter> {
  await ensureSqliteFileDir(opts.url);
  const client = createClient({ url: opts.url });
  // FK enforcement is off by default in SQLite; turn it on for this connection so the schema's
  // references() clauses mean the same thing as on Postgres.
  await client.execute('PRAGMA foreign_keys = ON');
  const db: SqliteDb = drizzle(client, { schema });
  const migrationsFolder = resolveMigrationsFolder('sqlite', import.meta.url);

  return {
    driver: 'sqlite',
    async migrate() {
      await migrate(db, { migrationsFolder });
    },
    async ping() {
      try {
        await client.execute('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    actionLog: sqliteActionLogRepository(db),
    runs: sqliteRunRepository(db),
    handles: sqliteHandleRepository(db),
    async close() {
      client.close();
    },
  };
}

/* ---------------------------------------------------------------- action_log */

export function sqliteActionLogRepository(db: SqliteDb): ActionLogRepository {
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

export function sqliteRunRepository(db: SqliteDb): RunRepository {
  const t = schema.run;
  return {
    /**
     * `create()` backs `qa_run_start`: the run is live immediately (`status = 'running'`,
     * `started_at = created_at`). Queued suite runs (M5 Tasks) will insert through the schema directly.
     */
    async create(input): Promise<Run> {
      const now = Date.now();
      const [row] = await db
        .insert(t)
        .values({
          id: input.id,
          name: input.name ?? null,
          status: 'running',
          // Free-form in the interface; the column is typed with RUN_TRIGGER but not CHECK-constrained.
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

export function sqliteHandleRepository(db: SqliteDb): HandleRepository {
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
    /** Null when unknown, revoked, expired or owned by someone else; bumps `last_used_at` otherwise. */
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
    /** Deletes every handle whose `expires_at <= now` (revoked or not) and returns how many went away. */
    async sweep(now = Date.now()): Promise<number> {
      const gone = await db.delete(t).where(lte(t.expiresAt, now)).returning({ handle: t.handle });
      return gone.length;
    },
  };
}
