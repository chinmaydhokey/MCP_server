# ADR-0003: Target MCP 2026-07-28 with a dual-era server and a dual-era client

QA Brain serves the stateless 2026-07-28 revision to LLM hosts while still accepting legacy (2025-11-25 and earlier) clients, and connects to upstreams in automatic era negotiation because every browser and mobile MCP available today is legacy-era. This ADR fixes the transport entry points, upstream negotiation and era caching, the deprecated features never built on, and the stance on Multi Round-Trip Requests (MRTR) and Tasks.

## Status

Accepted — 2026-08-20

## Context

The 2026-07-28 revision removed the `initialize` handshake, sessions and `Mcp-Session-Id`, the GET SSE stream, `ping`, and `logging/setLevel`; it added a mandatory `server/discover`, per-request `_meta` version and capabilities, required `ttlMs`/`cacheScope`, MRTR (`resultType: 'input_required'`) instead of server-initiated requests, and moved Tasks into the extension `io.modelcontextprotocol/tasks` ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Roots, Sampling, Logging, the 2024-11-05 HTTP+SSE transport, and OAuth Dynamic Client Registration are deprecated with a 12-month minimum window (SEP-2577, SEP-2596).

In the spec's era model a dual-era server picks behavior from how the client opens, a dual-era client probes `server/discover` then falls back to `initialize`, and "era verdicts SHOULD be cached per server process/origin" ([versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)).

Verified for `@modelcontextprotocol/*@2.0.0`: `LATEST_PROTOCOL_VERSION` is `'2025-11-25'` in the legacy handshake list; the modern revision is served only by `serveStdio(factory, {legacy})` and `createMcpHandler(factory, {legacy})`; plain `server.connect(InMemoryTransport)` is legacy. Playwright 1.62.1's `playwright mcp` negotiates `2025-11-25`; `appium-mcp` 1.92 and `@mobilenext/mobile-mcp` 1.0.2 still depend on `@modelcontextprotocol/sdk` 1.x.

## Decision

1. **Downstream.** stdio: `serveStdio(() => buildServer(deps), {legacy: 'serve'})` from `@modelcontextprotocol/server/stdio`, with pino and `console` bound to stderr. HTTP: `createMcpHandler(({era, authInfo}) => buildServer({...deps, authInfo}), {legacy: 'stateless'})` mounted via `toNodeHandler` from `@modelcontextprotocol/node` with host/origin validation. A fresh server instance is built per HTTP request; upstreams, store, and handles live in module scope.
2. **Upstream.** `new Client(info, {versionNegotiation: {mode: 'auto'}})`; `client.connect(transport, {prior})` where `prior` (`{kind: 'modern', discover}` or `{kind: 'legacy'}`) comes from the era cache `<QA_BRAIN_HOME>/era-cache.json`, keyed by `sha256(command, args, sorted env keys, adapter version)`. `client.getProtocolEra()` is recorded in `action_log.protocol_era`; `EraNegotiationFailed` evicts the cache entry and reconnects with plain `auto`. Upstreams are never pinned to `'2026-07-28'`.
3. **Health probes follow era.** `server/discover` for modern upstreams, `client.ping()` for legacy ones (60 s interval, 5 s timeout, 3 strikes).
4. **Never built on.** Roots (paths and URLs are tool parameters), Sampling (healing calls the provider through `LlmDriver`), Logging (pino to stderr plus OpenTelemetry; no `notifications/message`), HTTP+SSE (v2 never serves it; `@modelcontextprotocol/server-legacy` is not a dependency), and DCR (hosted auth uses pre-registration or Client ID Metadata Documents, [ADR-0012](./0012-auth-api-keys-first-oauth21-resource-server-later.md)).
5. **MRTR.** No M0 tool returns `input_required`. The router strips `inputResponses` and `requestState` at the routing boundary and forwards only `traceparent`, `tracestate`, `baggage`, and the SDK's protocol `_meta` keys; upstream elicitation requests are declined in headless mode. A future tool needing a human returns `input_required` with a sealed `requestState` (HMAC bound to principal, TTL, request digest), never a server-initiated request.
6. **Tasks.** `qa_run_suite` (M5) returns `CreateTaskResult {resultType: 'task', taskId: run_id, status: 'working', ttlMs: 86400000, pollIntervalMs: 2000}` only when the request's `_meta` client capabilities declare `io.modelcontextprotocol/tasks`; `tasks/get`, `tasks/update`, and `tasks/cancel` map to the `task` table whose `id` equals `run.id`. Other clients get an inline result with `notifications/progress`.
7. **Cancellation.** A closed downstream HTTP stream aborts `ctx.mcpReq.signal`; the router aborts `callTool`, and the SDK client sends `notifications/cancelled` to the stdio child.

## Consequences

**Positive.** Claude Code, Cursor, and Codex work today in legacy mode and switch to modern without a QA Brain change. Hosted mode is stateless per request ([ADR-0005](./0005-server-minted-handles-not-sessions.md)). When Playwright moves to SDK v2, the next connect negotiates modern.

**Negative.** Two eras must stay correct; unit tests run a fake upstream through `InMemoryTransport` in both. Forwarding a renamed tool to a modern HTTP upstream means regenerating `Mcp-Method` and `Mcp-Name` headers or receiving `-32020 HeaderMismatch`. A dropped HTTP stream loses the in-flight request by design, so long actions must be idempotent or task-backed.

**Neutral.** `ttlMs: 300000` and `cacheScope: 'public'` on `tools/list` are emitted in both eras; legacy clients ignore them.

## Alternatives considered

- **Modern-only server (`legacy: 'reject'`).** Breaks every current host; kept as a config option.
- **Legacy-only server on `@modelcontextprotocol/sdk` 1.30.0.** Maintenance-only line; reaching stateless HTTP would mean a rewrite.
- **Pin upstream clients to `'legacy'`.** Works today but forgoes `server/discover` when Playwright moves; `auto` with caching costs one probe per process.
- **Open SSE streams for long runs instead of Tasks.** Contradicts the "broken stream loses the request" rule; a durable `task` row survives reconnects.

## References

- Changelog: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Versioning and eras: <https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning>
- Streamable HTTP and stdio: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>, <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio>
- MRTR: <https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr>; Tasks: <https://modelcontextprotocol.io/extensions/tasks/overview>
- SDK serving, legacy clients, client connect: <https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html>, <https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html>, <https://ts.sdk.modelcontextprotocol.io/v2/clients/connect.html>
- `@playwright/mcp` 0.0.79 on the v1 SDK: <https://registry.npmjs.org/@playwright/mcp/latest>
- Related: [ADR-0001](./0001-gateway-on-mcp-sdk-v2-low-level-server.md), [observability.md](../observability.md)
