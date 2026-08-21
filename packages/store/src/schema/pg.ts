import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ARTIFACT_KIND,
  ATTEMPT_OUTCOME,
  ATTEMPT_STATUS,
  CACHE_STATUS,
  COVERAGE_KIND,
  COVERAGE_SOURCE,
  FAILURE_CATEGORY,
  FINGERPRINT_STATUS,
  GATEWAY_ERROR_CODE,
  HANDLE_KIND,
  HEAL_KIND,
  HEAL_STATUS,
  HEAL_TIER,
  LOCATOR_STRATEGY,
  ORACLE_KIND,
  PLATFORM,
  PROTOCOL_ERA,
  QUARANTINE_REASON,
  RUN_STATUS,
  RUN_TRIGGER,
  STEP_KIND,
  STEP_RESULT_STATUS,
  TASK_KIND,
  TASK_STATUS,
  TEST_CASE_STATUS,
  TRANSPORT,
} from './enums.js';

/**
 * Postgres schema — 17 tables, identical names and columns to `./sqlite.ts` (enforced by
 * `test/conformance.test.ts`).
 *
 * Type mapping: ids are app-generated UUIDv7 values in `uuid` columns (no DB default — the application
 * always supplies the id so both dialects behave identically; ADR-0006 §4). Timestamps are `bigint` epoch
 * milliseconds in `{ mode: 'number' }` rather than `timestamptz`, a deliberate deviation from ADR-0006 §5 so
 * that every row reads back with the same numeric shape (`Run.createdAt: number`) on both dialects without
 * per-dialect conversion code. JSON is `jsonb`; booleans are `boolean`; enums are `text` typed with the
 * shared arrays from `./enums.ts` (see the note in `enums.ts` on why not `pgEnum`).
 *
 * Handle primary keys (`handle.handle`, `run_attempt.handle_id`) and `action_log.run_id` stay `text`
 * because they carry prefixed handles (`rn_<uuid>`), not bare uuids.
 */

const id = (name = 'id') => uuid(name);
const ts = (name: string) => bigint(name, { mode: 'number' });
const json = (name: string) => jsonb(name);
const bool = (name: string) => boolean(name);

/* ---------------------------------------------------------------- project / auth */

export const project = pgTable(
  'project',
  {
    id: id().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    repoUrl: text('repo_url'),
    defaultBranch: text('default_branch').notNull().default('main'),
    /** `{ tracked_globs, smoke_tags, retries, thresholds, isolateCacheByEnvironment … }` */
    settings: json('settings'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('project_slug_uq').on(t.slug)],
);

export const apiKey = pgTable(
  'api_key',
  {
    id: id().primaryKey(),
    /** null = org-wide key. */
    projectId: id('project_id').references(() => project.id),
    name: text('name').notNull(),
    /** First 8 characters of the key, used for lookup. */
    prefix: text('prefix').notNull(),
    /** argon2id hash of the full key. */
    keyHash: text('key_hash').notNull(),
    scopes: json('scopes'),
    createdBy: text('created_by'),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('api_key_prefix_uq').on(t.prefix),
    index('api_key_project_active_idx').on(t.projectId).where(sql`${t.revokedAt} IS NULL`),
  ],
);

/**
 * Server-minted handles (`rn_…`, `bh_…`, `dh_…`, `sn_…`, `lk_…`). `owner` is the principal string from
 * `HandleRecord.owner` (api-key id, bearer principal, or `local`) rather than a FK to `api_key`, because
 * stdio mode has no api keys. Possession of a handle is not authentication: `owner` is checked on every use.
 */
export const handle = pgTable(
  'handle',
  {
    handle: text('handle').primaryKey(),
    kind: text('kind', { enum: HANDLE_KIND }).notNull(),
    owner: text('owner').notNull(),
    projectId: id('project_id').references(() => project.id),
    platform: text('platform', { enum: PLATFORM }),
    /** Playwright context id / Appium sessionId. */
    upstreamRef: text('upstream_ref'),
    state: json('state'),
    ttlS: integer('ttl_s'),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    index('handle_expires_at_idx').on(t.expiresAt).where(sql`${t.revokedAt} IS NULL`),
    index('handle_owner_idx').on(t.owner),
  ],
);

/* ---------------------------------------------------------------- tests */

export const testCase = pgTable(
  'test_case',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    /** Stable key from YAML `id:`. */
    key: text('key').notNull(),
    /** Repo-relative path. */
    path: text('path').notNull(),
    currentRevisionId: id('current_revision_id').references((): AnyPgColumn => testCaseRevision.id),
    owners: json('owners'),
    tags: json('tags'),
    platforms: json('platforms'),
    status: text('status', { enum: TEST_CASE_STATUS }).notNull().default('active'),
    firstSeenRunId: id('first_seen_run_id').references((): AnyPgColumn => run.id),
    lastRunAt: ts('last_run_at'),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('test_case_project_key_uq').on(t.projectId, t.key),
    index('test_case_project_status_idx').on(t.projectId, t.status),
  ],
);

