import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Gateway } from '../src/index.js';
import { ACTION_LOG_ID_META_KEY } from '../src/index.js';
import {
  connectClient,
  type FakeUpstream,
  fakeUpstream,
  TOOL_NAME_REGEX,
  testGateway,
  text,
} from './helpers.js';

describe('gateway end-to-end (in-memory upstream)', () => {
  let upstream: FakeUpstream;
  let gateway: Gateway;
  let client: Client;

  beforeEach(async () => {
    upstream = fakeUpstream();
    gateway = await testGateway({ upstream });
    client = await connectClient(gateway);
  });
  afterEach(async () => {
    await client.close();
    await gateway.close();
  });

  it('lists a curated, sorted surface with valid names and no blocked tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('web_click');
    expect(names).toContain('web_snapshot');
    expect(names).toContain('qa_health');
    expect(names).toContain('qa_call_tool');
    expect(names).not.toContain('web_run_code_unsafe');
    expect(names).not.toContain('web_evaluate');
    expect(names).not.toContain('web_tabs'); // hidden
    expect(names).not.toContain('qa_test_save'); // stub, hidden by default
    expect(names.length).toBeLessThanOrEqual(25);
    for (const n of names) expect(n).toMatch(TOOL_NAME_REGEX);
    const click = tools.find((t) => t.name === 'web_click');
    expect(click?.description).toBe('fake browser_click');
  });

  it('proxies a call, forwards trace context, passes the result through and logs a redacted row', async () => {
    const result = await client.callTool({
      name: 'web_click',
      arguments: { target: 'e12', password: 'hunter2-secret' },
      _meta: { traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' } as never,
    });
    expect(result.isError).toBeFalsy();
    expect(text(result as never)).toContain('ok:browser_click');
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.name).toBe('browser_click');
    expect(upstream.calls[0]?.args).toEqual({ target: 'e12', password: 'hunter2-secret' });
    const meta = upstream.calls[0]?.meta as Record<string, string>;
    expect(meta.traceparent).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/);
    expect((result._meta as Record<string, unknown>)[ACTION_LOG_ID_META_KEY]).toBeTypeOf('string');

    const rows = await gateway.store.actionLog.query({ tool: 'web_click' });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.upstream).toBe('playwright');
    expect(row?.upstreamTool).toBe('browser_click');
    expect(row?.isError).toBe(false);
    expect(row?.traceparent).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(row?.argsShape).toEqual({ target: 'string', password: 'string' });
    expect(JSON.stringify(row?.argsRedacted)).not.toContain('hunter2');
    expect(row?.clientName).toBe('test-client');
  });

  it('refuses blocked and unknown tools with structured errors (and logs them)', async () => {
    const blocked = await client.callTool({ name: 'web_run_code_unsafe', arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(text(blocked as never)).toContain('blocked_tool');
    const unknown = await client.callTool({ name: 'web_nope', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(text(unknown as never)).toContain('unknown_tool');
    expect(upstream.calls).toHaveLength(0);
    const rows = await gateway.store.actionLog.query({});
    expect(rows.map((r) => r.errorCode).sort()).toEqual(['blocked_tool', 'unknown_tool']);
  });

  it('groups actions into runs and exposes run history', async () => {
    const started = await client.callTool({ name: 'qa_run_start', arguments: { name: 'smoke' } });
    const runId = (started.structuredContent as { run_id: string }).run_id;
    expect(runId).toMatch(/^rn_/);
    await client.callTool({
      name: 'web_navigate',
      arguments: { url: 'https://example.test', run_id: runId },
    });
    await client.callTool({
      name: 'web_click',
      arguments: { target: 'e1' },
      _meta: { 'in.qabrain/runId': runId } as never,
    });
    const log = await client.callTool({ name: 'qa_run_log', arguments: { run_id: runId } });
    const actions = (log.structuredContent as { actions: Array<{ tool: string }> }).actions;
    expect(actions.map((a) => a.tool)).toEqual(['web_click', 'web_navigate']);
    const finished = await client.callTool({
      name: 'qa_run_finish',
      arguments: { run_id: runId, status: 'passed' },
    });
    const summary = finished.structuredContent as { actions: number; errors: number; status: string };
    expect(summary.status).toBe('passed');
    expect(summary.actions).toBe(3); // navigate + click + qa_run_log (finish is logged after counting)
    expect(summary.errors).toBe(0);
    const again = await client.callTool({
      name: 'qa_run_finish',
      arguments: { run_id: runId, status: 'passed' },
    });
    expect(again.isError).toBe(true); // handle revoked
  });

  it('discovers hidden tools and calls them through qa_call_tool, still refusing blocked ones', async () => {
    const search = await client.callTool({ name: 'qa_search_tools', arguments: { query: 'tabs' } });
    const found = (
      search.structuredContent as { tools: Array<{ name: string; listed: boolean; callable: boolean }> }
    ).tools;
    expect(found.some((t) => t.name === 'web_tabs' && !t.listed && t.callable)).toBe(true);
    const describe = await client.callTool({ name: 'qa_describe_tool', arguments: { name: 'web_tabs' } });
    expect((describe.structuredContent as { inputSchema: unknown }).inputSchema).toBeTruthy();
    const viaCall = await client.callTool({
      name: 'qa_call_tool',
      arguments: { name: 'web_tabs', arguments: { action: 'list' } },
    });
    expect(viaCall.isError).toBeFalsy();
    expect(upstream.calls.at(-1)?.name).toBe('browser_tabs');
    const blocked = await client.callTool({
      name: 'qa_call_tool',
      arguments: { name: 'web_run_code_unsafe', arguments: {} },
    });
    expect(blocked.isError).toBe(true);
    const direct = await client.callTool({ name: 'web_tabs', arguments: {} });
    expect(direct.isError).toBeFalsy(); // hidden tools are callable directly too; just not advertised
  });

  it('reports health with upstream state and era', async () => {
    const health = await client.callTool({ name: 'qa_health', arguments: {} });
    const h = health.structuredContent as {
      ok: boolean;
      upstreams: Array<{ id: string; state: string; era: string; toolCount: number }>;
    };
    expect(h.ok).toBe(true);
    expect(h.upstreams[0]).toMatchObject({ id: 'playwright', state: 'healthy', era: 'legacy', toolCount: 7 });
  });

  it('validates native tool arguments', async () => {
    const r = await client.callTool({
      name: 'qa_run_finish',
      arguments: { run_id: 'nope', status: 'passed' },
    });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('invalid_args');
  });
});

describe('gateway resilience', () => {
  it('caps oversized results with a marker', async () => {
    const upstream = fakeUpstream({
      onCall: () => ({ content: [{ type: 'text', text: 'x'.repeat(20_000) }] }),
    });
    const gateway = await testGateway({ upstream });
    const client = await connectClient(gateway);
    const r = await client.callTool({ name: 'web_snapshot', arguments: {} });
    const t = text(r as never);
    expect(t.length).toBeLessThanOrEqual(5_000 + 200);
    expect(t).toContain('[truncated');
    const rows = await gateway.store.actionLog.query({ tool: 'web_snapshot' });
    expect(rows[0]?.resultChars).toBeLessThanOrEqual(5_200);
    await client.close();
    await gateway.close();
  });

  it('turns upstream timeouts into isError results with a hint', async () => {
    const upstream = fakeUpstream({ onCall: () => new Promise(() => undefined) });
    const gateway = await testGateway({ upstream, config: { server: { callTimeoutMs: 300 } } });
    const client = await connectClient(gateway);
    const r = await client.callTool({ name: 'web_click', arguments: { target: 'e1' } });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('timeout');
    const rows = await gateway.store.actionLog.query({ tool: 'web_click' });
    expect(rows[0]?.errorCode).toBe('timeout');
    await client.close();
    await gateway.close();
  });

  it('answers with upstream_unavailable (not a protocol error) when the upstream is down', async () => {
    const upstream = fakeUpstream();
    const gateway = await testGateway({ upstream });
    const client = await connectClient(gateway);
    await gateway.upstreams.get('playwright')?.stop();
    const { tools } = await client.listTools();
    expect(tools.some((t) => t.name === 'web_click')).toBe(true); // names never disappear
    const r = await client.callTool({ name: 'web_click', arguments: { target: 'e1' } });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('upstream_unavailable');
    await client.close();
    await gateway.close();
  });

  it('fails fast on tool-name collisions', async () => {
    const upstream = fakeUpstream({ tools: ['health'] });
    await expect(
      testGateway({
        upstream,
        mcpServers: {
          playwright: { command: 'fake', adapter: 'generic', prefix: 'qa_', tools: { allow: ['health'] } },
        },
      }),
    ).rejects.toThrow(/collision/);
  });
});
