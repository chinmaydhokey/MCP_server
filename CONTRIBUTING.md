# Contributing to QA Brain

QA Brain is a TypeScript monorepo (pnpm workspaces, Node 22 LTS, ESM) that builds an MCP gateway for autonomous web and mobile testing. This guide covers what you need installed, how to build and test the repository on Linux, macOS and Windows, the coding standards that CI enforces, how changes are versioned with changesets, how architectural decisions are recorded as ADRs, and the commit and pull-request conventions. Read [ARCHITECTURE.md](./ARCHITECTURE.md) and the [roadmap](./docs/roadmap.md) first if you are new; they explain what each package is for and which milestone it belongs to.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `>=22.12` (`.nvmrc` pins 22; developed on 24) | `engine-strict=true` in `.npmrc` fails the install on older versions. |
| pnpm | `10.34.5` (`packageManager` field) | Preferred: `corepack enable && corepack prepare pnpm@10.34.5 --activate`. Alternative: `npm install -g pnpm@10`. |
| Chromium for Playwright | matches `playwright@1.62.1` | `pnpm exec playwright install chromium` (add `--with-deps` on Debian/Ubuntu CI images). |
| Git | any recent | Line endings are normalized to LF by `.gitattributes`. |

No global TypeScript, Biome or Vitest install is needed; everything runs through `pnpm exec`.

## Clone, install, build, test

```bash
git clone https://github.com/chinmaydhokey/MCP_server.git
cd MCP_server
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build          # tsup, every package and the CLI
pnpm lint           # biome ci .
pnpm typecheck      # pnpm -r run typecheck (tsc --noEmit per package)
pnpm test           # vitest, project "unit"
QA_BRAIN_E2E=1 pnpm smoke   # vitest, project "e2e": real Playwright MCP child + SQLite
node apps/qa-brain/dist/cli.js doctor
```

`pnpm smoke` is a no-op unless `QA_BRAIN_E2E=1` is set; on PowerShell use `$env:QA_BRAIN_E2E = '1'; pnpm smoke`. The smoke test serves `examples/static-site` on an ephemeral port, starts the gateway in-process and as a binary (`dist/cli.js`), lists tools, navigates, snapshots, clicks, reads `action_log` from a temporary SQLite file, and asserts the child process tree is gone. It takes 30–90 s depending on the machine.

## Project layout

```
packages/core               contracts: zod config schema, interfaces, tool-name rules, redaction, handles
packages/store              Drizzle schemas for SQLite (@libsql/client) and Postgres (pg), adapters, migrations
packages/adapter-playwright tool table, playwright/cli.js resolution, flag validation
packages/gateway            server factory, registry, router, upstream supervisor, action log, transports
packages/test-format        qabrain/test/v1 YAML schema, canonicalization, cache keys
packages/healing            failure classifier, T0 chain, similarity scoring (pure functions)
apps/qa-brain               CLI: serve | doctor | tools list; test/smoke.e2e.test.ts
examples/static-site        three-page site used by the smoke test
examples/mcp-configs        .mcp.json, cursor.mcp.json, codex.config.toml
docs/, docs/adr/            design documents and decision records
deploy/, docker/            compose files, Dockerfiles, seccomp profile, egress ACL (design only in M0)
```

## Coding standards

- **Biome 2.5.9** is the single linter and formatter (`biome.json`: 2-space indent, 110-column lines, single quotes, trailing commas). Run `pnpm lint:fix` before pushing; CI runs `biome ci .` and fails on any error.
- **ESM with NodeNext.** Every package has `"type": "module"`; relative imports must carry the `.js` suffix even when the source file is `.ts` (`import { redact } from './redact.js'`). `verbatimModuleSyntax` is on, so use `import type` for types; Biome's `useImportType` rule is an error.
- **zod 4.4.3** for every schema that crosses a boundary (config, tool input/output, YAML). Use `z.toJSONSchema()` for MCP tool schemas; do not hand-write JSON Schema.
- **No `any`.** Biome reports `noExplicitAny`; reviewers treat it as blocking. Prefer `unknown` plus a zod parse. `noUncheckedIndexedAccess` is enabled, so index results are `T | undefined`.
- **Exact dependency versions.** No caret or tilde ranges; Renovate proposes bumps. Never add `better-sqlite3`: the SQLite driver is `@libsql/client`.
- **Tool names** must match `^[a-zA-Z0-9_-]{1,64}$` and be at most 40 characters; proxied tools use the `web_` / `mobile_` prefix, natives `qa_`. The default `tools/list` must stay at or below 25 entries (a unit test enforces this).
- **Never write to stdout in stdio mode.** stdout is the protocol channel; log through the pino logger, which is bound to stderr.
- **Redact before you log or persist.** Anything that may contain a secret goes through `@qa-brain/core`'s `redact()`; the action log stores argument shape and a hash, never raw secrets.