/** Append-only: rows are never updated or deleted; `test_case.current_revision_id` is the moving pointer. */
export const testCaseRevision = pgTable(
  'test_case_revision',
  {
    id: id().primaryKey(),
    testCaseId: id('test_case_id')
      .notNull()
      .references(() => testCase.id),
    parentRevisionId: id('parent_revision_id').references((): AnyPgColumn => testCaseRevision.id),
    /** sha256 of canonical YAML with modules inlined. */
    contentHash: text('content_hash').notNull(),
    /** Parsed, module-resolved document. */
    content: json('content').notNull(),
    sourceText: text('source_text'),
    moduleHashes: json('module_hashes'),
    gitSha: text('git_sha'),
    author: text('author'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('test_case_revision_hash_uq').on(t.testCaseId, t.contentHash),
    index('test_case_revision_case_created_idx').on(t.testCaseId, t.createdAt),
  ],
);

export const testStep = pgTable(
  'test_step',
  {
    id: id().primaryKey(),
    revisionId: id('revision_id')
      .notNull()
      .references(() => testCaseRevision.id),
    ordinal: integer('ordinal').notNull(),
    /** Cache key without platform / env scope. */
    stepKey: text('step_key').notNull(),
    kind: text('kind', { enum: STEP_KIND }).notNull(),
    intent: text('intent'),
    params: json('params'),
    /** `{ heal, cache, timeout, negative, only, skip }` */
    flags: json('flags'),
    moduleRef: text('module_ref'),
    platformOverlays: json('platform_overlays'),
  },
  (t) => [
    uniqueIndex('test_step_revision_ordinal_uq').on(t.revisionId, t.ordinal),
    index('test_step_key_idx').on(t.stepKey),
  ],
);

export const stepFingerprint = pgTable(
  'step_fingerprint',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    stepKey: text('step_key').notNull(),
    platform: text('platform', { enum: PLATFORM }).notNull(),
    cacheKey: text('cache_key').notNull(),
    /** `ElementFingerprint` signals (see @qa-brain/core). */
    signals: json('signals').notNull(),
    locator: text('locator'),
    locatorStrategy: text('locator_strategy', { enum: LOCATOR_STRATEGY }),
    /** Hash of the a11y subtree around the target, validated against the live snapshot before replay. */
    regionHash: text('region_hash'),
    cropArtifactId: id('crop_artifact_id').references((): AnyPgColumn => artifact.id),
    capturedAtRunId: id('captured_at_run_id').references((): AnyPgColumn => run.id),
    verifiedPasses: integer('verified_passes').notNull().default(0),
    status: text('status', { enum: FINGERPRINT_STATUS }).notNull().default('active'),
    lastHitAt: ts('last_hit_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('step_fingerprint_active_cache_key_uq')
      .on(t.projectId, t.cacheKey)
      .where(sql`${t.status} = 'active'`),
    index('step_fingerprint_cache_key_idx').on(t.cacheKey),
    index('step_fingerprint_step_platform_idx').on(t.stepKey, t.platform),
    index('step_fingerprint_status_idx').on(t.status),
  ],
);

/* ---------------------------------------------------------------- runs */

export const task = pgTable(
  'task',
  {
    /** For `run_suite` tasks this equals `run.id`. */
    id: id().primaryKey(),
    projectId: id('project_id').references(() => project.id),
    kind: text('kind', { enum: TASK_KIND }).notNull(),
    status: text('status', { enum: TASK_STATUS }).notNull().default('working'),
    /** `{ done, total, message }` */
    progress: json('progress'),
    result: json('result'),
    error: json('error'),
    inputRequest: json('input_request'),
    ttlMs: integer('ttl_ms'),
    pollIntervalMs: integer('poll_interval_ms'),
    createdByApiKeyId: id('created_by_api_key_id').references(() => apiKey.id),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    expiresAt: ts('expires_at'),
  },
  (t) => [index('task_status_expires_idx').on(t.status, t.expiresAt)],
);

export const run = pgTable(
  'run',
  {
    id: id().primaryKey(),
    projectId: id('project_id').references(() => project.id),
    name: text('name'),
    status: text('status', { enum: RUN_STATUS }).notNull().default('queued'),
    trigger: text('trigger', { enum: RUN_TRIGGER }).notNull().default('manual'),
    meta: json('meta'),
    summary: json('summary'),
    principal: text('principal').notNull(),
    gitSha: text('git_sha'),
    branch: text('branch'),
    baseSha: text('base_sha'),
    platforms: json('platforms'),
    /** Requested keys / tags / TIA output. */
    selection: json('selection'),
    idempotencyKey: text('idempotency_key'),
    infraOutage: bool('infra_outage').notNull().default(false),
    requestedByApiKeyId: id('requested_by_api_key_id').references(() => apiKey.id),
    /** `task.id` when the run was started through the MCP Tasks extension (equal to `run.id`); no FK. */
    taskId: id('task_id'),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    uniqueIndex('run_idempotency_key_uq').on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('run_project_branch_created_idx').on(t.projectId, t.branch, t.createdAt),
    index('run_git_sha_idx').on(t.gitSha),
  ],
);

export const runAttempt = pgTable(
  'run_attempt',
  {
    id: id().primaryKey(),
    runId: id('run_id')
      .notNull()
      .references(() => run.id),
    testCaseId: id('test_case_id')
      .notNull()
      .references(() => testCase.id),
    revisionId: id('revision_id').references(() => testCaseRevision.id),
    platform: text('platform', { enum: PLATFORM }).notNull(),
    /** 0-based. */
    attemptNo: integer('attempt_no').notNull().default(0),
    branch: text('branch'),
    gitSha: text('git_sha'),
    status: text('status', { enum: ATTEMPT_STATUS }).notNull().default('pending'),
    /** Set on the final attempt only. */
    outcome: text('outcome', { enum: ATTEMPT_OUTCOME }),
    failureCategory: text('failure_category', { enum: FAILURE_CATEGORY }),
    errorSignature: text('error_signature'),
    handleId: text('handle_id').references(() => handle.handle),
    healsUsed: integer('heals_used').notNull().default(0),
    transientStepsUsed: integer('transient_steps_used').notNull().default(0),
    durationMs: integer('duration_ms'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('run_attempt_unique_attempt_uq').on(t.runId, t.testCaseId, t.platform, t.attemptNo),
    index('run_attempt_case_branch_platform_idx').on(t.testCaseId, t.branch, t.platform, t.startedAt),
    index('run_attempt_run_signature_idx').on(t.runId, t.errorSignature),
  ],
);

export const stepResult = pgTable(
  'step_result',
  {
    id: id().primaryKey(),
    attemptId: id('attempt_id')
      .notNull()
      .references(() => runAttempt.id),
    stepId: id('step_id').references(() => testStep.id),
    ordinal: integer('ordinal').notNull(),
    status: text('status', { enum: STEP_RESULT_STATUS }).notNull(),
    cacheStatus: text('cache_status', { enum: CACHE_STATUS }),
    fingerprintId: id('fingerprint_id').references(() => stepFingerprint.id),
    healProposalId: id('heal_proposal_id').references((): AnyPgColumn => healProposal.id),
    oracle: text('oracle', { enum: ORACLE_KIND }),
    failureCategory: text('failure_category', { enum: FAILURE_CATEGORY }),
    errorSignature: text('error_signature'),
    errorMessage: text('error_message'),
    snapshotArtifactId: id('snapshot_artifact_id').references((): AnyPgColumn => artifact.id),
    screenshotArtifactId: id('screenshot_artifact_id').references((): AnyPgColumn => artifact.id),
    llmModel: text('llm_model'),
    llmTokensIn: integer('llm_tokens_in'),
    llmTokensOut: integer('llm_tokens_out'),
    durationMs: integer('duration_ms'),
    startedAt: ts('started_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('step_result_attempt_ordinal_uq').on(t.attemptId, t.ordinal),
    index('step_result_fingerprint_idx').on(t.fingerprintId),
    index('step_result_step_status_idx').on(t.stepId, t.status),
  ],
);

export const artifact = pgTable(
  'artifact',
  {
    id: id().primaryKey(),
    projectId: id('project_id').references(() => project.id),
    runId: id('run_id').references(() => run.id),
    attemptId: id('attempt_id').references(() => runAttempt.id),
    kind: text('kind', { enum: ARTIFACT_KIND }).notNull(),
    /** `fs` driver: the root dir; `s3` driver: bucket name. */
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    sha256: text('sha256').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('artifact_bucket_key_uq').on(t.bucket, t.key),
    index('artifact_sha256_idx').on(t.sha256),
    index('artifact_run_kind_idx').on(t.runId, t.kind),
  ],
);

/**
 * Per-call gateway log (one row per tools/call). `run_id` is plain text without a FK so logging can never
 * fail because of referential integrity, and so it can carry either a run uuid or a `rn_…` handle.
 */
export const actionLog = pgTable(
  'action_log',
  {
    id: id().primaryKey(),
    tsStart: ts('ts_start').notNull(),
    durationMs: integer('duration_ms').notNull(),
    runId: text('run_id'),
    transport: text('transport', { enum: TRANSPORT }).notNull(),
    protocolEra: text('protocol_era', { enum: PROTOCOL_ERA }),
    principal: text('principal').notNull(),
    /** Upstream id from config (`playwright`) or `native`. */
    upstream: text('upstream').notNull(),
    /** Public tool name (`web_click`, `qa_health`). */
    tool: text('tool').notNull(),
    /** Upstream tool name (`browser_click`) or the public name for natives. */
    upstreamTool: text('upstream_tool').notNull(),
    /** Keys + types only; values never stored here. */
    argsShape: json('args_shape'),
    /** Redacted argument values (only when `log.argsMode = 'redacted'`). */
    argsRedacted: json('args_redacted'),
    argsHash: text('args_hash').notNull(),
    isError: bool('is_error').notNull().default(false),
    errorCode: text('error_code', { enum: GATEWAY_ERROR_CODE }),
    errorMessage: text('error_message'),
    resultChars: integer('result_chars').notNull().default(0),
    /** Comma-separated content kinds, e.g. `text,image`. */
    resultKinds: text('result_kinds').notNull().default(''),
    resultDigest: text('result_digest'),
    traceparent: text('traceparent'),
    clientName: text('client_name'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('action_log_run_ts_idx').on(t.runId, t.tsStart),
    index('action_log_tool_ts_idx').on(t.tool, t.tsStart),
    index('action_log_ts_idx').on(t.tsStart),
  ],
);

/* ---------------------------------------------------------------- healing / flakiness */

export const healProposal = pgTable(
  'heal_proposal',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    testCaseId: id('test_case_id').references(() => testCase.id),
    stepId: id('step_id').references(() => testStep.id),
    revisionId: id('revision_id').references(() => testCaseRevision.id),
    kind: text('kind', { enum: HEAL_KIND }).notNull(),
    tier: text('tier', { enum: HEAL_TIER }).notNull(),
    oldFingerprintId: id('old_fingerprint_id').references(() => stepFingerprint.id),
    newFingerprintId: id('new_fingerprint_id').references(() => stepFingerprint.id),
    score: real('score'),
    margin: real('margin'),
    /** Top-k candidates with per-attribute scores. */
    candidates: json('candidates'),
    /** `{ before_artifact_id, after_artifact_id, snapshot_excerpt_artifact_id, llm_rationale, verify_tool, verify_result }` */
    evidence: json('evidence'),
    /** Unified diff; null for `locator` proposals. */
    yamlPatch: text('yaml_patch'),
    runId: id('run_id').references(() => run.id),
    attemptId: id('attempt_id').references(() => runAttempt.id),
    status: text('status', { enum: HEAL_STATUS }).notNull().default('proposed'),
    consecutivePasses: integer('consecutive_passes').notNull().default(0),
    decidedBy: text('decided_by'),
    decidedAt: ts('decided_at'),
    feedbackReason: text('feedback_reason'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('heal_proposal_project_status_idx').on(t.projectId, t.status),
    index('heal_proposal_status_idx').on(t.status),
    uniqueIndex('heal_proposal_step_new_fp_uq')
      .on(t.stepId, t.newFingerprintId)
      .where(sql`${t.newFingerprintId} IS NOT NULL`),
  ],
);

export const flakyStat = pgTable(
  'flaky_stat',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    testCaseId: id('test_case_id')
      .notNull()
      .references(() => testCase.id),
    branch: text('branch').notNull(),
    platform: text('platform', { enum: PLATFORM }).notNull(),
    windowSize: integer('window_size').notNull().default(20),
    executions: integer('executions').notNull().default(0),
    transitions: integer('transitions').notNull().default(0),
    transitionScore: real('transition_score').notNull().default(0),
    /** e.g. `PPFPP…`, newest last. */
    lastOutcomes: text('last_outcomes').notNull().default(''),
    passedOnRetryShas: json('passed_on_retry_shas'),
    isFlaky: bool('is_flaky').notNull().default(false),
    isNew: bool('is_new').notNull().default(false),
    burnInRemaining: integer('burn_in_remaining').notNull().default(0),
    alarmedAt: ts('alarmed_at'),
    recoveredAt: ts('recovered_at'),
    updatedAt: ts('updated_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('flaky_stat_case_branch_platform_uq').on(t.testCaseId, t.branch, t.platform)],
);

/** Append-only transition log; `test_case.status` holds the current state. */
export const quarantine = pgTable(
  'quarantine',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    testCaseId: id('test_case_id')
      .notNull()
      .references(() => testCase.id),
    state: text('state', { enum: TEST_CASE_STATUS }).notNull(),
    previousState: text('previous_state', { enum: TEST_CASE_STATUS }),
    reason: text('reason', { enum: QUARANTINE_REASON }).notNull(),
    owner: text('owner'),
    issueUrl: text('issue_url'),
    /** `{ passes: 100, days: 7 }` */
    exitCriteria: json('exit_criteria'),
    consecutivePasses: integer('consecutive_passes').notNull().default(0),
    fixSha: text('fix_sha'),
    graceUntil: ts('grace_until'),
    createdBy: text('created_by'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('quarantine_case_created_idx').on(t.testCaseId, t.createdAt),
    check(
      'quarantine_owner_issue_required',
      sql`${t.state} NOT IN ('quarantined', 'disabled') OR (${t.owner} IS NOT NULL AND ${t.issueUrl} IS NOT NULL)`,
    ),
  ],
);

export const coverageMap = pgTable(
  'coverage_map',
  {
    id: id().primaryKey(),
    projectId: id('project_id')
      .notNull()
      .references(() => project.id),
    testCaseId: id('test_case_id')
      .notNull()
      .references(() => testCase.id),
    platform: text('platform', { enum: PLATFORM }).notNull(),
    kind: text('kind', { enum: COVERAGE_KIND }).notNull(),
    target: text('target').notNull(),
    checksum: text('checksum'),
    source: text('source', { enum: COVERAGE_SOURCE }).notNull(),
    capturedRunId: id('captured_run_id').references(() => run.id),
    capturedAt: ts('captured_at').notNull(),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('coverage_map_target_uq').on(t.testCaseId, t.platform, t.kind, t.target),
    index('coverage_map_project_kind_target_idx').on(t.projectId, t.kind, t.target),
  ],
);

/** All tables keyed by their SQL name — used by the adapters (`drizzle(client, { schema })`) and tests. */
export const pgTables = {
  project,
  api_key: apiKey,
  handle,
  test_case: testCase,
  test_case_revision: testCaseRevision,
  test_step: testStep,
  step_fingerprint: stepFingerprint,
  run,
  run_attempt: runAttempt,
  step_result: stepResult,
  artifact,
  action_log: actionLog,
  heal_proposal: healProposal,
  flaky_stat: flakyStat,
  quarantine,
  coverage_map: coverageMap,
  task,
} as const;
