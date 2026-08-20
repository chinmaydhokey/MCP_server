# Client Setup

QA Brain is an MCP server, so any MCP host can drive it: Claude Code, Codex CLI, Cursor, Claude Desktop, or a headless runner in CI. In M0 the supported transport for interactive clients is **stdio** (`qa-brain serve --transport stdio`), which spawns the gateway as a child of the host; the gateway in turn spawns Playwright MCP and persists its action log in SQLite under `QA_BRAIN_HOME`. The **Streamable HTTP** transport (`--transport http`, bearer-token protected, default `127.0.0.1:8787`) works today for local testing and becomes the hosted path in M5. This page gives copy-paste configuration for each client, the zero-code CI profile built on `claude -p --bare`, and a troubleshooting table for the failure modes we expect most often: result-size caps, connect timeouts, stderr logging, and Windows process quirks. Tool names, defaults and environment variables are those of the [tool catalog](./tool-catalog.md) and [ARCHITECTURE.md](../ARCHITECTURE.md); the transport and auth decisions are recorded in [ADR-0003](./adr/0003-target-mcp-2026-07-28-dual-era.md) and [ADR-0012](./adr/0012-auth-api-keys-first-oauth21-resource-server-later.md).

## 1. Before you start

| Step | Command | Notes |
|---|---|---|
| Node 22.12 or newer | `node -v` | `engines.node >= 22.12`; developed on Node 24 |
| Build the CLI (dev checkout) | `pnpm install --frozen-lockfile && pnpm build` | produces `apps/qa-brain/dist/cli.js` |
| Install Chromium | `pnpm exec playwright install chromium` | one revision, pinned by `playwright@1.62.1` |
| Write a config | `cp qa-brain.config.example.json qa-brain.config.json` | or point `QA_BRAIN_CONFIG` at it |
| Verify | `node apps/qa-brain/dist/cli.js doctor` | all rows must be PASS |
| Preview the surface | `node apps/qa-brain/dist/cli.js tools list` | 22 listed tools; `--all` shows hidden ones |

Two conventions hold across every client. First, the gateway is launched as `node <path>/dist/cli.js serve --transport stdio` in a development checkout, or as `npx -y qa-brain@<ver> serve --transport stdio` once the CLI is published (publishing is disabled in M0; see [ci-cd](./ci-cd.md#4-releaseyml-changesets)). Second, name the server **`qa-brain`** everywhere: Claude Code exposes MCP tools as `mcp__<server>__<tool>`, so the allow-list pattern `mcp__qa-brain__*` and the examples below depend on that exact name. On Windows, write paths with forward slashes (`C:/Users/you/MCP_server/apps/qa-brain/dist/cli.js`); Node accepts them and they need no JSON escaping.

## 2. Claude Code

### 2.1 stdio, project scope (`.mcp.json`)

```json
{
  "mcpServers": {
    "qa-brain": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Users/you/MCP_server/apps/qa-brain/dist/cli.js", "serve", "--transport", "stdio",
               "--config", "C:/Users/you/MCP_server/qa-brain.config.json"],
      "env": { "QA_BRAIN_HOME": "${CLAUDE_PROJECT_DIR}/.qa-brain", "QA_BRAIN_LOG_LEVEL": "info" },
      "timeout": 300000,
      "alwaysLoad": true
    }
  }
}
```

Released form: replace `command`/`args` with `"command": "npx", "args": ["-y", "qa-brain@0.1.0", "serve", "--transport", "stdio", "--config", "./qa-brain.config.json"]`. The equivalent one-liner, which writes the same file, is:

```bash
claude mcp add --transport stdio --scope project qa-brain \
  --env QA_BRAIN_HOME='${CLAUDE_PROJECT_DIR}/.qa-brain' \
  -- node C:/Users/you/MCP_server/apps/qa-brain/dist/cli.js serve --transport stdio --config ./qa-brain.config.json
```

Field notes, all from the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp):

- **`type` is mandatory.** Claude Code rejects a `url` entry without `type` (since v2.1.202) and the project setting is shared with teammates, so always write it for stdio too; accepted values are `stdio`, `http`, `streamable-http` (alias) and the deprecated `sse`.
- **`${VAR}` and `${VAR:-default}`** are expanded inside `.mcp.json`, and `CLAUDE_PROJECT_DIR` is injected into the server's environment, which is how the snippet keeps the SQLite file and Playwright output under the project's `.qa-brain/` (already in `.gitignore`).
- **`alwaysLoad: true`** exempts the server from tool search (deferred tool loading, on by default). QA Brain already curates its surface to 22 tools, so loading them eagerly costs little and avoids a discovery round-trip before the first `web_navigate`.
- **`timeout`** is the per-server millisecond budget for a tool call (design value 300000: a navigation plus a full-page snapshot on a slow site can take minutes). The environment variables `MCP_TIMEOUT` (server start-up, 30 s default) and `MCP_TOOL_TIMEOUT` apply globally when a client version ignores the per-server key.
- Project-scope servers in `.mcp.json` prompt for approval interactively but load **without** a prompt in `-p` sessions; that is why the CI profile (section 7) uses `--bare` and an explicit `--mcp-config`.

### 2.2 Hosted or local HTTP

```bash
claude mcp add --transport http --scope project qa-brain https://qa.example.com/mcp \
  --header "Authorization: Bearer ${QA_BRAIN_API_KEY}"
```

which yields `{"type":"http","url":"https://qa.example.com/mcp","headers":{"Authorization":"Bearer ${QA_BRAIN_API_KEY}"}}`. To test the HTTP transport locally: `QA_BRAIN_TOKEN=dev-secret node apps/qa-brain/dist/cli.js serve --transport http --port 8787`, then use `http://127.0.0.1:8787/mcp` with the same header. The server reads its expected bearer from the variable named by `http.bearerTokenEnv` (default `QA_BRAIN_TOKEN`); the client-side variable name is yours. `GET /healthz` answers 200 as soon as the process is up; `GET /readyz` answers 200 only when the store and every upstream are healthy.

## 3. Codex CLI

Codex reads `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`) and uses TOML table names, so the server is `qa_brain` here ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)).

