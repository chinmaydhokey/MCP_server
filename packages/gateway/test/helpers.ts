import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, Server } from '@modelcontextprotocol/server';
import type { Transport } from '@modelcontextprotocol/client';
import { type QaBrainConfigInput, TOOL_NAME_REGEX, createRedactor, parseConfig } from '@qa-brain/core';
import { createSqliteStore } from '@qa-brain/store';
import { type Gateway, createGateway, createLogger } from '../src/index.js';

export interface FakeUpstream {
  calls: Array<{ name: string; args: unknown; meta: unknown }>;
  transportFactory: () => Transport;
  servers: Server[];
}

/** A fake "Playwright MCP" with a handful of tools, served over InMemoryTransport. */
export function fakeUpstream(opts: { tools?: string[]; onCall?: (name: string, args: Record<string, unknown>) => unknown } = {}): FakeUpstream {
  const tools = opts.tools ?? [
    'browser_click',
    'browser_snapshot',
    'browser_navigate',
    'browser_tabs',
    'browser_run_code_unsafe',
    'browser_evaluate',
    'browser_generate_locator',
  ];
  const calls: FakeUpstream['calls'] = [];
  const servers: Server[] = [];
  return {
    calls,
    servers,
    transportFactory: () => {
      const server = new Server({ name: 'FakePlaywright', version: '1.62.1' }, { capabilities: { tools: {} } });
      server.setRequestHandler('tools/list', async () => ({
        tools: tools.map((name) => ({
          name,
          description: `fake ${name}`,
          inputSchema: { type: 'object', properties: { target: { type: 'string' }, password: { type: 'string' } }, additionalProperties: true },
        })),
      }));
      server.setRequestHandler('tools/call', async (req, ctx) => {
        const args = (req.params.arguments ?? {}) as Record<string, unknown>;
        calls.push({ name: req.params.name, args, meta: req.params._meta ?? ctx.mcpReq._meta });
        const custom = opts.onCall?.(req.params.name, args);
        if (custom instanceof Promise) {
          const out = await Promise.race([
            custom,
            new Promise((_, reject) => ctx.mcpReq.signal.addEventListener('abort', () => reject(new Error('aborted')))),
          ]);
          return out as never;
        }
        if (custom !== undefined) return custom as never;
        return { content: [{ type: 'text', text: `ok:${req.params.name}:${JSON.stringify(args)}` }] };
      });
      servers.push(server);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      void server.connect(serverSide);
      return clientSide;
    },
  };
}

export async function testGateway(input: {
  upstream: FakeUpstream;
  config?: Partial<QaBrainConfigInput>;
  mcpServers?: QaBrainConfigInput['mcpServers'];
}): Promise<Gateway> {
  const redactor = createRedactor(['hunter2-secret']);
  const logger = createLogger({ level: 'silent', redactor });
  const store = await createSqliteStore({ url: ':memory:' });
  const config = parseConfig({
    ...input.config,
    server: { callTimeoutMs: 1_000, maxResultChars: 5_000, ...(input.config?.server ?? {}) },
    mcpServers: input.mcpServers ?? {
      playwright: {
        command: 'fake',
        adapter: 'playwright',
        prefix: 'web_',
        strip: 'browser_',
        tools: {
          allow: ['browser_click', 'browser_snapshot', 'browser_navigate', 'browser_generate_locator'],
          hidden: ['browser_tabs'],
          block: ['browser_run_code_unsafe', 'browser_evaluate'],
        },
      },
    },
  });
  const gateway = await createGateway({
    config,
    homeDir: '.qa-brain-test',
    logger,
    store,
    secrets: ['hunter2-secret'],
    eraCacheFile: null,
    transportFactories: { playwright: input.upstream.transportFactory },
  });
  await gateway.start();
  return gateway;
}

/** Connects an MCP client to the gateway over an in-memory pair. */
export async function connectClient(gateway: Gateway): Promise<Client> {
  const server = gateway.buildServer({ transport: 'inmemory', principal: 'local' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(clientSide);
  return client;
}

export function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

export { TOOL_NAME_REGEX };
