# ADR-0013: Observability via OpenTelemetry GenAI MCP semantic conventions and `_meta.traceparent`

Every proxied or native tool call is a span named and attributed per the OpenTelemetry GenAI MCP semantic conventions, correlated with a pino log line and an `action_log` row through one `trace_id`. Trace context travels in the request `_meta` keys `traceparent`/`tracestate`/`baggage` as the MCP 2026-07-28 spec documents, from the LLM client through the gateway into the Playwright or Appium child. Spans are hand-rolled in `packages/gateway/src/otel.ts` on `@opentelemetry/sdk-trace-node` 2.x; export is off by default (`QA_BRAIN_OTEL_EXPORTER=none`) and OTLP in the compose stack.

## Status

Accepted — 2026-08-20

## Context

- The 2026-07-28 spec deprecates MCP Logging in favor of stderr and OpenTelemetry, and formalizes W3C trace context in `_meta` (`traceparent`, `tracestate`, `baggage`, SEP-414) ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). TS SDK v2 exports `TRACEPARENT_META_KEY`, `TRACESTATE_META_KEY`, `BAGGAGE_META_KEY` (verified in M0 spikes).
- MCP semantic conventions (status *Development*) live in `open-telemetry/semantic-conventions-genai`: span name `"{mcp.method.name} {gen_ai.tool.name}"`, CLIENT span on the caller, SERVER span on the receiver; required `mcp.method.name`; conditionally required `error.type`, `jsonrpc.request.id`, `rpc.response.status_code`; recommended `mcp.protocol.version`, `network.transport` (`pipe`/`tcp`), `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`; opt-in `gen_ai.tool.call.arguments`/`result`; metrics `mcp.{client,server}.operation.duration` ([mcp.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md)).
- `@opentelemetry/sdk-trace-node` is 2.8.x while `sdk-node` and auto-instrumentations are still 0.x/experimental; `@arizeai/openinference-instrumentation-mcp` 0.2.4 targets the v1 SDK layout ([npm](https://www.npmjs.com/package/@arizeai/openinference-instrumentation-mcp)).
- `appium-mcp` emits its own spans when `APPIUM_MCP_OTEL_ENABLED=true` ([appium-mcp](https://github.com/appium/appium-mcp)), so context must be propagated, not re-created. [ADR-0011](./0011-security-posture-default-deny-no-passthrough-egress-control.md)'s argument-shape rule binds spans and logs alike.

## Decision

**Spans.** One SERVER span per inbound `tools/call` (`tools/call web_click`), one CLIENT span per upstream `callTool` (`tools/call browser_click`), internal spans `qa_brain.heal`, `qa_brain.tia.select`, `qa_brain.llm.call`. Attributes:

| Attribute | Source |
|---|---|
| `mcp.method.name`, `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name` | router |
| `mcp.protocol.version`, `network.transport=pipe\|tcp`, `jsonrpc.request.id`, `rpc.response.status_code`, `error.type` | transport/era cache |
| `qa_brain.project_id`, `qa_brain.run_id`, `qa_brain.test_id`, `qa_brain.step_id`, `qa_brain.upstream` (`web\|mobile\|db`), `qa_brain.heal.tier`, `qa_brain.heal.outcome` | handles and native tools |
| `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | LlmDriver ([ADR-0014](./0014-provider-agnostic-llm-runner.md)) |

`gen_ai.tool.call.arguments`/`result` are never set; the collector's `attributes` processor deletes them defensively unless `QA_BRAIN_TRACE_ARGS=1`.

**Propagation.** Inbound `_meta.traceparent/tracestate/baggage` are extracted with the W3C propagator; absent, the router mints a root span. The current context is injected into `_meta` of every upstream `callTool`; `run_id` rides in `baggage`. Other inbound `_meta` keys, except the SDK protocol keys, are dropped.

**Metrics** (OTel SDK → collector → Prometheus `:8889`): `mcp.server.operation.duration`, `mcp.client.operation.duration` (+`qa_brain.upstream`), `qa_brain.tool.calls`, `qa_brain.heal.attempts` (`tier`, `outcome=success|rejected|no_candidate`), `qa_brain.run.duration`, `gen_ai.client.token.usage`, `qa_brain.llm.cost_usd`, `qa_brain.upstream.restarts`, `qa_brain.queue.depth`.

**Logs.** pino 10 JSON to stderr (stdio) or stdout (HTTP): `time, level, msg, trace_id, span_id, run_id, project_id, tool, upstream, duration_ms`; `redact: ['req.headers.authorization', '*.password', '*.token', '*.apiKey', '*.secret', 'env.*']` plus a serializer replacing tool arguments with `argsShape()` output. Level from `QA_BRAIN_LOG_LEVEL`.

**Correlation.** `action_log.traceparent` stores the SERVER span's W3C header (`trace_id` = characters 3–34). `qa_run_log` returns it per row; reports render `/trace/<trace_id>` deep links into Jaeger (dev) or Tempo + Grafana (prod).

**Exporters and topology.** `QA_BRAIN_OTEL_EXPORTER=none` (default; a no-op tracer keeps one code path) or `otlp` → `@opentelemetry/exporter-{trace,metrics}-otlp-http` to `otel-collector:4318`. `deploy/otel/collector.yaml`: receivers `otlp` 4317/4318; processors `memory_limiter`, `batch`, `attributes`; exporters `otlp/jaeger` (dev), `otlp/tempo` (prod), `prometheus`, `debug`; health on `:13133`. `pnpm dev:otel` starts Jaeger v2 all-in-one (UI 16686) via `docker-compose.dev.yml`.

**Why hand-rolled spans.** The `Router` is the one chokepoint where method, tool, upstream, era and outcome are all known; explicit `tracer.startActiveSpan` calls there yield semconv-correct spans in roughly 150 lines. Auto-instrumentation would pull the 0.x `sdk-node` line and `require`-hook patching that is hostile to ESM under NodeNext, and existing MCP instrumentations do not know SDK v2 packages or the dual-era client. One place also enforces the argument-shape rule.

## Consequences

**Positive.** A failed step links to the exact Playwright call chain and, from M6, into `appium-mcp`'s own spans. Error rate and heal rate come from metrics, not log scraping. Stdio users pay nothing unless they opt in.

**Negative.** Semconv is still *Development*; renames mean a one-file update. Span + log + row is three writes per call; batching and pino's async destination keep two off the request path, while the `action_log` write stays synchronous by design (audit before acknowledge).

**Neutral.** `mcp.session.id` is not emitted: the 2026-07-28 transport has no sessions ([ADR-0005](./0005-server-minted-handles-not-sessions.md) handles replace them). Legacy-era upstream calls still carry `traceparent` in `_meta`; Playwright MCP ignores it harmlessly.

## Alternatives considered

- **`@opentelemetry/auto-instrumentations-node`.** Rejected: 0.x, patching-based, no MCP v2 coverage.
- **`@arizeai/openinference-instrumentation-mcp`.** Deferred: manual instrumentation anyway, v1 module layout; revisit once it targets `@modelcontextprotocol/client` 2.x.
- **MCP Logging (`notifications/message`).** Rejected: deprecated; per-request `logLevel` is honored only for compatibility.
- **Always-on OTLP export.** Rejected: stdio users would see connection errors with no collector running.

## References

- [MCP 2026-07-28 changelog — OTel `_meta` keys, Logging deprecation](https://modelcontextprotocol.io/specification/2026-07-28/changelog) · [GenAI MCP semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md) · [openinference MCP instrumentation](https://www.npmjs.com/package/@arizeai/openinference-instrumentation-mcp) · [appium-mcp](https://github.com/appium/appium-mcp)
- [Observability guide](../observability.md) · [Deployment](../deployment.md) · [Data model](../data-model.md) · [ADR-0011](./0011-security-posture-default-deny-no-passthrough-egress-control.md) · [ADR-0014](./0014-provider-agnostic-llm-runner.md)
