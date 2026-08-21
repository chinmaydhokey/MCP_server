# Security Policy

QA Brain is an MCP gateway that holds credentials and drives a browser against untrusted pages on behalf of an LLM, so security reports get priority over feature work. This policy explains how to report a vulnerability privately, what response to expect, which versions receive fixes, and what is in and out of scope. The design rationale behind the controls is in [docs/security-threat-model.md](./docs/security-threat-model.md) and [ADR-0011](./docs/adr/0011-security-posture-default-deny-no-passthrough-egress-control.md).

## Reporting a vulnerability

Use GitHub's private reporting: [open a security advisory](https://github.com/chinmaydhokey/MCP_server/security/advisories/new) on `chinmaydhokey/MCP_server`. Do not open a public issue or pull request for a suspected vulnerability. Include the affected component (`packages/gateway`, `packages/core`, `apps/qa-brain`, `deploy/`, workflows), the transport (`stdio` or `http`), the commit or tag, reproduction steps and impact. Proof-of-concept code is welcome; please do not test against hosts you do not own.

## Response targets

| Stage | Target |
|---|---|
| Acknowledgement | 3 business days |
| Triage and severity (CVSS v3.1) | 7 days from acknowledgement |
| Fix or mitigation for High/Critical | 30 days from triage |
| Fix for Medium/Low | next scheduled release |
| Coordinated disclosure | 90 days after the report, or on release of the fix, whichever is earlier; extensions by mutual agreement |

Fixes ship through the normal release workflow and are credited in the advisory and changelog unless the reporter prefers anonymity.

## Supported versions

| Version | Supported |
|---|---|
| `main` (M0, pre-release) | Yes — fixes land on `main` only |
| Tagged releases | None yet; from `v0.9.0` the latest minor receives fixes |

## Scope

**In scope:** the gateway and its packages (tool registry and allow-list, router, URL guard, redaction, child-process supervision), the `qa-brain` CLI, the HTTP transport (bearer auth, Origin/Host validation), the default `deploy/` Compose and Dockerfiles, and the GitHub workflows. Examples: a blocked tool reachable through `qa_call_tool`, a secret written to `action_log` or stderr unredacted, an SSRF bypass of the URL guard, an orphaned child process that survives shutdown, a bearer bypass on `/mcp`.

**Out of scope:** vulnerabilities in Playwright, Chromium or appium-mcp themselves (report to [microsoft/playwright](https://github.com/microsoft/playwright/security) or [appium/appium-mcp](https://github.com/appium/appium-mcp)); the application under test; deployments that set `--allow-unauthenticated` on a non-loopback bind or disable the default block list; prompt injection that only drives *allowed* tools against the operator's own test environment (a known, documented residual risk); and denial of service using the reporter's own API key.
