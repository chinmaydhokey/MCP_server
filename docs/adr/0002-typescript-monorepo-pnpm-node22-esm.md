# ADR-0002: TypeScript monorepo on pnpm 10, Node ≥22.12, and NodeNext ESM

QA Brain is a TypeScript monorepo managed by pnpm workspaces, compiled as ES modules with TypeScript 5.9 (`module: NodeNext`), bundled by tsup, tested by Vitest 4, linted and formatted by Biome 2, and versioned by Changesets. It targets Node 22 LTS (`engines.node >=22.12`) and must behave identically on Windows, macOS, and Linux. This ADR fixes the language, toolchain, and package layout, and explains why a Python/FastMCP implementation was not chosen.

## Status

Accepted — 2026-08-20

## Context

Three or four students deliver the project over nine to twelve months, developing on Windows 11 and verifying in CI on `ubuntu-latest` and `windows-latest`. Every upstream is a Node program: `playwright@1.62.1` bundles the `playwright mcp` server ([release notes](https://playwright.dev/docs/release-notes)), the official `appium-mcp` requires Node ≥22 ([registry](https://registry.npmjs.org/appium-mcp/latest)), and the MCP TypeScript SDK v2 is tier-1 for 2026-07-28, ESM-first, and requires Zod 4 ([upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)). The later LLM runner builds on `@anthropic-ai/sdk` and the `openai` SDK. pg-boss 12, the hosted queue ([ADR-0007](./0007-job-queue-pg-boss-on-postgres.md)), requires Node ≥22.12 and sets the floor.

## Decision

| Concern | Choice (pinned) | Rationale |
|---|---|---|
| Package manager | pnpm 10.34.5 via `packageManager` + corepack; `.npmrc` `engine-strict=true` | Strict `node_modules`; `onlyBuiltDependencies` limits native builds to `@biomejs/biome` and `esbuild` |
| Runtime | Node 22 LTS minimum (`engines >=22.12`, `.nvmrc` 22); developed on Node 24 | pg-boss and appium-mcp floors; Node ≥20 refuses `.cmd` shims without `shell: true`, hence no `npx` |
| Language | TypeScript 5.9.3 (not the 7.x native preview); `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` | Compiler the SDK is tested against |
| Modules | `"type": "module"`, `module: NodeNext`, `.js` import suffixes | SDK subpaths (`@modelcontextprotocol/client/stdio`) resolve cleanly under NodeNext |
| Build | tsup 8.5.1 per package; `pnpm typecheck` runs `tsc -p tsconfig.json --noEmit` in every package | Bundled `bin` with shebang plus `.d.ts` from one config |
| Tests | Vitest 4.1.11; root `vitest.config.ts` with projects `unit` and `e2e` (`QA_BRAIN_E2E=1` gates smoke) | Native ESM/TS; `InMemoryTransport` gateway tests |
| Lint/format | Biome 2.5.9, `biome ci .` | One binary, identical on all OSes |
| Versioning | Changesets 3.0.1, fixed group `["qa-brain", "@qa-brain/*"]` | One version line; publishing disabled in M0 |
| Schemas | Zod 4.4.3 | Required by SDK v2; `z.toJSONSchema()` emits wire schemas |

Workspace (`pnpm-workspace.yaml`: `packages/*`, `apps/*`, `examples/*`):

- `@qa-brain/core` — interfaces, config schema, `tool-name.ts`, `redact.ts`, `handle.ts`; runtime deps only `zod` and `uuidv7`.
- `@qa-brain/store` — Drizzle ORM 0.45.2 schemas for SQLite (`@libsql/client` 0.17.4) and Postgres (`pg` 8.23.0); drizzle-kit 0.31.10 migrations.
- `@qa-brain/adapter-playwright` — `playwright@1.62.1` dependency, CLI resolution, flag validation, tool table.
- `@qa-brain/gateway` — config, upstream manager, registry, router, action log, handles, server factory, transports.
- `@qa-brain/test-format`, `@qa-brain/healing` — pure functions, nice-to-have in M0.
- `apps/qa-brain` — the `qa-brain` CLI (commander 15.0.0): `serve`, `doctor`, `tools list`.
- `examples/static-site`, `examples/mcp-configs` — smoke target and client snippets.

All `@qa-brain/*` packages are `private: true`; only `qa-brain` will reach npm.

**Cross-platform parity requirement.** `pnpm build && pnpm lint && pnpm typecheck && pnpm test && QA_BRAIN_E2E=1 pnpm smoke` must pass on Windows and Linux in CI (macOS nightly). Upstreams are spawned as `node <resolved cli.js>`, never through `npx` or `.cmd` shims; child trees are killed with `taskkill /PID <pid> /T /F` on Windows and SIGTERM→SIGKILL elsewhere; paths come from `node:path` and `createRequire(import.meta.url)`; native modules are avoided (`@libsql/client` ships prebuilt binaries for Node 22 and 24 on win32).

## Consequences

**Positive.** One language across gateway, adapters, CLI, runner, and tests. SDK, Playwright, and appium-mcp resolve from one `node_modules`, so `qa-brain doctor` verifies versions and CLI flags from installed packages. ESM-only avoids dual-package hazards.

**Negative.** ESM requires `.js` suffixes on relative imports and `createRequire` for JSON; students used to CommonJS will trip on this. The 22.12 floor excludes Node 20 hosts although the SDK allows ≥20.

**Neutral.** Changesets adds a per-PR ritual that pays off once publishing starts; TypeScript 7.x can be adopted later without source changes.

## Alternatives considered

- **Python with `mcp` 2.0.0 or PrefectHQ FastMCP.** `mcp` 2.0.0 supports 2026-07-28 and FastMCP has the only first-class proxy, but FastMCP 4.x (the line on `mcp` 2) is still beta (4.0.0b1–b3) while 3.4.7 sits on `mcp` v1 ([releases](https://github.com/PrefectHQ/fastmcp/releases), [PyPI](https://pypi.org/project/mcp/)). A Python gateway would still need Node for Playwright and appium-mcp: two toolchains for no protocol gain.
- **npm or Yarn workspaces.** Workable; pnpm's strict layout catches undeclared cross-package imports.
- **ESLint + Prettier; Jest.** Proven, but configuration and plugin drift across three OSes is a poor use of student time; Vitest runs the SDK's ESM subpaths unmodified.
- **CommonJS output.** Fights the SDK's ESM-first packaging.

## References

- pnpm workspaces: <https://pnpm.io/workspaces>
- SDK v2 requirements (Node ≥20, ESM-first, Zod 4): <https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html>
- Playwright 1.62 release notes: <https://playwright.dev/docs/release-notes>
- appium-mcp metadata (Node ≥22): <https://registry.npmjs.org/appium-mcp/latest>
- Related: [ADR-0001](./0001-gateway-on-mcp-sdk-v2-low-level-server.md), [ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md), [ci-cd.md](../ci-cd.md), [CONTRIBUTING.md](../../CONTRIBUTING.md)
