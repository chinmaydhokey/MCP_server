# ADR-0004: Tool namespacing (`web_`/`mobile_`/`qa_`) and a curated surface of at most 25 listed tools

QA Brain exposes proxied tools under short platform prefixes (`web_` for Playwright MCP with `browser_` stripped, `mobile_` for the future appium-mcp adapter) and its own tools under `qa_`. The default `tools/list` is a fixed, deterministically ordered set of 22 tools; more are hidden but callable through discovery tools, a few are blocked, and unimplemented tools are hidden stubs. Names are validated against `^[a-zA-Z0-9_-]{1,64}$` and a 40-character cap, collisions abort startup, and names are never removed while the process runs.

## Status

Accepted, 2026-08-20.

## Context

The MCP 2026-07-28 tools page says aggregating proxies SHOULD prefix tool names with a server identifier and must not rely on `serverInfo.name` for uniqueness; SEP-986 allows `A-Z a-z 0-9 _ - . /` ([spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [SEP-986](https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names)). The Claude Messages API is stricter, `^[a-zA-Z0-9_-]{1,64}$`, and Anthropic advises service prefixes ([define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)). Claude Code wraps MCP tools as `mcp__<server>__<tool>`, so `mcp__qa-brain__` spends 15 characters of that budget ([Claude Code MCP](https://code.claude.com/docs/en/mcp)).

Count matters too. Anthropic reports selection accuracy degrading past 30–50 tools ([tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)); SEP-993's author sees degradation near 20 ([issue #993](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/993)). Playwright MCP alone offers 29 tools with `--caps=testing`; appium-mcp 40+. Removing a tool from `tools/list` mid-conversation does not remove it from the model's history, so models keep calling it ([discussion #2036](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2036)), and Docker MCP Gateway v0.43.1 made cross-server shadowing a hard error ([release](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1)).

## Decision

1. **Naming.** `public = prefix + upstreamName.replace(strip, '')`, configured per upstream (`mcpServers.<id>.prefix`, `.strip`); Playwright uses `prefix: "web_"`, `strip: "browser_"`, so `browser_click` becomes `web_click`. Natives are `qa_*`; mobile will be `mobile_*`. `@qa-brain/core` `tool-name.ts` enforces `TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/` and `MAX_PUBLIC_TOOL_NAME_LENGTH = 40`. Only `_` and `-` are separators; `.`, `/`, `:`, and `__` are not used.
2. **Collisions.** Two equal public names, or a proxied name equal to a native name, is a startup error naming both sources. No silent rename, no shadowing.
3. **Default surface (22).** `web_navigate, web_snapshot, web_find, web_click, web_type, web_fill_form, web_select_option, web_press_key, web_hover, web_wait_for, web_take_screenshot, web_console_messages, web_handle_dialog, web_verify_text_visible, web_verify_element_visible, qa_health, qa_run_start, qa_run_finish, qa_run_log, qa_search_tools, qa_describe_tool, qa_call_tool`. A CI test fails if the default list exceeds 25.
4. **Classes.** *Hidden but callable* (`tools.hidden`): `web_navigate_back, web_tabs, web_network_requests, web_network_request, web_generate_locator, web_verify_value, web_verify_list_visible, web_drag, web_drop, web_file_upload, web_resize, web_close`. *Blocked* (`tools.block`, wins over `allow`): `browser_run_code_unsafe`, `browser_evaluate` (RCE-equivalent), and everything behind the `vision`, `pdf`, `devtools`, `network`, `storage`, and `config` capabilities. *Stubs* (`qa_test_save, qa_test_get, qa_test_list, qa_heal_locator, qa_impact_select, qa_report_generate`): return `isError` "not implemented in M0", listed only when `server.exposeStubs` is true. An empty `allow` list exposes nothing.
5. **Discovery.** `qa_search_tools {query, includeHidden}` searches names and descriptions; `qa_describe_tool {name}` returns the full `inputSchema`; `qa_call_tool {name, arguments}` forwards any allowed tool, hidden or listed, through the same router and `action_log` path and rejects blocked names. Discovery schemas set `additionalProperties: false` with explicit `required` so weaker models cope (Docker issue #285).
6. **Listing.** Sorted by public name, `inputSchema` passed through unchanged, `ttlMs: 300000`, `cacheScope: 'public'`.
7. **Stability.** Names are never removed at runtime. A degraded upstream keeps its names and answers `isError` with a recovery hint ("upstream 'playwright' is degraded (restarting, attempt 2/5); retry in 5 s or call qa_health"). Future `--watch` reloads may add names but never delete them.

## Consequences

**Positive.** The default surface stays under Claude Code's tool-search threshold; deterministic order and `cacheScope: 'public'` let hosts prompt-cache the list. Short names leave room for `mobile_` and `db_` families, and a model mid-run never meets an unknown-tool error for a name it was told about.

**Negative.** Stripping `browser_` forces a translation between Playwright docs and QA Brain logs; `action_log` stores both `tool` and `upstream_tool`. Hidden tools cost one `qa_describe_tool` call on first use. The 25 cap will force choices when mobile lands; the intended answer is platform-scoped profiles, not a longer list.

**Neutral.** Hosts with their own tool search (Claude Code, the API's `tool_search_tool_bm25_20251119`) duplicate `qa_search_tools`; it stays for hosts without one.

## Alternatives considered

- **MetaMCP-style `{ServerName}__{tool}`** ([docs](https://docs.metamcp.com/en/concepts/namespaces)): double underscores and long server names exhaust the 64-character budget under `mcp__qa-brain__`.
- **ContextForge's configurable separator (`-`, `--`, `_`, `.`)** ([config](https://ibm.github.io/mcp-context-forge/manage/configuration/)): `.` fails the Claude regex; configurability invites drift.
- **Proxy everything** (sparfenyuk/TBXark model): 29 + 40 + natives exceeds the range where accuracy holds.
- **Meta-tools only** (Lasso `run_tool`, Composio search, ContextForge #2230): minimal context, but every browser action costs a discovery hop; we list the 15 hottest web tools and keep meta-tools for the tail.
- **Dropping unhealthy upstreams from the list**: rejected because of the stale-history problem.

## References

- MCP tools page: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Claude tool-name constraint and namespacing: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools>
- Claude tool search, 30–50 tool threshold: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>
- Claude Code `mcp__server__tool` naming and 25k-token output cap: <https://code.claude.com/docs/en/mcp>
- Docker MCP Gateway v0.43.1: <https://github.com/docker/mcp-gateway/releases/tag/v0.43.1>
- Playwright MCP tool list: <https://github.com/microsoft/playwright-mcp>
- Related: [ADR-0001](./0001-gateway-on-mcp-sdk-v2-low-level-server.md), [ADR-0011](./0011-security-posture-default-deny-no-passthrough-egress-control.md), [tool-catalog.md](../tool-catalog.md)