```toml
[mcp_servers.qa_brain]
command = "node"
args = ["C:/Users/you/MCP_server/apps/qa-brain/dist/cli.js", "serve", "--transport", "stdio",
        "--config", "C:/Users/you/MCP_server/qa-brain.config.json"]
env = { QA_BRAIN_HOME = "C:/Users/you/MCP_server/.qa-brain" }
env_vars = ["ANTHROPIC_API_KEY"]        # forwarded from the shell, never written to the file
startup_timeout_sec = 30                # Codex default is 10; SQLite migration + Playwright spawn need more
tool_timeout_sec = 300                  # Codex default is 60

# hosted / local HTTP instead of stdio:
# [mcp_servers.qa_brain]
# url = "https://qa.example.com/mcp"
# bearer_token_env_var = "QA_BRAIN_API_KEY"
```

`codex mcp add qa_brain -- node .../dist/cli.js serve --transport stdio` writes the stdio block for you; `codex mcp list` confirms the connection. `enabled_tools` / `disabled_tools` can narrow the surface further, but the gateway's allow-list is the intended place for that policy.

## 4. Cursor

Project file `.cursor/mcp.json` (global: `~/.cursor/mcp.json`). Cursor supports `${workspaceFolder}` and `${env:NAME}` interpolation and an `envFile` for secrets ([Cursor MCP docs](https://cursor.com/docs/context/mcp)).

```json
{
  "mcpServers": {
    "qa-brain": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/apps/qa-brain/dist/cli.js", "serve", "--transport", "stdio",
               "--config", "${workspaceFolder}/qa-brain.config.json"],
      "env": { "QA_BRAIN_HOME": "${workspaceFolder}/.qa-brain" },
      "envFile": ".env"
    }
  }
}
```

Hosted entry: `{"type": "streamable-http", "url": "https://qa.example.com/mcp", "headers": {"Authorization": "Bearer ${env:QA_BRAIN_API_KEY}"}}`. Cursor's `type` value for HTTP is `streamable-http` (Claude Code accepts both `http` and `streamable-http`; the Claude Agent SDK's programmatic option accepts only `http`).

## 5. Claude Desktop

Claude Desktop reads local stdio servers from `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`; Settings > Developer > Edit Config) and needs a restart after edits ([connect remote servers](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)).

