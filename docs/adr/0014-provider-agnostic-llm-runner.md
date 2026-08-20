# ADR-0014: Provider-agnostic LLM runner on official SDKs, Anthropic by default

QA Brain's headless runner (the component that drives a model against the gateway in CI and for healing/triage) is built around a small `LlmDriver` interface with three implementations: an Anthropic driver on the official `@anthropic-ai/sdk` tool runner and MCP helpers (default `claude-opus-5`, adaptive thinking, `output_config.effort`), an OpenAI-compatible driver on the official `openai` SDK covering OpenAI and Ollama, and a zero-code profile that shells out to Claude Code headless (`claude -p --bare --mcp-config`). Framework layers such as the Vercel AI SDK or LangChain are deliberately not the core.

## Status

Accepted, 2026-08-20.

## Context

- Anthropic's SDK converts MCP tools into tool-runner tools: `import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp"`, then `anthropic.beta.messages.toolRunner({ model, max_tokens, messages, tools: mcpTools(tools, mcpClient) })`; this works over stdio and HTTP, unlike the hosted MCP connector, which needs public HTTPS ([MCP connector docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)). The Tool Runner has no built-in tools, unlike the Claude Agent SDK, which spawns the Claude Code harness.
- Prices (fetched 2026-08-20): `claude-opus-5` $5/$25 per MTok (cache write $6.25, read $0.50), `claude-sonnet-5` $2/$10, `claude-haiku-4-5` $1/$5. Claude 5 models reject `budget_tokens`, `temperature`, `top_p`, `top_k` and prefill with HTTP 400; thinking is adaptive, depth is `output_config.effort` ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- Structured outputs are GA: `output_config.format = { type: "json_schema", schema }` (`zodOutputFormat` helper); schemas need `additionalProperties: false` and no `minimum/maximum/minLength/maxLength`, recursion or external `$ref` ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
- Claude Code headless: `--bare` skips hooks, plugins, `.mcp.json` and `CLAUDE.md`; the `system/init` event carries `mcp_server_errors[]`, the result `structured_output` and `total_cost_usd` ([headless docs](https://code.claude.com/docs/en/headless)).
- The Vercel AI SDK moved MCP support to `@ai-sdk/mcp` (`createMCPClient`); its stdio transport is still `Experimental_StdioMCPTransport`, "local development only", and it does not accept server notifications ([AI SDK MCP tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)). Anthropic warns accuracy degrades past 30–50 tools ([tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)); the registry keeps the default list at 22 ([ADR-0004](./0004-tool-namespacing-and-curated-surface.md)).

## Decision

**Interface** (`packages/core/src/interfaces.ts`):

```ts
export interface LlmDriver {
  readonly provider: 'anthropic' | 'openai' | 'ollama';
  readonly model: string;
  runAgentLoop(input: { systemPrompt; task; tools: McpToolDef[];
    callTool(name, args): Promise<CallToolResult>; maxTurns; maxTokens?; signal? }): Promise<AgentRunResult>;
  complete(input: { prompt; schema?: JsonSchema; effort?: 'low'|'medium'|'high' }): Promise<unknown>;
  estimateCost(usage: TokenUsage): number;
}
```

Drivers live in `apps/runner` (M1 skeleton); the runner is an MCP client of QA Brain only, never of Playwright directly.

**Anthropic driver (default).** `toolRunner` with `mcpTools(await client.listTools(), client)` over the `@modelcontextprotocol/client` v2 `Client`; if the helper expects the v1 client shape, a small adapter exposing `callTool` is the fallback (M1 spike). Request: `model: 'claude-opus-5'`, `thinking: { type: 'adaptive' }`, `output_config: { effort }` (`high` for authoring and triage, `low`/`medium` for replay steps), streaming on; never `budget_tokens` or `temperature`. The frozen prefix (system prompt + the gateway's deterministically ordered `tools/list`) sits behind one `cache_control` breakpoint; volatile run data follows. Cost per turn = `uncached·P_in + cached·0.1·P_in + cache_write·1.25·P_in + output·P_out`, capped by `llm.budget_usd_per_run` (T14). Optional tiering: `llm.tiers.step_executor = claude-sonnet-5`, `llm.tiers.heal_rerank = claude-haiku-4-5`; `complete()` for T2 re-ranking uses structured outputs with the schema in [self-healing.md](../self-healing.md).

**OpenAI-compatible driver.** The `openai` SDK's Chat Completions with function tools built from each tool's `name`/`description`/`inputSchema`. OpenAI: `gpt-5.6-terra` ($2/$12), the cost peer of Sonnet 5. Ollama: same driver with `baseURL = ${OLLAMA_HOST}/v1`, for on-prem runs and the benchmark's local baseline. Structured outputs use the provider's JSON-schema mode with the same restricted schemas; needed before the M7 benchmark campaign.

**Zero-code profile.** CI runs `claude -p "$(cat prompts/pr-check.md)" --bare --mcp-config .qa-brain/mcp.ci.json --allowedTools "mcp__qa-brain__*" --permission-mode dontAsk --max-turns 80 --output-format stream-json --json-schema "$(cat schemas/run-result.json)"` and gates on empty `mcp_server_errors` and `structured_output.failed == 0`. No SDK code; cost arrives in `total_cost_usd`.

**Reports.** The run report uses `output_config.format` against `schemas/run-result.json` (`additionalProperties: false` throughout) so one schema validates on every provider.

## Consequences

**Positive.** New Anthropic parameters are usable the day the SDK ships them. Swapping providers is a config key; the benchmark pins `claude-opus-5`, `claude-sonnet-5`, `gpt-5.6-terra` and a local model via one interface. The zero-code path needs only the Claude Code CLI.

**Negative.** Two SDKs to track; helper-vs-v2-client compatibility is an M1 unknown with a small fallback. Ollama models vary in tool-calling quality; malformed tool calls become `isError` results, not crashes.

**Neutral.** The Claude Agent SDK is not used programmatically (its built-in Read/Write/Bash tools would need disabling). Budgets are calibrated with `count_tokens` on recorded runs.

## Alternatives considered

- **Vercel AI SDK as the core loop.** Rejected: an extra layer over official SDKs, experimental stdio transport, no notifications, v6/v7 churn. Welcome as a contributed driver.
- **LangChain/LangGraph (`@langchain/mcp-adapters`).** Rejected: framework weight for a loop the tool runner already provides.
- **Anthropic MCP connector only.** Rejected: no stdio/localhost; kept as an optional hosted path.

## References

- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [MCP connector and SDK MCP helpers](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) · [Claude Code headless](https://code.claude.com/docs/en/headless) · [AI SDK MCP tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools) · [Tool search and tool-count guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Client setup](../client-setup.md) · [Self-healing](../self-healing.md) · [Research track](../research-track.md) · [ADR-0004](./0004-tool-namespacing-and-curated-surface.md) · [ADR-0013](./0013-observability-otel-genai-mcp-semconv.md)
