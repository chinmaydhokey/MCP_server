import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ActionLogRow, newId, parseHandle, type StoreAdapter } from '@qa-brain/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteStore, createStore } from '../src/index.js';

function logRow(over: Partial<ActionLogRow> = {}): ActionLogRow {
  return {
    id: newId(),
    tsStart: Date.now(),
    durationMs: 12,
    runId: null,
    transport: 'stdio',
    protocolEra: 'legacy',
    principal: 'local',
    upstream: 'playwright',
    tool: 'web_click',
    upstreamTool: 'browser_click',
    argsShape: { ref: 'string' },
    argsRedacted: null,
    argsHash: 'abc123',
    isError: false,
    errorCode: null,
    errorMessage: null,
    resultChars: 42,
    resultKinds: 'text',
    resultDigest: null,
    traceparent: null,
    clientName: 'vitest',
    ...over,
  };
}

describe('sqlite adapter (in-memory)', () => {
  let store: StoreAdapter;

  beforeAll(async () => {
    store = await createSqliteStore({ url: ':memory:' });
    await store.migrate();
  });

  afterAll(async () => {
    await store.close();
  });

  it('reports its driver and pings', async () => {
    expect(store.driver).toBe('sqlite');
    expect(await store.ping()).toBe(true);
  });

  it('migrate() is idempotent', async () => {
    await expect(store.migrate()).resolves.toBeUndefined();
  });

  describe('actionLog', () => {
    const runA = newId();
    const runB = newId();
    const base = 1_700_000_000_000;

    beforeAll(async () => {
      await store.actionLog.insert(logRow({ runId: runA, tsStart: base + 1, tool: 'web_navigate' }));
      await store.actionLog.insert(logRow({ runId: runA, tsStart: base + 2, tool: 'web_click' }));
      await store.actionLog.insert(
        logRow({
          runId: runA,
          tsStart: base + 3,
          tool: 'web_click',
          isError: true,
          errorCode: 'timeout',
          errorMessage: 'timed out',
        }),
      );
      await store.actionLog.insert(
        logRow({ runId: runB, tsStart: base + 4, tool: 'qa_health', upstream: 'native' }),
      );
      await store.actionLog.insert(
        logRow({ runId: null, tsStart: base + 5, tool: 'qa_health', upstream: 'native' }),
      );
    });

    it('round-trips a row with json + booleans intact', async () => {
      const [latest] = await store.actionLog.query({ runId: runA, limit: 1 });
      expect(latest).toBeDefined();
      expect(latest?.tsStart).toBe(base + 3);
      expect(latest?.isError).toBe(true);
      expect(latest?.errorCode).toBe('timeout');
      expect(latest?.argsShape).toEqual({ ref: 'string' });
      expect(latest?.argsRedacted).toBeNull();
      expect(latest?.protocolEra).toBe('legacy');
      expect(latest?.clientName).toBe('vitest');
    });

    it('filters by runId and orders by ts_start desc', async () => {
      const rows = await store.actionLog.query({ runId: runA });
      expect(rows.map((r) => r.tsStart)).toEqual([base + 3, base + 2, base + 1]);
      expect(rows.every((r) => r.runId === runA)).toBe(true);
    });

    it('filters by tool and since, paginates with limit/offset', async () => {
      expect((await store.actionLog.query({ tool: 'web_click' })).length).toBe(2);
      expect((await store.actionLog.query({ since: base + 4 })).map((r) => r.tsStart)).toEqual([
        base + 5,
        base + 4,
      ]);
      const page = await store.actionLog.query({ runId: runA, limit: 1, offset: 1 });
      expect(page.map((r) => r.tsStart)).toEqual([base + 2]);
    });

    it('clamps limit to [1, 500] and defaults to 50', async () => {
      const all = await store.actionLog.query({});
      expect(all.length).toBe(5);
      expect((await store.actionLog.query({ limit: 0 })).length).toBe(1);
      expect((await store.actionLog.query({ limit: 10_000 })).length).toBe(5);
    });

    it('counts totals and errors per run', async () => {
      expect(await store.actionLog.count(runA)).toEqual({ total: 3, errors: 1 });
      expect(await store.actionLog.count(runB)).toEqual({ total: 1, errors: 0 });
      expect(await store.actionLog.count(newId())).toEqual({ total: 0, errors: 0 });
    });
  });

  describe('runs', () => {
    it('creates a running run and reads it back', async () => {
      const id = newId();
      const before = Date.now();
      const run = await store.runs.create({ id, name: 'smoke', principal: 'local', meta: { a: 1 } });
      expect(run.id).toBe(id);
      expect(run.name).toBe('smoke');
      expect(run.status).toBe('running');
      expect(run.trigger).toBe('manual');
      expect(run.principal).toBe('local');
      expect(run.meta).toEqual({ a: 1 });
      expect(run.summary).toBeNull();
      expect(run.projectId).toBeNull();
      expect(run.createdAt).toBeGreaterThanOrEqual(before);
      expect(run.startedAt).toBe(run.createdAt);
      expect(run.finishedAt).toBeNull();
      expect(await store.runs.get(id)).toEqual(run);
    });

    it('finishes a run with a summary and finished_at', async () => {
      const id = newId();
      await store.runs.create({ id, principal: 'local', trigger: 'ci' });
      const done = await store.runs.finish(id, { status: 'passed', summary: { passed: 3 } });
      expect(done?.status).toBe('passed');
      expect(done?.summary).toEqual({ passed: 3 });
      expect(done?.trigger).toBe('ci');
      expect(done?.name).toBeNull();
      expect(typeof done?.finishedAt).toBe('number');
      expect(await store.runs.get(id)).toEqual(done);
    });

    it('returns null for unknown runs', async () => {
      expect(await store.runs.get(newId())).toBeNull();
      expect(await store.runs.finish(newId(), { status: 'failed' })).toBeNull();
    });
  });

  describe('handles', () => {
    it('mints a well-formed handle with ttl and state', async () => {
      const rec = await store.handles.mint('browser', 'alice', 60_000, { contextId: 'ctx-1' });
      expect(parseHandle(rec.handle)?.kind).toBe('browser');
      expect(rec.handle.startsWith('bh_')).toBe(true);
      expect(rec.kind).toBe('browser');
      expect(rec.owner).toBe('alice');
      expect(rec.state).toEqual({ contextId: 'ctx-1' });
      expect(rec.expiresAt - rec.createdAt).toBe(60_000);
      expect(rec.lastUsedAt).toBeNull();
      expect(rec.revokedAt).toBeNull();
    });

    it('resolves for the owner and bumps last_used_at', async () => {
      const rec = await store.handles.mint('run', 'alice', 60_000);
      const got = await store.handles.resolve(rec.handle, 'alice');
      expect(got?.handle).toBe(rec.handle);
      expect(typeof got?.lastUsedAt).toBe('number');
      const again = await store.handles.resolve(rec.handle, 'alice');
      expect(again?.lastUsedAt).toBeGreaterThanOrEqual(got?.lastUsedAt ?? Number.POSITIVE_INFINITY);
    });

    it('returns null on owner mismatch', async () => {
      const rec = await store.handles.mint('snapshot', 'alice', 60_000);
      expect(await store.handles.resolve(rec.handle, 'mallory')).toBeNull();
      expect(await store.handles.resolve(rec.handle, 'alice')).not.toBeNull();
    });

    it('returns null when expired', async () => {
      const rec = await store.handles.mint('device', 'alice', 0);
      expect(rec.expiresAt).toBe(rec.createdAt);
      expect(await store.handles.resolve(rec.handle, 'alice')).toBeNull();
    });

    it('returns null for unknown or malformed handles', async () => {
      expect(await store.handles.resolve('bh_does-not-exist', 'alice')).toBeNull();
      expect(await store.handles.resolve('', 'alice')).toBeNull();
    });

    it('revoke() makes the handle unusable', async () => {
      const rec = await store.handles.mint('lock', 'alice', 60_000);
      await store.handles.revoke(rec.handle);
      expect(await store.handles.resolve(rec.handle, 'alice')).toBeNull();
      await expect(store.handles.revoke(rec.handle)).resolves.toBeUndefined();
      await expect(store.handles.revoke('bh_nope')).resolves.toBeUndefined();
    });

    it('sweep() deletes expired handles and returns the count', async () => {
      const far = Date.now() + 3_600_000;
      // Clear anything earlier tests left behind so the count below is exact.
      await store.handles.sweep(far);
      const live = await store.handles.mint('browser', 'bob', 7_200_000);
      const dead1 = await store.handles.mint('browser', 'bob', 0);
      const dead2 = await store.handles.mint('snapshot', 'bob', 1);
      expect(await store.handles.sweep(Date.now() + 10)).toBe(2);
      expect(await store.handles.sweep(Date.now() + 10)).toBe(0);
      expect(await store.handles.resolve(live.handle, 'bob')).not.toBeNull();
      expect(await store.handles.resolve(dead1.handle, 'bob')).toBeNull();
      expect(await store.handles.resolve(dead2.handle, 'bob')).toBeNull();
    });
  });
});

describe('sqlite adapter (file URL)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qa-brain-store-'));
  });

  afterAll(async () => {
    // @libsql/client 0.17 keeps native statement handles alive until GC even after close(), so on Windows
    // the .db file can still be EBUSY here. Try once and move on — a leaked temp file is not a test failure.
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 0 });
    } catch {
      /* ignore */
    }
  });

  it('creates missing parent directories for file: URLs and persists across opens', async () => {
    const dbPath = join(dir, 'nested', 'deeper', 'qa-brain.db');
    const url = pathToFileURL(dbPath).href;
    expect(existsSync(join(dir, 'nested'))).toBe(false);

    const a = await createStore({ driver: 'sqlite', url });
    await a.migrate();
    const id = newId();
    await a.runs.create({ id, principal: 'local' });
    await a.close();
    expect(existsSync(dbPath)).toBe(true);

    const b = await createStore({ driver: 'sqlite', url });
    await b.migrate();
    expect((await b.runs.get(id))?.id).toBe(id);
    await b.close();
  });
});
