import { type ActionLogRow, newId, type StoreAdapter } from '@qa-brain/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgStore } from '../src/index.js';

/**
 * Runs only when `QA_BRAIN_PG_URL` points at a disposable Postgres database, e.g.
 * `QA_BRAIN_PG_URL=postgres://qa:qa@localhost:5432/qa_brain_test pnpm --filter @qa-brain/store test`.
 * The suite applies the committed migrations and leaves its rows behind (use a throwaway DB).
 */
const PG_URL = process.env.QA_BRAIN_PG_URL;

describe.skipIf(!PG_URL)('pg adapter', () => {
  let store: StoreAdapter;

  beforeAll(async () => {
    store = await createPgStore({ url: PG_URL as string, poolMax: 2 });
    await store.migrate();
  });

  afterAll(async () => {
    await store?.close();
  });

  it('pings and migrates idempotently', async () => {
    expect(store.driver).toBe('pg');
    expect(await store.ping()).toBe(true);
    await expect(store.migrate()).resolves.toBeUndefined();
  });

  it('action log insert / query / count', async () => {
    const runId = newId();
    const row: ActionLogRow = {
      id: newId(),
      tsStart: Date.now(),
      durationMs: 5,
      runId,
      transport: 'http',
      protocolEra: 'modern',
      principal: 'key_1',
      upstream: 'playwright',
      tool: 'web_snapshot',
      upstreamTool: 'browser_snapshot',
      argsShape: {},
      argsRedacted: null,
      argsHash: 'h',
      isError: true,
      errorCode: 'upstream_error',
      errorMessage: 'boom',
      resultChars: 0,
      resultKinds: '',
      resultDigest: null,
      traceparent: '00-abc-def-01',
      clientName: null,
    };
    await store.actionLog.insert(row);
    const [got] = await store.actionLog.query({ runId });
    expect(got).toEqual(row);
    expect(await store.actionLog.count(runId)).toEqual({ total: 1, errors: 1 });
  });

  it('runs create / finish / get', async () => {
    const id = newId();
    const run = await store.runs.create({ id, name: 'pg', principal: 'key_1', meta: { x: true } });
    expect(run.status).toBe('running');
    expect(run.meta).toEqual({ x: true });
    const done = await store.runs.finish(id, { status: 'failed', summary: { failed: 1 } });
    expect(done?.status).toBe('failed');
    expect(typeof done?.finishedAt).toBe('number');
    expect(await store.runs.get(id)).toEqual(done);
  });

  it('handles mint / resolve / revoke / sweep', async () => {
    const rec = await store.handles.mint('browser', 'key_1', 60_000, { ctx: 1 });
    expect((await store.handles.resolve(rec.handle, 'key_1'))?.state).toEqual({ ctx: 1 });
    expect(await store.handles.resolve(rec.handle, 'key_2')).toBeNull();
    await store.handles.revoke(rec.handle);
    expect(await store.handles.resolve(rec.handle, 'key_1')).toBeNull();
    const dead = await store.handles.mint('snapshot', 'key_1', 0);
    expect(await store.handles.sweep(Date.now() + 1)).toBeGreaterThanOrEqual(1);
    expect(await store.handles.resolve(dead.handle, 'key_1')).toBeNull();
  });
});
