import type { HandleKind } from '@qa-brain/core';

/**
 * Shared enum value arrays. One TypeScript const per enum, referenced by both dialect schemas so the
 * allowed values can never drift between SQLite and Postgres.
 *
 * Decision: enums are stored as plain `text` columns on BOTH dialects (typed at the Drizzle level via
 * `text({ enum })`), not as `pgEnum` types. Adding a member to a `pgEnum` requires `ALTER TYPE … ADD VALUE`,
 * which cannot run inside a transaction on older Postgres versions and has no SQLite equivalent; text
 * columns keep the two migration trees structurally identical. Value validation happens in the
 * application (and in Zod schemas of the callers), which is where the scoring / state-machine logic lives
 * anyway (ADR-0006 §Consequences).
 */

export const RUN_STATUS = ['queued', 'running', 'passed', 'failed', 'cancelled', 'error'] as const;
export type RunStatusValue = (typeof RUN_STATUS)[number];

export const RUN_TRIGGER = ['manual', 'ci', 'schedule', 'tia', 'burn_in', 'attempt_to_fix'] as const;
export type RunTriggerValue = (typeof RUN_TRIGGER)[number];

export const ATTEMPT_STATUS = [
  'pending',
  'running',
  'passed',
  'failed',
  'timed_out',
  'error',
  'cancelled',
  'skipped',
] as const;
export type AttemptStatusValue = (typeof ATTEMPT_STATUS)[number];

export const ATTEMPT_OUTCOME = ['expected', 'unexpected', 'flaky', 'skipped', 'unmapped'] as const;
export type AttemptOutcomeValue = (typeof ATTEMPT_OUTCOME)[number];

export const FAILURE_CATEGORY = [
  'infra',
  'runtime_error',
  'test_data',
  'interaction_change',
  'timing',
  'selector',
  'visual',
] as const;
export type FailureCategoryValue = (typeof FAILURE_CATEGORY)[number];

export const STEP_RESULT_STATUS = ['passed', 'failed', 'skipped', 'healed', 'unmapped'] as const;
export type StepResultStatusValue = (typeof STEP_RESULT_STATUS)[number];

export const CACHE_STATUS = ['HIT', 'MISS', 'HEALED', 'BYPASS'] as const;
export type CacheStatusValue = (typeof CACHE_STATUS)[number];

export const ORACLE_KIND = ['structured', 'llm', 'none'] as const;
export type OracleKindValue = (typeof ORACLE_KIND)[number];

export const HEAL_KIND = ['locator', 'timing', 'interaction', 'intent_text'] as const;
export type HealKindValue = (typeof HEAL_KIND)[number];

export const HEAL_TIER = ['T0', 'T1', 'T2', 'T3'] as const;
export type HealTierValue = (typeof HEAL_TIER)[number];

export const HEAL_STATUS = [
  'proposed',
  'auto_approved',
  'approved',
  'rejected',
  'superseded',
  'expired',
] as const;
export type HealStatusValue = (typeof HEAL_STATUS)[number];

/** Current state of a test case; `quarantine` rows log the transitions between these states. */
export const TEST_CASE_STATUS = ['active', 'quarantined', 'disabled', 'attempt_to_fix', 'fixed'] as const;
export type TestCaseStatusValue = (typeof TEST_CASE_STATUS)[number];

export const QUARANTINE_REASON = [
  'flaky_alarm',
  'new_test_flaky',
  'manual',
  'broken_dependency',
  'attempt_to_fix_passed',
  'auto_unquarantine',
  'grace_expired',
] as const;
export type QuarantineReasonValue = (typeof QUARANTINE_REASON)[number];

/** Union of `ArtifactKind` from @qa-brain/core (`result`) and the data-model list (`yaml_patch`). */
export const ARTIFACT_KIND = [
  'screenshot',
  'crop',
  'snapshot',
  'trace',
  'video',
  'har',
  'console',
  'log',
  'diff',
  'result',
  'yaml_patch',
] as const;
export type ArtifactKindValue = (typeof ARTIFACT_KIND)[number];

