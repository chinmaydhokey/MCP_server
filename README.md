# QA Brain

**An MCP gateway that turns any LLM agent into a persistent, self-healing, change-aware test engineer for web and mobile apps.**

QA Brain sits between an LLM host (Claude Code, Codex, Cursor, Claude Desktop, or a headless CI runner) and the
browser/device automation MCP servers ([Playwright MCP](https://github.com/microsoft/playwright-mcp),
[Appium MCP](https://github.com/appium/appium-mcp)). It exposes a small, curated tool surface to the model and adds
what the raw automation servers lack:

- a **persistent test store and run history** (tests are intent-level YAML in your repo; resolved locators are cached),
- **self-healing locators** with an approval workflow (never silent edits),
- **diff-aware test selection** (test impact analysis) so a pull request runs only what it touches,
- **web ↔ mobile parity** from one test definition,
- **flakiness detection and quarantine**, reporting, and GitHub integration.

> Status: **M0 — blueprint and scaffold.** Start with [ARCHITECTURE.md](./ARCHITECTURE.md), the ADRs under
> [docs/adr](./docs/adr/0001-gateway-on-mcp-sdk-v2-low-level-server.md), the [tool catalog](./docs/tool-catalog.md),
> [client setup](./docs/client-setup.md) and the [roadmap](./docs/roadmap.md) (M0 September 2026 to M9 June 2027).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