## Tests

Tests use **Vitest 4.1.11** with two projects defined in the root `vitest.config.ts`:

- `unit` (`pnpm test`): fast, no network, no browser. Gateway tests drive a fake upstream over `InMemoryTransport.createLinkedPair()` in both protocol eras. Store tests run against a temporary SQLite file; Postgres code must compile but is not exercised in M0.
- `e2e` (`QA_BRAIN_E2E=1 pnpm smoke` or `pnpm test:e2e`): spawns the real Playwright MCP child and Chromium. Files are named `*.e2e.test.ts`.

Put tests next to the code in `packages/<name>/test/`. A bug fix must include a failing-then-passing test. Run `pnpm -r --filter @qa-brain/gateway test` to scope to one package.

## Changesets

Every user-visible change needs a changeset (`@changesets/cli` 3.0.1):

```bash
pnpm changeset        # pick packages, bump type, write a one-line summary
git add .changeset/*.md
```

All packages are in one fixed version group (`fixed: [["qa-brain", "@qa-brain/*"]]`), so pick `patch` for fixes, `minor` for new tools or config keys, `major` only for removals. `release.yml` turns accumulated changesets into a version PR on `main`; npm publishing stays disabled until the package scope exists.

## Architecture Decision Records

Decisions that are hard to reverse (protocol version, storage engine, tool naming, auth model) live in `docs/adr/` as `NNNN-short-slug.md`, numbered sequentially; the M0 set is 0001–0015, so the next is `0016`. Each ADR uses the template:

```
# ADR-NNNN: Title
<one-paragraph abstract>
## Status
Proposed | Accepted — YYYY-MM-DD | Superseded by ADR-MMMM
## Context
## Decision
## Consequences   (positive / negative / neutral)
## Alternatives considered
## References
```

Open the ADR as its own pull request labeled `needs-adr`, get one approval from each maintainer, then merge with the Status section reading `Accepted — <merge date>` (the M0 set reads `Accepted — 2026-08-20`). To change a decision, write a new ADR that supersedes the old one; never edit an accepted ADR's Decision section.

## Commits and pull requests

- **Conventional Commits** ([spec](https://www.conventionalcommits.org/en/v1.0.0/)): `feat(gateway): …`, `fix(store): …`, `docs: …`, `ci: …`, `chore: …`, `test: …`. Scopes are package names without the `@qa-brain/` prefix.
- **DCO sign-off** on every commit (`git commit -s`), certifying the [Developer Certificate of Origin](https://developercertificate.org/). Unsigned commits are rejected in review.
- Branch from `main` as `feat/<topic>`, `fix/<topic>` or `docs/<topic>`. Keep PRs under roughly 500 changed lines where possible; split docs from code.
- Fill in the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md): lint, typecheck, unit and smoke all green locally; changeset added; docs or ADR updated; no secrets in the diff (`git grep -n "github_pat_\|ghp_\|sk-ant-"` must be empty).
- One maintainer approval is required; [CODEOWNERS](./.github/CODEOWNERS) requests the right reviewers automatically.

## Windows notes

- Use PowerShell or Git Bash; both work. Set environment variables with `$env:NAME = 'value'` in PowerShell.
- Enable long paths once: `git config --global core.longpaths true`.
- The gateway never launches `npx` or `.cmd` shims; the Playwright MCP server is spawned as `node <playwright>/cli.js mcp …`, resolved through `require.resolve('playwright/package.json')`. If you add an upstream, follow the same pattern.
- Orphaned processes after a crashed test show up as `node.exe` and `chrome.exe`. List them with `Get-Process node, chrome` and remove a tree with `taskkill /PID <pid> /T /F`; the gateway uses the same command on shutdown.
- Playwright browsers live in `%LOCALAPPDATA%\ms-playwright`; delete that directory and re-run `pnpm exec playwright install chromium` if Chromium fails to launch after a version bump.
- Runtime state defaults to `./.qa-brain` (`QA_BRAIN_HOME`); it is gitignored.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](./SECURITY.md) and use GitHub Security Advisories on this repository.

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). By participating you agree to uphold it.
