# ADR-0011: Security posture — default-deny tools, no token passthrough, network-level egress control

QA Brain sits between an LLM and browser/device automation servers, so every page it visits is untrusted input that can steer the model. This ADR fixes a layered posture: default-deny tool allowlist, URL guard on navigation arguments, no token passthrough, redaction before persistence, and in hosted mode network-level egress control plus container hardening. Playwright MCP's own guardrails are conveniences, never the boundary.

## Status

Accepted, 2026-08-20.

## Context

- Playwright MCP calls `browser_run_code_unsafe` "RCE-equivalent" and `allowUnrestrictedFileAccess` and `--secrets` redaction "a convenience and not a security feature" ([config.d.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/tools/mcp/config.d.ts)); origin lists ignore redirects and were restored after removal only as guardrails ([#1210](https://github.com/microsoft/playwright-mcp/issues/1210)). Enforcement is expected from the client — here, QA Brain.
- MCP security best practices: servers MUST NOT accept tokens not issued to them; proxies spawning stdio children SHOULD sandbox them and log stdio usage; server-side clients SHOULD block 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7 and use an egress proxy such as Smokescreen ([best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)).
- Docker MCP Gateway v0.43.1 (2026-06-25) is a list of gateway mistakes fixed after the fact: bearer auth by default, remote URLs rejecting loopback/private/link-local/metadata/userinfo and unsafe redirects, no tool-name shadowing, logs recording argument *shape*, secret blocking before logging ([release](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1)).
- Playwright's guidance for untrusted sites: `--user pwuser` plus a seccomp profile allowing user-namespace `clone`, keeping the Chromium sandbox on ([Docker docs](https://playwright.dev/docs/docker)).

Threats T1–T15 and their milestones are tabulated in [security-threat-model.md](../security-threat-model.md).

## Decision

| Layer | Control | Milestone |
|---|---|---|
| Tool surface | Default-deny: `tools.allow` is explicit, empty allow exposes nothing, `block` beats `allow` and `hidden`. `browser_run_code_unsafe` and `browser_evaluate` are blocked by default and unreachable even via `qa_call_tool`. Playwright runs with `--caps=testing` only; vision/pdf/devtools/network/storage/config tools are never registered. | M0 |
| URL guard | Every URL-bearing argument (`url`, `target`) is parsed before forwarding. Denied: `file:` and other non-`http(s)` schemes, userinfo, loopback, RFC1918, link-local, `169.254.169.254`, `fc00::/7`, and hostnames resolving into those ranges. Per-project `allowed_origins` narrows further from M1. | M0 design, M1 code |
| Credentials | The inbound bearer/OAuth token ([ADR-0012](./0012-auth-api-keys-first-oauth21-resource-server-later.md)) is never forwarded to upstream MCP servers, GitHub or LLM providers. Upstream secrets arrive only via `env`/`${VAR}` expansion or Playwright's `--secrets` file — never argv, never inline config. | M0 |
| Logging | `createRedactor()` runs before persist and before stderr: key pattern `/(pass(word\|phrase)?\|secret\|token\|api[-_]?key\|authorization\|auth\|cookie\|session[-_]?id\|credential\|private[-_]?key\|bearer)/i`; value patterns for `github_pat_`, `gh[pousr]_`, `sk-`, `xox[baprs]-`, `AKIA`, JWTs, `Bearer …`, PEM blocks; plus every env-expanded literal ≥ 6 chars. `action_log.args_shape` stores keys and `typeof` only; `args_redacted` exists only when `log.argsMode: redacted` (hosted default `shape`). Child stderr is redacted too. | M0 |
| Network | Hosted browsers sit on a Docker `internal: true` network and exit only through Smokescreen (`--proxy-server http://egress:4750`), which denies RFC1918/link-local/metadata by default and resolves DNS at connect time (defeats rebinding). ACL in `deploy/egress/acl.yaml`. | M5 (compose in M0) |
| Container | `FROM mcr.microsoft.com/playwright:v1.62.1-noble`, `user: pwuser`, `seccomp=docker/seccomp_profile.json`, `no-new-privileges`, `cap_drop: [ALL]`, `read_only: true`, tmpfs `/tmp`, `init: true`, CPU/memory limits, no published ports, no `--no-sandbox`. | M5 |

Playwright's `--isolated`, `--secrets` and origin lists stay on as defense in depth; nothing above depends on them.

## Consequences

**Positive.** An injected page cannot reach `browser_run_code_unsafe` because the name does not exist at the boundary (T1). SSRF to cloud metadata is blocked at argument and network level (T2). An `action_log` dump yields shapes and hashes, not credentials (T6). A compromised browser process is confined to a non-root, capability-dropped, read-only container whose only exit is an allow-listing proxy.

**Negative.** Intranet targets need an `allowed_origins` entry and a Smokescreen ACL rule. Smokescreen is a Go build (Squid is the fallback). `--caps=testing` keeps tracing/video tools off the LLM surface; QA Brain captures those itself from M2. `argsMode: shape` hampers debugging; operators opt into `redacted`.

**Neutral.** Stdio mode gets allowlist, URL guard and redaction but no network layer (T7–T11 are hosted-only).

## Alternatives considered

- **Rely on Playwright's origin lists and `--secrets`.** Rejected: disclaimed by the maintainers; they ignore redirects.
- **Defer to the host's permission prompt.** Rejected: headless CI has no human; bypass modes approve everything.
- **Official `mcr.microsoft.com/playwright/mcp` image.** Rejected for hosting: forces `--no-sandbox`, Chromium-only, tracks a 1.63 alpha.

## References

- [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) · [Docker MCP Gateway v0.43.1](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1) · [Playwright MCP config.d.ts](https://raw.githubusercontent.com/microsoft/playwright/main/packages/playwright-core/src/tools/mcp/config.d.ts) · [playwright-mcp #1210](https://github.com/microsoft/playwright-mcp/issues/1210) · [Playwright Docker](https://playwright.dev/docs/docker)
- [Threat model](../security-threat-model.md) · [Deployment](../deployment.md) · [Tool catalog](../tool-catalog.md) · [ADR-0012](./0012-auth-api-keys-first-oauth21-resource-server-later.md)
