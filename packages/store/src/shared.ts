import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActionLogQuery, ActionLogRow, HandleRecord, Run } from '@qa-brain/core';

/**
 * Helpers shared by the SQLite and Postgres adapters: migrations-folder resolution, query
 * normalisation, and row ↔ interface mapping. Keeping the mapping here guarantees both drivers return
 * identically shaped objects.
 */

export const DEFAULT_LOG_LIMIT = 50;
export const MAX_LOG_LIMIT = 500;

/**
 * Resolves `<package root>/migrations/<dialect>` from this module's location. Works from `src/` (vitest,
 * tsx) and from `dist/` (tsup bundle) because both live one level below the package root; a second
 * candidate two levels up covers a nested bundle layout (e.g. `dist/chunks/`). When no candidate exists the
 * first one is returned so the migrator reports a clear "folder not found" error instead of a silent no-op.
 */
export function resolveMigrationsFolder(dialect: 'sqlite' | 'pg', moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    resolve(here, '..', 'migrations', dialect),
    resolve(here, '..', '..', 'migrations', dialect),
  ];
  return candidates.find((c) => existsSync(c)) ?? (candidates[0] as string);
}

/**
 * Creates the parent directory of a libsql `file:` URL so a fresh `.qa-brain/` tree can be opened.
 * Accepts `file:./rel.db`, `file:/abs.db`, `file:C:/abs.db`, `file:///C:/abs.db` and leaves
 * `:memory:` / `file::memory:` / non-file URLs untouched.
 */
export async function ensureSqliteFileDir(url: string): Promise<void> {
  if (!url.startsWith('file:')) return;
  const rest = url.slice('file:'.length).split('?')[0] ?? '';
  if (rest === '' || rest.startsWith(':memory:')) return;
  let path = rest;
  if (rest.startsWith('//')) {
    try {
      path = fileURLToPath(`file:${rest}`);
    } catch {
      return;
    }
  }
  await mkdir(dirname(resolve(path)), { recursive: true });
}

export interface NormalizedLogQuery {
  runId: string | undefined;
  tool: string | undefined;
  since: number | undefined;
  limit: number;
  offset: number;
}

export function normalizeLogQuery(q: ActionLogQuery): NormalizedLogQuery {
  const rawLimit = q.limit ?? DEFAULT_LOG_LIMIT;
  const limit = Math.min(MAX_LOG_LIMIT, Math.max(1, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 0)));
  const rawOffset = q.offset ?? 0;
  const offset = Math.max(0, Math.floor(Number.isFinite(rawOffset) ? rawOffset : 0));
  return { runId: q.runId, tool: q.tool, since: q.since, limit, offset };
}

/* ---------------------------------------------------------------- row shapes (camelCase, dialect-neutral) */

export interface ActionLogDbRow {
  id: string;
  tsStart: number;
  durationMs: number;
  runId: string | null;
  transport: ActionLogRow['transport'];
  protocolEra: ActionLogRow['protocolEra'];
  principal: string;
  upstream: string;
  tool: string;
  upstreamTool: string;
  argsShape: unknown;
  argsRedacted: unknown;
  argsHash: string;
  isError: boolean;
  errorCode: ActionLogRow['errorCode'];
  errorMessage: string | null;
  resultChars: number;
  resultKinds: string;
  resultDigest: string | null;
  traceparent: string | null;
  clientName: string | null;
  createdAt: number;
}

export function toActionLogInsert(row: ActionLogRow, now = Date.now()): ActionLogDbRow {
  return {
    id: row.id,
    tsStart: row.tsStart,
    durationMs: row.durationMs,
    runId: row.runId ?? null,
    transport: row.transport,
    protocolEra: row.protocolEra ?? null,
    principal: row.principal,
    upstream: row.upstream,
    tool: row.tool,
    upstreamTool: row.upstreamTool,
    argsShape: row.argsShape ?? null,
    argsRedacted: row.argsRedacted ?? null,
    argsHash: row.argsHash,
    isError: row.isError,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    resultChars: row.resultChars,
    resultKinds: row.resultKinds,
    resultDigest: row.resultDigest ?? null,
    traceparent: row.traceparent ?? null,
    clientName: row.clientName ?? null,
    createdAt: now,
  };
}

export function fromActionLogRow(r: ActionLogDbRow): ActionLogRow {
  return {
    id: r.id,
    tsStart: Number(r.tsStart),
    durationMs: Number(r.durationMs),
    runId: r.runId,
    transport: r.transport,
    protocolEra: r.protocolEra,
    principal: r.principal,
    upstream: r.upstream,
    tool: r.tool,
    upstreamTool: r.upstreamTool,
    argsShape: r.argsShape ?? null,
    argsRedacted: r.argsRedacted ?? null,
    argsHash: r.argsHash,
    isError: Boolean(r.isError),
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    resultChars: Number(r.resultChars),
    resultKinds: r.resultKinds,
    resultDigest: r.resultDigest,
    traceparent: r.traceparent,
    clientName: r.clientName,
  };
}

export interface RunDbRow {
  id: string;
  projectId: string | null;
  name: string | null;
  status: Run['status'];
  trigger: string;
  meta: unknown;
  summary: unknown;
  principal: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export function fromRunRow(r: RunDbRow): Run {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    status: r.status,
    trigger: r.trigger,
    meta: r.meta ?? null,
    summary: r.summary ?? null,
    principal: r.principal,
    createdAt: Number(r.createdAt),
    startedAt: r.startedAt === null ? null : Number(r.startedAt),
    finishedAt: r.finishedAt === null ? null : Number(r.finishedAt),
  };
}

/** A run is terminal once it has a final status; `finish()` stamps `finished_at` for these. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<Run['status']> = new Set([
  'passed',
  'failed',
  'cancelled',
  'error',
]);

export interface HandleDbRow {
  handle: string;
  kind: HandleRecord['kind'];
  owner: string;
  state: unknown;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export function fromHandleRow(r: HandleDbRow): HandleRecord {
  return {
    handle: r.handle,
    kind: r.kind,
    owner: r.owner,
    state: r.state ?? null,
    createdAt: Number(r.createdAt),
    expiresAt: Number(r.expiresAt),
    lastUsedAt: r.lastUsedAt === null ? null : Number(r.lastUsedAt),
    revokedAt: r.revokedAt === null ? null : Number(r.revokedAt),
  };
}

/** `true` when a stored handle may be used by `owner` at instant `now`. */
export function isHandleUsable(r: HandleDbRow, owner: string, now: number): boolean {
  return r.owner === owner && r.revokedAt === null && Number(r.expiresAt) > now;
}

/** Clamps a TTL to a positive integer number of milliseconds (a zero/negative TTL mints an already-expired handle otherwise). */
export function normalizeTtlMs(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
  return Math.floor(ttlMs);
}