```json
{
  "mcpServers": {
    "qa-brain": {
      "command": "node",
      "args": ["C:/Users/you/MCP_server/apps/qa-brain/dist/cli.js", "serve", "--transport", "stdio",
               "--config", "C:/Users/you/MCP_server/qa-brain.config.json"],
      "env": { "QA_BRAIN_HOME": "C:/Users/you/MCP_server/.qa-brain" }
    }
  }
}
```

For the released package on Windows, Claude Desktop cannot spawn `npx` directly (it is a `.cmd` shim), so wrap it: `"command": "cmd", "args": ["/c", "npx", "-y", "qa-brain@0.1.0", "serve", "--transport", "stdio"]`. The `node` form above avoids the problem entirely. Claude Desktop has **no config-file path for remote HTTP servers**: a hosted QA Brain is attached through Settings > Connectors > Add custom connector, which requires the server to implement MCP OAuth. That is the M7 deliverable (OAuth 2.1 resource server with an external IdP, [ADR-0012](./adr/0012-auth-api-keys-first-oauth21-resource-server-later.md)); until then Claude Desktop users run the stdio form.

## 6. What the model sees

After connecting, `tools/list` returns 22 tools sorted by name: `qa_call_tool`, `qa_describe_tool`, `qa_health`, `qa_run_finish`, `qa_run_log`, `qa_run_start`, `qa_search_tools`, `web_click`, `web_console_messages`, `web_fill_form`, `web_find`, `web_handle_dialog`, `web_hover`, `web_navigate`, `web_press_key`, `web_select_option`, `web_snapshot`, `web_take_screenshot`, `web_type`, `web_verify_element_visible`, `web_verify_text_visible`, `web_wait_for`. Twelve more `web_*` tools (tabs, network, drag/drop, upload, locator generation) are callable through `qa_call_tool` after `qa_search_tools`; `browser_run_code_unsafe` and `browser_evaluate` are blocked outright. A typical first prompt is: "Start a run with qa_run_start, open http://127.0.0.1:4173/, take a snapshot, submit the form, verify the text Submitted, then finish the run."

## 7. Zero-code CI profile

