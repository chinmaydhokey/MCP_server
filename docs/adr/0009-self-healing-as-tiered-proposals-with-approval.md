# ADR-0009: Self-healing as tiered proposals behind an approval gate

When a stored locator stops resolving, QA Brain relocates the element through four escalating tiers, from a zero-cost deterministic chain to an LLM re-rank over a short candidate list, but never edits the test definition on its own. Every successful heal is a `heal_proposal` row with score, margin, evidence, and status; the original locator stays primary until a human approves or a narrow auto-approval rule is met. This ADR fixes the tier order, thresholds, guardrails, and feedback loop.

## Status

Accepted — 2026-08-20

## Context

Autonomous repair loops fail in documented ways: assertion weakening (`toBe(5)` → `toBeTruthy()`), silent test deletion, non-convergence in 30% of failure families, hallucinated interactions in 12% of reports; the recommended guardrails are live-DOM validation of every selector, a 6–7 attempt bound, and human approval for any assertion change ([arXiv 2605.01471](https://arxiv.org/html/2605.01471)). Playwright's shipped healer edits test source directly and marks stubborn tests `test.fixme()` ([healer definition](https://github.com/microsoft/playwright/blob/main/packages/playwright/src/agents/playwright-test-healer.agent.md)), a coverage-reducing default we do not inherit.

Healenium applies healed locators at runtime only, surfaces them for approval, accepts candidates above a `score-cap` of 0.6, and since 2.1.9 suppresses heals a user marked wrong ([Healenium](https://github.com/healenium/healenium-web/blob/master/README.md), [how it works](https://healenium.io/docs/how_healenium_works)). Similo++ relocates 99.4% of broken elements on a 10,376-pair benchmark with weighted similarity over 16 properties ([Similo++](https://link.springer.com/article/10.1007/s10664-026-10903-6)); its LLM-as-final-ranker variant could not be reproduced ([VON Similo LLM](https://arxiv.org/html/2310.02046v1)). A deterministic 10-tier accessibility-tree chain heals in 3–5 s versus 30–90 s for LLM rediscovery ([arXiv 2603.20358](https://arxiv.org/html/2603.20358v1)); whole-page prompts average 21.7k tokens ([arXiv 2312.05778](https://arxiv.org/html/2312.05778)). Momentic's ladder (L1 re-resolution without editing, L2 transient recovery capped at 3 per run, L3 reviewable repair PRs, L4 quarantine) is the closest product analog ([Momentic auto-maintenance](https://momentic.ai/docs/reliability/auto-maintenance.md)).

## Decision

1. **Classify first.** Failures are labeled `infra | runtime_error | test_data | interaction_change | timing | selector | visual`; only `selector` enters the tiers.
2. **T0 deterministic chain** in the 2603.20358 order: role+name → role → `data-testid` → `id` → aria-label exact → aria-label contains → href fragment → class exact → class contains → visible text. A candidate counts only if it resolves to exactly one element.
3. **T1 weighted similarity** over interactive nodes of a fresh snapshot with matching role or tag family, using `step_fingerprint.signals` and the weights in [self-healing.md](../self-healing.md) (testid, html_id, role+name 1.5; text, aria_label 1.25; placeholder, name_attr, neighbor_texts, ancestor_path, xpath_id_rel 1.0; type, classes, href 0.75; tag, bbox, area 0.5), normalized over attributes present in the fingerprint. Accept iff `top ≥ 0.6` ∧ `top − second ≥ 0.1` ∧ locator unique. Candidates matching any `rejected` fingerprint for the step score 0.
4. **T2 LLM re-rank** only when T1 has candidates but fails cap or margin: `k ≤ 10` candidates, payload ≤ 3k tokens (fingerprint, intent, URL, a `web_find` excerpt, never the whole page), JSON-schema output `{chosen_ref, confidence, rationale, rejected_refs}`, `chosen_ref` validated against the list, locator regenerated, uniqueness re-checked. T2 results **never** auto-approve.
5. **T3 visual tie-break**: 64-bit DCT pHash of stored crop versus candidate crops, Hamming ≤ 10, used only when two T1 candidates are within 0.05 or to confirm T2; never sole evidence.
6. **Verification**: the step runs with the healed locator and is checked with `web_verify_element_visible` or its own `expect`; the role family must match the old element unless T2 justified otherwise.
7. **Proposals**: every heal writes `heal_proposal {kind, tier, score, margin, candidates, evidence, yaml_patch, status}`, status ∈ `proposed | auto_approved | approved | rejected | superseded | expired`, `uq(step_id, new_fingerprint_id)`. The run uses the proposal for the current attempt only; the original fingerprint stays `active`.
8. **Auto-approve rule**: `kind = 'locator'` ∧ `tier ∈ {T0, T1}` ∧ `score ≥ 0.8` ∧ `margin ≥ 0.1` ∧ `consecutive_passes ≥ 3` on distinct runs spanning ≥ 2 `git_sha` values; then the new fingerprint becomes `active`, the old `superseded`.
9. **Never touch assertions**: `intent_text` proposals on `assert` steps are rejected at creation; `expect`, `negative`, and assertion text are immutable to the healer. Steps with `heal: false`, `negative: true`, or kind `data` are excluded.
10. **Bounds**: ≤ 3 heal attempts per step, ≤ 6 per test attempt, then `needs_human`; per-tier time boxes 10 s / 20 s / 60 s / 10 s.
11. **Feedback loop**: `qa_heal_review(id, 'rejected', reason)` marks the new fingerprint `rejected`, excluding it from scoring permanently; three rejections on one step yield a `heal: false` suggestion in the report.

## Consequences

**Positive.** T0 and T1 are pure TypeScript with no LLM cost: deterministic, reproducible, benchmarkable ([research track](../research-track.md)). The approval gate and immutable assertions remove the two worst failure modes from 2605.01471 by construction, not by prompt. The margin check prevents the silent wrong-sibling heals a bare 0.6 cap allows in lists and grids.

**Negative.** A review surface (`qa_heal_list`, `qa_heal_show`, `qa_heal_review`, the `qabrain://proposals/{id}` resource, PR comments) must be built or proposals accumulate. Auto-approval needs three passes on two SHAs, so a renamed button stays a proposal for days on a quiet branch. T3 needs screenshots, which `--image-responses=omit` suppresses on the LLM path; they are captured out of band.

**Neutral.** M0 ships `score()`, the T0 chain, and `classify()` as pure functions with fixture tests; tiers are wired into runs in M3 (T0/T1) and M6 (T2/T3). Weights are starting values the harness may tune.

## Alternatives considered

- **LLM-first healing** (re-author the failing step from the snapshot): slow, costly, non-reproducible, prone to assertion weakening.
- **Fallback chain without scoring** (Katalon/Ranorex style): no confidence signal, no way to rank multiple survivors.
- **Silent auto-apply with YAML write-back**: highest apparent heal rate, but every false heal becomes a permanently wrong test.
- **Visual-first matching** (VISTA): robust to DOM churn, brittle under restyling; kept as tie-break only.

## References

- [Healenium README](https://github.com/healenium/healenium-web/blob/master/README.md), [How Healenium works](https://healenium.io/docs/how_healenium_works)
- [Similo++ / HybridSimilo](https://link.springer.com/article/10.1007/s10664-026-10903-6), [VON Similo LLM](https://arxiv.org/html/2310.02046v1)
- [arXiv 2603.20358](https://arxiv.org/html/2603.20358v1), [arXiv 2605.01471](https://arxiv.org/html/2605.01471), [arXiv 2312.05778](https://arxiv.org/html/2312.05778)
- [Momentic auto-maintenance ladder](https://momentic.ai/docs/reliability/auto-maintenance.md)
- [Self-healing](../self-healing.md), [test format](../test-format.md), [data model](../data-model.md)
- [ADR-0008](./0008-artifacts-on-s3-compatible-storage.md), ADR-0014 (LLM runner)
