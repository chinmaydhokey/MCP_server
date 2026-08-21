import { CLIENT_INFO_META_KEY, Server } from '@modelcontextprotocol/server';
import type { QaBrainConfig } from '@qa-brain/core';
import { VERSION } from '@qa-brain/core';
import { traceContextFromMeta } from '../otel.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { Router } from '../router/router.js';

export interface BuildServerInput {
  registry: ToolRegistry;
  router: Router;
  config: QaBrainConfig;
  transport: 'stdio' | 'http' | 'inmemory';
  /** Verified principal (bearer subject) or `local` for stdio. */
  principal: string;
  /** Era reported by serveStdio/createMcpHandler; unknown for raw in-memory connects. */
  era?: 'legacy' | 'modern';
}

/**
 * Builds one low-level MCP `Server` wired to the shared registry and router.
 *
 * One instance per stdio connection or per HTTP request (createMcpHandler builds a fresh server each time);
 * all state lives in the gateway core, never in the server instance.
 */
export function buildServer(input: BuildServerInput): Server {
  const { registry, router, config } = input;
  const server = new Server(
    { name: config.server.name, version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: config.server.instructions ?? DEFAULT_INSTRUCTIONS,
      cacheHints: { 'tools/list': { ttlMs: registry.ttlMs, cacheScope: 'public' } },
    },
  );

  server.setRequestHandler('tools/list', async () => ({ tools: registry.list() as never }));

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const meta = (request.params._meta ?? ctx.mcpReq._meta) as Record<string, unknown> | undefined;
    const modernClient = meta?.[CLIENT_INFO_META_KEY] as { name?: string } | undefined;
    const clientName = modernClient?.name ?? server.getClientVersion()?.name ?? null;
    const era = input.era ?? (server.getNegotiatedProtocolVersion() ? 'legacy' : null);
    const result = await router.call({
      name: request.params.name,
      args: request.params.arguments,
      meta,
      signal: ctx.mcpReq.signal,
      ctx: {
        principal: input.principal,
        runId: null,
        trace: traceContextFromMeta(meta),
        transport: input.transport,
        protocolEra: era,
        clientName,
        depth: 0,
      },
    });
    return result as never;
  });

  return server;
}

export const DEFAULT_INSTRUCTIONS = [
  'QA Brain is a testing gateway. Tools prefixed web_ drive a real browser through Playwright MCP;',
  'tools prefixed qa_ manage runs, discovery and health.',
  'Workflow: qa_run_start → web_navigate → web_snapshot (use [ref=eN] targets) → actions → web_verify_* → qa_run_finish.',
  'Prefer web_snapshot/web_find over screenshots for choosing targets. Refs expire after navigation: re-snapshot.',
  'If a tool reports upstream_unavailable, call qa_health and retry after the suggested delay.',
  'Hidden tools (tabs, network requests, locator generation, drag/drop, uploads) are reachable via qa_search_tools → qa_call_tool.',
].join(' ');
