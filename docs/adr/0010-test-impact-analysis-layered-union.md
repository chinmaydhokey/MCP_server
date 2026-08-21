# ADR-0010: Test impact analysis as a safe layered union with full-run fallback

QA Brain selects end-to-end tests for a pull request as the union of five evidence layers (static import graph, dynamic coverage map, route-to-component map, network route map, always-run smoke set) and falls back to running everything whenever no layer can vouch for a changed file. Selected tests are ordered by a fixed priority formula and optionally cut to a time budget. This ADR records the selection rule, bail-outs, prioritization, output schema, and why a learned selector is deferred.

## Status

Accepted — 2026-08-20

## Context

Static import-graph selection (Jest `--findRelatedTests`, Playwright `--only-changed`) sees only the spec repository: it misses `moduleNameMapper` and path aliases ([Jest #10222](https://github.com/jestjs/jest/issues/10222)), dynamic `import()`, DI registries, is Git-only, and for E2E never sees application code ([Playwright test CLI](https://playwright.dev/docs/test-cli), [#32070](https://github.com/microsoft/playwright/issues/32070)). Coverage-based selection is the safer family: Ekstazi reruns tests whose recorded file-dependency checksums changed ([Ekstazi](https://users.ece.utexas.edu/~gligoric/papers/GligoricETAL15Ekstazi.pdf)); testpick maps V8 coverage per test file and runs the full suite for any unmapped change, "when in doubt, run more, never less" ([testpick](https://registry.npmjs.org/testpick/latest)). Datadog Test Impact Analysis adds "tracked files" globs that force a full run and no skipping above 5,000 changed files; it does not support Playwright ([Datadog TIA](https://docs.datadoghq.com/tests/test_impact_analysis/)). Coverage cannot see dependency upgrades, bundler config, env vars, i18n, or data changes, so a tracked-files list is mandatory.

Learned selectors exist at scale: Meta's Predictive Test Selection catches >95% of individual failures at half the cost ([Meta PTS](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/)); Launchable sells `--confidence` and `--time` subsets after an observation period ([Launchable](https://help.launchableinc.com/features/predictive-test-selection/)). Both need months of outcome history a new project lacks. Momentic's `--ai-select` output (`selectedTests`, `fallbackToRunAll`) is the closest product precedent ([Momentic select](https://momentic.ai/docs/ai/select.md)).

## Decision

1. **Selection** `S = static ∪ coverage ∪ route ∪ network ∪ smoke`, computed by `qa_impact_select({base, head, budget?})` from `git diff --name-status base...head`:
   - *static*: import graph of the spec repo (YAML tests → modules → fixtures);
   - *coverage*: `coverage_map` rows of kind `app_file` (Istanbul `window.__coverage__` read internally, or V8 precise coverage), matched by path and `checksum`;
   - *route*: framework router map (Next.js, React Router, Angular) joined with `url` rows each test visited;
   - *network*: `api_route` rows from `browser_network_requests`, normalized (`/orders/123` → `/orders/:id`), joined to a server route map when provided;
   - *smoke*: tests tagged in `project.settings.smoke_tags`, always selected.
2. **Full-run fallback** (`fallbackToRunAll = true`, with `fallbackReason`) when: a changed path matches `tracked_globs` (defaults `package.json`, lockfiles, `Dockerfile*`, `.env*`, `*config.{js,ts,json}`, `i18n/**`, global CSS, auth/layout components); changed files > `max_changed_files` (default 200; Datadog's 5,000 assumes monorepos); a changed app file has no `coverage_map` row in any layer; the map is stale (no full run on `default_branch` within 7 days); or the diff is unavailable. Tests with zero map rows are `new` and always selected. Quarantined tests are excluded unless `--include-quarantined`; disabled tests never run.
3. **Prioritization** of the selected set:

   `priority = 0.4·fail_rate_30d + 0.3·coverage_frac + 0.2·1/(1+dist) + 0.1·(1−dur_norm)`

   where `fail_rate_30d` is the failure rate on `default_branch` over 30 days excluding `infra_outage` runs, `coverage_frac = changed_files_covered / changed_files_total`, `dist` is the shortest graph distance from a changed file to the test (0 when covered directly), and `dur_norm` is p50 duration normalized over the project. The weights are a design decision drawn from the Meta and Launchable feature sets and a tuning target on the research harness.
4. **`--time-budget <duration>`** runs the highest-priority prefix whose summed p50 durations fit; the remainder is reported as `notRun` with reason `budget`.
5. **Output schema**:

   ```json
   { "selectedTests": [{ "key": "checkout/add-to-cart", "platform": "web", "priority": 0.71,
       "reasons": [{ "layer": "coverage", "evidence": "src/cart/Badge.tsx" }] }],
     "fallbackToRunAll": false, "fallbackReason": null,
     "notRun": [{ "key": "about/footer", "reason": "not_impacted" }],
     "mapFreshness": { "lastFullRunAt": "2026-08-19T03:00:00Z", "staleEntries": 0 } }
   ```

   `reasons[].layer ∈ static | coverage | route | network | smoke | new`; `notRun[].reason ∈ budget | quarantined | disabled | not_impacted`.
6. **Freshness**: a nightly full run on `default_branch` rewrites `coverage_map` (`captured_run_id`, checksums). An entry expires after 14 days, or earlier when its `checksum` no longer matches the file at `head` and the test has not run since. `mapFreshness` is returned with every result.
7. **No ML selector in v1.** Failure rate is the only historical feature; a learned model is a research-track item once enough outcomes exist ([research track](../research-track.md)).

## Consequences

**Positive.** Every selection is explainable by `reasons[]` and reproducible from the store, which a thesis evaluation and a PR reviewer both need. Safety is asymmetric: a missing edge can only cause over-selection or a full run, never a skipped affected test, provided the tracked-files list is maintained. Layers ship incrementally (static + coverage in M4, route and network later) without changing the contract.

**Negative.** Precision depends on the coverage layer, which needs an instrumented application build or Chromium-only V8 coverage; projects that cannot instrument get mostly static + smoke selection and frequent full runs. The 200-file bailout and 7-day staleness rule trigger often early on. Route maps are per-framework adapters.

**Neutral.** `qa_impact_select` is a hidden stub in M0; TIA code is M4 scope. Weights live in prioritization, never in selection.

## Alternatives considered

- **Static graph only** (Playwright `--only-changed` style): blind to application code for E2E; kept as one layer.
- **Coverage only** (Ekstazi / testpick style): the strongest single signal, yet blind to config, dependency, and data changes; kept as one layer with tracked files and bailouts around it.
- **Learned model first** (Meta PTS, Launchable): needs history and an observation phase, produces unexplainable skips, cannot be validated before M8; deferred.
- **LLM-judged selection from the diff** (Momentic Explore style): useful for suggesting coverage, not for safe skipping.
- **Run everything, always**: safe but removes the feature; the nightly full run keeps it as the freshness baseline.

## References

- [Jest #10222](https://github.com/jestjs/jest/issues/10222), [Playwright test CLI](https://playwright.dev/docs/test-cli), [Playwright #32070](https://github.com/microsoft/playwright/issues/32070)
- [Datadog Test Impact Analysis](https://docs.datadoghq.com/tests/test_impact_analysis/)
- [Ekstazi](https://users.ece.utexas.edu/~gligoric/papers/GligoricETAL15Ekstazi.pdf), [testpick](https://registry.npmjs.org/testpick/latest)
- [Meta Predictive Test Selection](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/), [Launchable](https://help.launchableinc.com/features/predictive-test-selection/)
- [Momentic select](https://momentic.ai/docs/ai/select.md)
- [Impact analysis](../impact-analysis.md), [flaky and quarantine](../flaky-and-quarantine.md), [data model](../data-model.md), [research track](../research-track.md)
- [ADR-0007](./0007-job-queue-pg-boss-on-postgres.md), [ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md)