/**
 * Handle kinds (`run|browser|device|snapshot|lock`); the prefixes `rn_|bh_|dh_|sn_|lk_` are minted by core.
 * Spelled out literally (instead of `Object.keys(HANDLE_KINDS)`) so the schema modules have no runtime import
 * of `@qa-brain/core` — drizzle-kit loads them standalone. The type-level check below fails compilation if
 * core ever adds or renames a kind.
 */
export const HANDLE_KIND = ['run', 'browser', 'device', 'snapshot', 'lock'] as const;
export type HandleKindValue = (typeof HANDLE_KIND)[number];
type AssertHandleKindsMatch = [HandleKindValue] extends [HandleKind]
  ? [HandleKind] extends [HandleKindValue]
    ? true
    : never
  : never;
const _handleKindsMatch: AssertHandleKindsMatch = true;
void _handleKindsMatch;

export const PLATFORM = ['web', 'android', 'ios'] as const;
export type PlatformValue = (typeof PLATFORM)[number];

export const STEP_KIND = ['navigate', 'act', 'assert', 'module', 'wait', 'data'] as const;
export type StepKindValue = (typeof STEP_KIND)[number];

export const LOCATOR_STRATEGY = [
  'role',
  'testid',
  'id',
  'label',
  'text',
  'css',
  'xpath',
  'accessibility_id',
  'resource_id',
  'class_chain',
  'predicate',
] as const;
export type LocatorStrategyValue = (typeof LOCATOR_STRATEGY)[number];

export const FINGERPRINT_STATUS = ['active', 'superseded', 'rejected'] as const;
export type FingerprintStatusValue = (typeof FINGERPRINT_STATUS)[number];

export const COVERAGE_KIND = ['spec_file', 'app_file', 'route', 'url', 'api_route', 'component'] as const;
export type CoverageKindValue = (typeof COVERAGE_KIND)[number];

export const COVERAGE_SOURCE = ['static_graph', 'istanbul', 'v8', 'router', 'network_log'] as const;
export type CoverageSourceValue = (typeof COVERAGE_SOURCE)[number];

export const TASK_KIND = ['run_suite', 'heal_batch', 'visual_batch', 'tia_select'] as const;
export type TaskKindValue = (typeof TASK_KIND)[number];

/** MCP Tasks extension statuses (`tasks/get`). */
export const TASK_STATUS = ['working', 'input_required', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatusValue = (typeof TASK_STATUS)[number];

export const TRANSPORT = ['stdio', 'http', 'inmemory'] as const;
export type TransportValue = (typeof TRANSPORT)[number];

export const PROTOCOL_ERA = ['legacy', 'modern'] as const;
export type ProtocolEraValue = (typeof PROTOCOL_ERA)[number];

export const GATEWAY_ERROR_CODE = [
  'unknown_tool',
  'blocked_tool',
  'invalid_args',
  'timeout',
  'cancelled',
  'upstream_unavailable',
  'upstream_error',
  'not_implemented',
  'internal',
] as const;
export type GatewayErrorCodeValue = (typeof GATEWAY_ERROR_CODE)[number];

/** Every enum, keyed by name — used by the dialect conformance test. */
export const ALL_ENUMS = {
  RUN_STATUS,
  RUN_TRIGGER,
  ATTEMPT_STATUS,
  ATTEMPT_OUTCOME,
  FAILURE_CATEGORY,
  STEP_RESULT_STATUS,
  CACHE_STATUS,
  ORACLE_KIND,
  HEAL_KIND,
  HEAL_TIER,
  HEAL_STATUS,
  TEST_CASE_STATUS,
  QUARANTINE_REASON,
  ARTIFACT_KIND,
  HANDLE_KIND,
  PLATFORM,
  STEP_KIND,
  LOCATOR_STRATEGY,
  FINGERPRINT_STATUS,
  COVERAGE_KIND,
  COVERAGE_SOURCE,
  TASK_KIND,
  TASK_STATUS,
  TRANSPORT,
  PROTOCOL_ERA,
  GATEWAY_ERROR_CODE,
} as const;
