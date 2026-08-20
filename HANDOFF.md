# QA Brain — work-in-progress handoff (2026-08-20)

> Temporary file. Delete it before opening the pull request.

## Where we are

Branch `feat/blueprint` (local only — nothing pushed yet, see **Blocker**). `main` has one local commit
(README + Apache-2.0 LICENSE) that also still needs pushing.

### Done and verified
- **Monorepo scaffold** — pnpm 10 workspaces, Node ≥ 22.12, TS 5.9 (NodeNext ESM), tsup, vitest 4
  (root `vitest.config.ts` with `unit` / `e2e` projects and workspace aliases), Biome 2, changesets,
  `.gitattributes` (LF), `.gitignore` (ignores `.env`).
- **`@qa-brain/core`** — config zod schema, tool-name rules, redaction + args-shape, handles, interfaces.
  12 unit tests pass.
- **`@qa-brain/adapter-playwright`** — curated tool table (15 listed / 12 hidden / blocked incl.
  `browser_run_code_unsafe`, `browser_evaluate`), CLI resolution (`node <playwright pkg>/cli.js mcp`, no npx),
  default flags, `--help` flag validation. 4 unit tests pass.
- **`@qa-brain/gateway`** — config loader (`${VAR}` expansion + secret registration), `UpstreamManager`
  (era negotiation with cache, health probes, backoff restarts, Windows-safe `taskkill /T`), `ToolRegistry`
  (prefixing, collisions, deterministic list, budget), `Router` (pass-through, size cap, every failure as
  `isError` + hint), `ActionLog`, native tools (`qa_health`, `qa_run_start|finish|log`, `qa_search_tools`,
  `qa_describe_tool`, `qa_call_tool`) plus six stubs, stdio + HTTP transports. Typechecks clean.
- **`@qa-brain/store`** — 17-table Drizzle schema for both dialects, migrations generated, adapters.
  (Built by an agent; see open issues below.)
- **Docs** — `ARCHITECTURE.md`, 15 ADRs, and `docs/*.md` (~41k words) written by the docs workflow.
- **Spikes** (`packages/gateway/spikes/`) proved: SDK v2 low-level `Server` + `setRequestHandler` works;
  `StdioClientTransport` exposes `pid`/`stderr`; `playwright@1.62.1 mcp --caps=testing` serves 29 tools and
  its child exits cleanly on Windows.

### Immediate next steps
1. **Fix two failing unit tests** (126 pass, 2 fail):
   - `packages/gateway/test/units.test.ts` → "reads yaml files…": `${PORT:-9999}` expands to a *string*, so
     `http.port` fails validation. Fix in `packages/core/src/config-schema.ts`: use `z.coerce.number()` for
     numeric fields that can come from env (`port`, timeouts, sizes).
   - `packages/gateway/test/gateway.test.ts` → "fails fast on tool-name collisions": the generic adapter with
     `prefix: 'qa_'` produced `qa_health` without colliding — check `registerUpstream` ordering
     (natives are registered first, so this should throw) and the pass-through path in `classify`.
   - `packages/store/test/sqlite-adapter.test.ts` → "sqlite adapter (file URL)" hook timed out (10 s); likely
     the migrations folder resolution for a `file:` URL.
2. **`apps/qa-brain` CLI** — `serve --transport stdio|http`, `doctor`, `tools list` (design in the plan file).
3. **`examples/static-site`** + `apps/qa-brain/test/smoke.e2e.test.ts` (the M0 acceptance test).
4. **CI/deploy** — `.github/workflows/*`, `deploy/`, `docker/`, `renovate.json`.
5. **Reorganize into the 14-commit series**, delete this file, open the PR.

### Blocker — GitHub token permissions
The PAT in `.env` authenticates as **Siddharth-Basale** and the REST API reports `push: true` on the repo,
but every write returns `403 Resource not accessible by personal access token` and the response header
`x-accepted-github-permissions: metadata=read`. The fine-grained token has **no repository permissions
granted**. Fix at *Settings → Developer settings → Personal access tokens → Fine-grained tokens → (token) →
Edit*: repository access must include `chinmaydhokey/MCP_server` with **Contents: RW**, **Pull requests: RW**,
**Workflows: RW** (required to push `.github/workflows/*`). No need to regenerate the token value.

### Useful commands
```bash
corepack enable            # or: npm i -g pnpm@10
pnpm install
pnpm exec playwright install chromium
pnpm -r --if-present run typecheck
pnpm test                  # unit project
QA_BRAIN_E2E=1 pnpm smoke  # e2e project (once the smoke test exists)
```
