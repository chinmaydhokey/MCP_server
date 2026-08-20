<!--
Title: Conventional Commits, e.g. "feat(gateway): add URL guard for web_navigate" or "docs: ADR-0016 step cache".
Sign every commit with DCO (`git commit -s`). Keep docs and code in separate PRs where practical.
-->

## Summary

<!-- What changes and why, in two to five sentences. Link the issue or milestone (e.g. "Closes #12", "Part of M1"). -->

## Type of change

- [ ] `feat` — new tool, config key, adapter or CLI command
- [ ] `fix` — bug fix (include the failing-then-passing test)
- [ ] `docs` — documentation only (including `docs/adr`)
- [ ] `refactor` / `perf` — no behavior change
- [ ] `test` — tests only
- [ ] `ci` / `chore` / `deploy` — workflows, tooling, compose files, Dockerfiles
- [ ] Breaking change (tool removed or renamed, schema migration that is not additive, config key removed)

## Workstream and milestone

<!-- A gateway/transports · B store/healing/TIA · C mobile/parity · D runner/GitHub/dashboard/research — and the milestone from docs/roadmap.md -->

## Checklist

- [ ] `pnpm lint` (Biome) passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` (unit) passes on my OS
- [ ] `QA_BRAIN_E2E=1 pnpm smoke` passes, or the change cannot affect the gateway path (state why)
- [ ] A changeset was added (`pnpm changeset`), or the change is not user-visible
- [ ] Docs updated: tool catalog for new tools, data model for schema changes, client-setup for config changes
- [ ] ADR added or superseded in `docs/adr` if this changes an accepted decision (or not applicable)
- [ ] Default `tools/list` still has at most 25 entries and every name matches `^[a-zA-Z0-9_-]{1,64}$`
- [ ] `browser_run_code_unsafe` and `browser_evaluate` remain blocked; no inbound `Authorization` header is forwarded
- [ ] No secrets, tokens, `.env` files or private URLs in the diff (`git grep -n "github_pat_\|ghp_\|sk-ant-"` is empty)
- [ ] Dependencies are exact versions; no `better-sqlite3`; no `npx` at runtime
- [ ] Commits are signed off (DCO)

## How to verify

<!-- Exact commands and expected output a reviewer can run, e.g.
qa-brain serve --dry-run --config qa-brain.config.example.json
qa-brain tools list --json | jq 'length'   # expect 22
-->

## Screenshots / logs

<!-- Gateway stderr at --log-level debug, an action_log excerpt, report screenshots, or a trace link. Redact before pasting. -->

## Notes for reviewers

<!-- Risky areas, follow-ups, anything deliberately left out of this PR. -->
