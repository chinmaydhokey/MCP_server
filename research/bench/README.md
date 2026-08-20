# QA Brain Benchmark Harness (`research/bench`)

> **Status: design only — no code in M0.** This directory documents the layout, CLI, and result schema of the mutation-based benchmark harness that workstream D builds in M7 and runs as a campaign in M8 ([roadmap](../../docs/roadmap.md)). The methodology, metrics, baselines, and pre-registered hypotheses live in [docs/research-track.md](../../docs/research-track.md); this file is the engineering contract the harness must satisfy so that results are reproducible by anyone with the repository.

## Purpose

The harness applies seeded UI mutations to the example applications, runs QA Brain and three baselines (B0 raw Playwright MCP + LLM, B1 Playwright healer agent, B2 Healenium 2.2.1 proxy) against each mutant, and scores heal correctness, false heals, assertion weakening, TIA precision/recall, tokens/USD, wall time, and convergence against a ground truth the systems never see.

## Planned layout

```text
research/bench/
  README.md                 this file
  manifest.json             campaign manifest: model ids, list prices, playwright/appium versions, git SHAs, thresholds
  operators/                one module per mutation operator (rename-text, move-element, restyle, remove-element,
                            add-banner, change-route, reorder-list, wrap-in-shadow-dom) + compose equivalents
  mutants/<app>/<op>/<seed>/
    mutation.patch          git patch applied on top of examples/<app> at the manifest SHA
    truth.json              transformed element before/after + operator label (heal | propose-only | fail)
    affected.json           tests that fail on this mutant with healing off (ground truth for healing and TIA)
  systems/                  adapters that drive each system under test with identical inputs
    qa-brain-{q1,q2,q3}.ts  T0+T1 · +T2 · +T3
    b0-raw-mcp.ts           Playwright MCP (playwright 1.62.1) + LLM re-authoring the failing step
    b1-playwright-healer.ts generated .spec.ts twin suite + healer agent (init-agents --loop=claude)
    b2-healenium/           docker-compose for hlm-backend, postgres, selector-imitator, playwright proxy
  twin/                     generator: YAML tests → Playwright .spec.ts twin for B1
  results/<campaign>/<mutant>/<system>/<model>/rep<k>.json   campaign id = milestone prefix + date, e.g. m8-2027-05
  reports/<campaign>/       summary.csv, by-operator.csv, hypotheses.json, figures/
  notebooks/                analysis notebooks that read reports/ only
```

## CLI verbs

The harness is a small TypeScript CLI (`pnpm bench …`, package `@qa-brain/bench`, private) with three verbs:

| Verb | Arguments | Effect |
|---|---|---|
| `bench mutate` | `--app shop\|todo-android --op <op> --seed <n> [--all]` | Applies the operator with a seeded PRNG, writes `mutation.patch` and `truth.json`, then runs the suite with healing off to write `affected.json`. `--all` produces the full 10 × 8 × 2 = 160-mutant set. Deterministic: same seed, same patch. |
| `bench run` | `--campaign <id> --system q1\|q2\|q3\|b0\|b1\|b2 --model <id> --rep <k> [--mutant <app/op/seed>]` | Checks out the mutant in a fresh worktree, starts the app and the system under test in isolated state (fresh SQLite store, `--isolated` browser context, seeded data), executes the suite, and writes one result JSON per cell. Refuses to run if `manifest.json` differs from the one recorded in existing results of the campaign. |
| `bench report` | `--campaign <id> [--format csv\|md\|json]` | Joins results with `truth.json`/`affected.json`, computes the metrics, bootstrap 95% CIs (1,000 resamples), and the H1–H4 verdicts; writes `reports/<campaign>/`. |

Heal correctness is decided by `bench report`, never by the running system: a step is correctly healed only when the verified locator resolves to the element in `truth.json` (role + accessible name + id-relative XPath).

## Result JSON schema (per cell)

```json
{
  "schema": "qabrain/bench-result/v1",
  "campaign": "m8-2027-05",
  "manifestSha256": "…",
  "mutant": { "app": "shop", "op": "rename-text", "seed": 3, "label": "heal" },
  "system": "q2",
  "model": "claude-sonnet-5",
  "rep": 1,
  "startedAt": "2027-05-04T09:12:41Z",
  "wallMs": 412880,
  "tests": [
    {
      "key": "checkout/add-to-cart",
      "affected": true,
      "status": "passed",
      "healsUsed": 1,
      "needsHuman": false,
      "assertionsChanged": 0,
      "steps": [
        { "ordinal": 5, "cacheStatus": "HEALED", "tier": "T1", "score": 0.87, "margin": 0.31,
          "autoApproved": false, "correct": true, "durationMs": 2140,
          "tokensIn": 0, "tokensOut": 0 }
      ]
    }
  ],
  "tia": { "selected": ["checkout/add-to-cart", "smoke/home-loads"], "fallbackToRunAll": false },
  "usage": { "tokensIn": 18422, "tokensOut": 1210, "cacheReadTokens": 9100, "cacheWriteTokens": 2200, "usd": 0.0337 },
  "artifacts": [{ "kind": "snapshot", "id": "0198c2d4-…" }]
}
```

`usd` is computed at the list prices frozen in `manifest.json` (2026-08-20: `claude-opus-5` $5/$25, `claude-sonnet-5` $2/$10, `gpt-5.6-terra` $2/$12 per MTok; Ollama $0) using `uncached·P_in + cached·0.1·P_in + cache_write·1.25·P_in + output·P_out`. Token counts come from the `gen_ai.usage.*` span attributes exported by the gateway ([observability](../../docs/observability.md)) and `step_result.llm_tokens_in/out`.

## Rules

- Operators, seeds, and thresholds are committed before T2/T3 exist; changing any of them starts a new campaign id.
- Baselines run with their documented defaults; the exact command lines and compose files are part of the results.
- `truth.json` is never mounted into the system under test.
- Result JSON is append-only; only `bench report` aggregates it.