Before the reusable Action exists (M4 to M7, [ci-cd](./ci-cd.md#9-reusable-action-qa-brainrun-action)), the Claude Code CLI in headless mode is a complete runner: it brings the agent loop, structured output, and cost accounting, and needs only `ANTHROPIC_API_KEY` ([headless mode](https://code.claude.com/docs/en/headless)). Three committed files make it reproducible:

- `.qa-brain/mcp.ci.json`: the same shape as `.mcp.json`, usually pointing at `node apps/qa-brain/dist/cli.js` with `QA_BRAIN_HOME=${RUNNER_TEMP}/qa-brain`;
- `.qa-brain/prompts/pr-check.md`: the test plan prompt (which pages, which assertions, when to stop);
- `.qa-brain/schemas/run-result.json`: a JSON Schema with `additionalProperties: false` and the fields `passed`, `failed`, `healed`, `notes`.

```bash
claude -p "$(cat .qa-brain/prompts/pr-check.md)" \
  --bare --mcp-config .qa-brain/mcp.ci.json \
  --allowedTools "mcp__qa-brain__*" --permission-mode dontAsk --max-turns 80 \
  --output-format stream-json \
  --json-schema "$(cat .qa-brain/schemas/run-result.json)" | tee run.jsonl

# Gate 1: every MCP server loaded (init event lists mcp_server_errors, Claude Code >= 2.1.219)
jq -es 'map(select(.type=="system" and .subtype=="init"))[0].mcp_server_errors | length == 0' run.jsonl
# Gate 2: the structured verdict
jq -es 'map(select(.type=="result"))[0].structured_output.failed == 0' run.jsonl
# Optional gate 3: spend
jq -es 'map(select(.type=="result"))[0].total_cost_usd < 2' run.jsonl
```

Why each flag is there: `--bare` skips hooks, plugins, `CLAUDE.md` and the project's `.mcp.json`, so the only server in the session is the one in `--mcp-config` and the run is identical on every machine; `--allowedTools "mcp__qa-brain__*"` pre-approves exactly the gateway's tools (note that `--permission-mode acceptEdits` does *not* auto-approve MCP tools, and `bypassPermissions` approves far more than needed); `--max-turns 80` bounds the loop; `--json-schema` makes the final message machine-checkable; `stream-json` exposes the `system`/`init` event so a gateway that failed to start fails the job instead of producing a run that passed because no test could run. Since v2.1.221 Claude waits up to `MCP_TIMEOUT` for `--mcp-config` servers before the first turn, so export `MCP_TIMEOUT=60000` on slow runners. `--output-format json` is a simpler variant that prints one object with `result`, `structured_output`, `total_cost_usd` and `session_id`; gate 2 then becomes `jq '.structured_output.failed == 0'`, but gate 1 is unavailable. Exit codes: 0 on success, non-zero on failure, 143 on SIGTERM. On GitHub Actions the job needs `pnpm build` and `pnpm exec playwright install --with-deps chromium` first, the same steps as the `smoke` job in `ci.yml`.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server shows `failed` in `claude mcp list` or the `init` event | `.mcp.json` entry without `type`; wrong path; Chromium not installed | run `qa-brain doctor`; add `"type"`; `pnpm exec playwright install chromium`; `claude --debug` prints the server's stderr |
| Tool result replaced by "written to disk" message | Claude Code caps MCP tool results at 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`) ([Agent SDK MCP docs](https://code.claude.com/docs/en/agent-sdk/mcp)) | the gateway already truncates at `server.maxResultChars` = 80000 characters (about 20k tokens) with a marker; lower it to 40000 for snapshot-heavy apps, or prefer `web_find` over a full `web_snapshot` |
| Connect timeout at start-up | SQLite migration plus Playwright MCP spawn exceed the client budget | `MCP_TIMEOUT=60000` (Claude Code), `startup_timeout_sec = 30` (Codex); Playwright MCP connects in about 700 ms, the browser launches lazily on the first `web_navigate` |
| `isError` with "timeout" hint on a tool | gateway `server.callTimeoutMs` (60000) or Playwright `--timeout-navigation 30000` elapsed | raise `callTimeoutMs`; use `web_wait_for` for slow pages; check `qa_health` for a degraded upstream |
| No logs visible | stdio servers must keep stdout clean, so all gateway logs are pino JSON on **stderr** | `QA_BRAIN_LOG_LEVEL=debug`; Claude Desktop logs: `~/Library/Logs/Claude/mcp*.log` or `%APPDATA%\Claude\logs`; Claude Code: `claude --debug`; arguments are logged as shape or redacted per `log.argsMode` |
| `spawn npx ENOENT` on Windows (Claude Desktop) | `npx` is a `.cmd` shim | use `cmd /c npx ...` or the `node .../dist/cli.js` form |
| 401 from `/mcp` | missing or wrong bearer | set `QA_BRAIN_TOKEN` on the server and the `Authorization` header on the client; `--allow-unauthenticated` is accepted only on a loopback bind |
| 403 from `/mcp` | Host/Origin validation | add the hostname to `http.allowedHosts` / `http.allowedOrigins` |
| Orphan Chromium after the host exits | client did not close stdin | the gateway closes children on stdin EOF, `SIGINT` and `SIGTERM` (Windows `taskkill /PID /T /F`); report remaining cases with `qa-brain doctor` output |
| Wrong or missing tools | stale config or allow-list | `qa-brain serve --dry-run` prints the registry table; `qa-brain tools list --all --json` shows hidden tools and why each is hidden |

`qa-brain doctor` is the first command to run for any of these. It checks Node and pnpm versions, config validity, the resolved `playwright/cli.js` and whether every configured flag appears in `playwright mcp --help`, the Chromium entry in the `ms-playwright` cache, applied migrations, a writable `QA_BRAIN_HOME`, `taskkill`/`ps` availability, and which LLM environment variables are set. It exits non-zero on any FAIL so it can also be the first step of a CI job.
