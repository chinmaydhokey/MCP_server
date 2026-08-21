# ADR-0001: Build QA Brain as an MCP gateway on the TypeScript SDK v2 low-level `Server`

QA Brain is one Node process that is an MCP server toward the LLM host and one MCP client per upstream (Playwright MCP now, appium-mcp later). The server side uses the low-level `Server` from `@modelcontextprotocol/server@2.0.0` with explicit `tools/list` and `tools/call` handlers forwarding to upstream `Client` instances; native `qa_*` tools are declared with Zod 4 schemas converted to JSON Schema and dispatched by the same router. This ADR records why `McpServer`/`registerTool` alone, in-process Playwright embedding, and existing open-source gateways were rejected, and fixes two sub-decisions: the Playwright pin and the SQLite driver.

## Status

Accepted — 2026-08-20

## Context

The gateway layer is the project's contribution; "LLM host plus Playwright MCP" already exists. The missing process curates the tool surface, records every action, mints handles, and later hosts healing, impact analysis, and parity. It must speak 2026-07-28 downstream while Playwright MCP 1.62.1 and every known mobile MCP remain legacy-era upstreams ([ADR-0003](./0003-target-mcp-2026-07-28-dual-era.md)).

SDK v2 (`@modelcontextprotocol/{server,client,core,node}@2.0.0`, Zod 4.4.3) documents the low-level `Server` as the path for "Proxies/Gateways: forward requests unchanged to upstream servers", even though the class is tagged `@deprecated` to steer ordinary servers toward `McpServer` ([low-level server](https://ts.sdk.modelcontextprotocol.io/v2/advanced/low-level-server.html), [gateway page](https://ts.sdk.modelcontextprotocol.io/v2/advanced/gateway.html)).

## Decision

1. `packages/gateway` builds `new Server(...)` and installs `setRequestHandler('tools/list')` and `setRequestHandler('tools/call')`. The verified handler context exposes `ctx.mcpReq.{id, method, _meta, signal, send, notify, requestState}` and `ctx.http?.authInfo`. `ServerOptions.cacheHints = {'tools/list': {ttlMs: 300000, cacheScope: 'public'}}` supplies the 2026-era cache fields.
2. Native tools (`qa_health`, `qa_run_start`, `qa_run_finish`, `qa_run_log`, `qa_search_tools`, `qa_describe_tool`, `qa_call_tool`, hidden stubs) use a `defineNativeTool()` helper: Zod 4 input schema, `z.toJSONSchema()` for the wire `inputSchema`, and a handler. They share the `ToolRegistry` with proxied tools, so one list path and one call path serve both; `registerTool` is not used.
3. Each upstream is a `Client` from `@modelcontextprotocol/client@2.0.0` over `StdioClientTransport` (`@modelcontextprotocol/client/stdio`), owned by a module-scope `UpstreamManager`. Forwarding is `client.callTool({name, arguments}, {signal, timeout: 60000, resetTimeoutOnProgress: true, maxTotalTimeout: 300000})`; `content`, `structuredContent`, `isError`, and `_meta` pass through unchanged.
4. **Playwright pin.** `playwright@1.62.1` is a dependency of `@qa-brain/adapter-playwright`; the bundled server is launched as `node <dir of require.resolve('playwright/package.json')>/cli.js mcp --headless --isolated --caps=testing --snapshot-mode=full --image-responses=omit --codegen none --output-dir <QA_BRAIN_HOME>/pw-out --timeout-action 10000 --timeout-navigation 30000`. `@playwright/mcp@0.0.79` was rejected because it depends on `playwright@1.63.0-alpha-2026-08-05` and would pull a second browser revision ([registry](https://registry.npmjs.org/@playwright/mcp/latest)). The verified spawn reports `serverInfo {name: "Playwright", version: "1.62.1"}`, connects in about 700 ms, and lists 29 tools.
5. **SQLite driver.** `@libsql/client@0.17.4` via `drizzle-orm/libsql`; `better-sqlite3@13.0.3` was rejected (no prebuilt binary for Node 24 on Windows, needs Visual Studio). See [ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md).

## Consequences

**Positive.** One code path handles both eras and both tool kinds; the registry is plain data, so curation and collision checks are unit-testable without transports. Byte-faithful forwarding preserves Playwright's `[ref=eN]` contract, and the subprocess boundary keeps `browser_run_code_unsafe`, which is RCE-equivalent in the Playwright server process ([config docs](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/tools/mcp/config.d.ts)), out of the gateway process.

**Negative.** Handler exceptions become `-32603` unless we return `isError`, so the router must wrap every timeout, degraded-upstream, and protocol failure into `isError` text with a recovery hint. We own JSON Schema generation and output validation instead of inheriting them from `registerTool`, and the `@deprecated` tag may disappear in a future major.

**Neutral.** About 700 ms startup and one JSON-RPC hop per call are negligible against 5–60 s browser actions; in-process embedding via Playwright's `createConnection()` stays possible behind the same `UpstreamAdapter` interface.

## Alternatives considered

- **`McpServer` + `registerTool` only.** Cannot express a forwarded, curated registry; precedence when mixing `registerTool` with low-level overrides is undocumented.
- **Embed the Playwright library directly.** Re-implements the 29-tool surface Microsoft revises monthly, breaks schema parity with appium-mcp (a separate process regardless), and runs page JavaScript inside the gateway.
- **sparfenyuk/mcp-proxy** (Python 0.12.0): transport bridge, no filtering, audit, or health restart ([README](https://github.com/sparfenyuk/mcp-proxy/blob/main/README.md)). **punkpeye/mcp-proxy**: cannot relay elicitation, no 2026-07-28 over stdio ([README](https://github.com/punkpeye/mcp-proxy)).
- **MetaMCP**: Docker-first, `{ServerName}__{tool}` renaming, per-machine rate limits ([docs](https://docs.metamcp.com/en/concepts/namespaces)).
- **IBM ContextForge 1.0.8**: Python ≥3.12, 300+ environment variables, breaking releases about every two weeks, stateful sessions shipped disabled ([releases](https://github.com/IBM/mcp-context-forge/releases)).
- **Docker MCP Gateway v0.43.1**: container-per-server, Docker Desktop-centric; its hardening checklist is adopted as a reference ([release](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1)).

None combines curated naming, handles, an action log, dual-era negotiation, and Windows stdio hygiene.

## References

- SDK v2 package split: <https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html>
- MCP tools page (proxy prefixing, `ttlMs`/`cacheScope`): <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Playwright MCP flags and tools: <https://github.com/microsoft/playwright-mcp>
- Related: [ADR-0002](./0002-typescript-monorepo-pnpm-node22-esm.md), [ADR-0004](./0004-tool-namespacing-and-curated-surface.md), [ARCHITECTURE.md](../../ARCHITECTURE.md)
