import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRedactor, parseConfig, TOOL_NAME_REGEX } from '@qa-brain/core';
import { createGateway, createLogger, type Gateway, isAlive } from '@qa-brain/gateway';
import { createSqliteStore } from '@qa-brain/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS example helper, no type declarations
import { startStaticSite } from '../../../examples/static-site/serve.js';

/**
 * The M0 acceptance test: an MCP client drives a real Chromium through QA Brain and the Playwright MCP
 * child, and every action lands in the SQLite action log.
 *
 * Runs in the `e2e` vitest project (`pnpm smoke`), not in `pnpm test`.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Site {
  url: string;
  close(): Promise<void>;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

function sqliteUrl(dir: string): string {
  return `file:${path.join(dir, 'qa-brain.db').replace(/\\/g, '/')}`;
}

/**
 * Best-effort temp cleanup. On Windows, libsql keeps the database file open until its native handles are
 * collected, so a freshly closed store can still hold the directory (EPERM/EBUSY). Leaving a temp directory
 * behind must never fail the suite.
 */
function removeTemp(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // The OS will reclaim it; the assertions already ran.
  }
}

describe('smoke: gateway to Playwright MCP to Chromium', () => {
  let site: Site;
  let home: string;
  let gateway: Gateway;
  let client: Client;
  let pid: number | null = null;

  beforeAll(async () => {
    site = (await startStaticSite()) as Site;
    home = mkdtempSync(path.join(tmpdir(), 'qa-brain-smoke-'));
    const redactor = createRedactor();
    const config = parseConfig({
      server: { callTimeoutMs: 60_000 },
      log: { level: 'silent' },
      store: { driver: 'sqlite', url: sqliteUrl(home) },
      mcpServers: {
        playwright: { command: 'playwright', adapter: 'playwright', prefix: 'web_', strip: 'browser_' },
      },
    });
    gateway = await createGateway({
      config,
      homeDir: home,
      store: await createSqliteStore({ url: sqliteUrl(home) }),
      logger: createLogger({ level: 'silent', redactor }),
      eraCacheFile: null,
    });
    await gateway.start();
    pid = gateway.upstreams.get('playwright')?.status().pid ?? null;

    const server = gateway.buildServer({ transport: 'inmemory', principal: 'local' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'smoke-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(clientSide);
  }, 180_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await gateway?.close().catch(() => undefined);
    await site?.close();
    removeTemp(home);
  });

  it('spawns the pinned Playwright MCP and reports it healthy', () => {
    const status = gateway.upstreams.get('playwright')?.status();
    expect(status?.state).toBe('healthy');
    expect(status?.serverInfo?.name).toBe('Playwright');
    expect(status?.serverInfo?.version).toBe('1.62.1');
    expect(pid).toBeTypeOf('number');
    expect(isAlive(pid)).toBe(true);
  });

  it('lists a curated, deterministic surface with no RCE-equivalent tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names.length).toBeLessThanOrEqual(25);
    for (const n of names) expect(n).toMatch(TOOL_NAME_REGEX);
    expect(names).toEqual(
      expect.arrayContaining([
        'qa_call_tool',
        'qa_describe_tool',
        'qa_health',
        'qa_run_finish',
        'qa_run_log',
        'qa_run_start',
        'qa_search_tools',
        'web_click',
        'web_navigate',
        'web_snapshot',
        'web_type',
      ]),
    );
    expect(names).not.toContain('web_run_code_unsafe');
    expect(names).not.toContain('web_evaluate');
    expect(names).not.toContain('web_tabs');
  });

  it('drives the browser: navigate, snapshot, click, and the page reacts', async () => {
    const run = await client.callTool({ name: 'qa_run_start', arguments: { name: 'smoke' } });
    const runId = (run.structuredContent as { run_id: string }).run_id;

    const nav = await client.callTool({
      name: 'web_navigate',
      arguments: { url: `${site.url}/index.html`, run_id: runId },
    });
    expect(nav.isError).toBeFalsy();
    expect(textOf(nav as never)).toContain('QA Brain Example Shop');

    const snap = await client.callTool({ name: 'web_snapshot', arguments: { run_id: runId } });
    const snapshot = textOf(snap as never);
    expect(snapshot).toContain('[ref=');
    expect(snapshot).toContain('Add to cart');

    const line = snapshot.split('\n').find((l) => l.includes('Add to cart') && l.includes('[ref='));
    const ref = line ? /\[ref=(e\d+)\]/.exec(line)?.[1] : undefined;
    expect(ref, `no ref for the Add to cart button in:\n${snapshot}`).toBeTruthy();

    const click = await client.callTool({
      name: 'web_click',
      arguments: { element: 'Add to cart button', target: ref, run_id: runId },
    });
    expect(click.isError, textOf(click as never)).toBeFalsy();

    const verify = await client.callTool({
      name: 'web_verify_text_visible',
      arguments: { text: 'Added to cart', run_id: runId },
    });
    expect(verify.isError, textOf(verify as never)).toBeFalsy();

    const finished = await client.callTool({
      name: 'qa_run_finish',
      arguments: { run_id: runId, status: 'passed' },
    });
    const summary = finished.structuredContent as { status: string; errors: number; actions: number };
    expect(summary.status).toBe('passed');
    expect(summary.errors).toBe(0);
    expect(summary.actions).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('records every call in the action log with redacted arguments', async () => {
    const rows = await gateway.store.actionLog.query({ limit: 200 });
    const tools = rows.map((r) => r.tool);
    expect(tools).toContain('web_navigate');
    expect(tools).toContain('web_snapshot');
    expect(tools).toContain('web_click');

    const nav = rows.find((r) => r.tool === 'web_navigate');
    if (!nav) throw new Error(`no web_navigate row in the action log (saw: ${tools.join(', ')})`);
    expect(nav.upstream).toBe('playwright');
    expect(nav.upstreamTool).toBe('browser_navigate');
    expect(nav.isError).toBe(false);
    expect(nav.durationMs).toBeGreaterThan(0);
    expect(nav.resultChars).toBeGreaterThan(0);
    expect(nav.argsShape).toMatchObject({ url: 'string' });
    expect((nav.argsRedacted as { url: string }).url).toContain('/index.html');
    expect(nav.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-\d{2}$/);
  });

  it('refuses the blocked RCE tools even when called explicitly', async () => {
    const blocked = await client.callTool({
      name: 'web_run_code_unsafe',
      arguments: { code: 'process.exit(1)' },
    });
    expect(blocked.isError).toBe(true);
    const viaHelper = await client.callTool({
      name: 'qa_call_tool',
      arguments: { name: 'web_evaluate', arguments: { function: '() => 1' } },
    });
    expect(viaHelper.isError).toBe(true);
  });

  it('leaves no orphaned browser process after shutdown', async () => {
    await client.close();
    await gateway.close();
    await new Promise((r) => setTimeout(r, 1500));
    expect(isAlive(pid)).toBe(false);
  }, 60_000);
});

describe('smoke: the built CLI binary over stdio', () => {
  let site: Site;
  let home: string;

  beforeAll(async () => {
    site = (await startStaticSite()) as Site;
    home = mkdtempSync(path.join(tmpdir(), 'qa-brain-cli-'));
  });

  afterAll(async () => {
    await site?.close();
    removeTemp(home);
  });

  it('serves MCP over stdio from dist/cli.js and exits cleanly', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(REPO_ROOT, 'apps/qa-brain/dist/cli.js'),
        'serve',
        '--transport',
        'stdio',
        '--log-level',
        'silent',
      ],
      env: { ...process.env, QA_BRAIN_HOME: home } as Record<string, string>,
      cwd: home,
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'cli-smoke', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(transport);
    const cliPid = transport.pid;

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('web_navigate');

    // browser_navigate answers with a page summary (title, URL, links to artifacts); the accessibility tree
    // with [ref=eN] targets comes from browser_snapshot. Assert both so the whole path is covered.
    const nav = await client.callTool({ name: 'web_navigate', arguments: { url: `${site.url}/about.html` } });
    expect(nav.isError).toBeFalsy();
    expect(textOf(nav as never)).toContain('About — QA Brain Example Shop');

    const snap = await client.callTool({ name: 'web_snapshot', arguments: {} });
    const snapshot = textOf(snap as never);
    expect(snapshot).toContain('About this example');
    expect(snapshot).toContain('[ref=');

    await client.close();
    await new Promise((r) => setTimeout(r, 2000));
    expect(isAlive(cliPid)).toBe(false);
  }, 180_000);
});
