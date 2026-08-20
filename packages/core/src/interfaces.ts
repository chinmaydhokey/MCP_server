import type { HandleKind } from './handle.js';

/* ------------------------------------------------------------------------------------------------
 * MCP-shaped structural types. `@qa-brain/core` deliberately does not depend on the MCP SDK so that
 * adapters, the store and the future runner can be typed without pulling transport code.
 * ---------------------------------------------------------------------------------------------- */

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ToolContentText {
  type: 'text';
  text: string;
  _meta?: Record<string, unknown>;
}
export interface ToolContentOther {
  type: 'image' | 'audio' | 'resource' | 'resource_link';
  [key: string]: unknown;
}
export type ToolContent = ToolContentText | ToolContentOther;

export interface ToolCallResult {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Error codes used in `isError` results and in the action log. */
export type GatewayErrorCode =
  | 'unknown_tool'
  | 'blocked_tool'
  | 'invalid_args'
  | 'timeout'
  | 'cancelled'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'not_implemented'
  | 'internal';

/* ------------------------------------------------------------------------------------------------
 * Store rows (M0 subset; the full 17-table model lives in @qa-brain/store).
 * ---------------------------------------------------------------------------------------------- */

export type ProtocolEra = 'legacy' | 'modern';
export type TransportKind = 'stdio' | 'http' | 'inmemory';

export interface ActionLogRow {
  id: string;
  tsStart: number;
  durationMs: number;
  runId: string | null;
  transport: TransportKind;
  protocolEra: ProtocolEra | null;
  principal: string;
  /** Upstream id from config (`playwright`) or `native`. */
  upstream: string;
  /** Public tool name (`web_click`, `qa_health`). */
  tool: string;
  /** Upstream tool name (`browser_click`) or the public name for natives. */
  upstreamTool: string;
  argsShape: unknown;
  argsRedacted: unknown | null;
  argsHash: string;
  isError: boolean;
  errorCode: GatewayErrorCode | null;
  errorMessage: string | null;
  resultChars: number;
  resultKinds: string;
  resultDigest: string | null;
  traceparent: string | null;
  clientName: string | null;
}

export interface ActionLogQuery {
  runId?: string;
  tool?: string;
  limit?: number;
  offset?: number;
  since?: number;
}

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'error';

export interface Run {
  id: string;
  projectId: string | null;
  name: string | null;
  status: RunStatus;
  trigger: string;
  meta: unknown;
  summary: unknown;
  principal: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface HandleRecord {
  handle: string;
  kind: HandleKind;
  owner: string;
  state: unknown;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface ActionLogRepository {
  insert(row: ActionLogRow): Promise<void>;
  query(q: ActionLogQuery): Promise<ActionLogRow[]>;
  count(runId: string): Promise<{ total: number; errors: number }>;
}

export interface RunRepository {
  create(input: { id: string; name?: string | null; principal: string; meta?: unknown; trigger?: string }): Promise<Run>;
  finish(id: string, patch: { status: RunStatus; summary?: unknown }): Promise<Run | null>;
  get(id: string): Promise<Run | null>;
}

export interface HandleRepository {
  mint(kind: HandleKind, owner: string, ttlMs: number, state?: unknown): Promise<HandleRecord>;
  resolve(handle: string, owner: string): Promise<HandleRecord | null>;
  revoke(handle: string): Promise<void>;
  sweep(now?: number): Promise<number>;
}

export interface StoreAdapter {
  readonly driver: 'sqlite' | 'pg';
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  readonly actionLog: ActionLogRepository;
  readonly runs: RunRepository;
  readonly handles: HandleRepository;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------------------------------------
 * Artifacts (M2+). fs locally, S3-compatible hosted.
 * ---------------------------------------------------------------------------------------------- */

export type ArtifactKind = 'screenshot' | 'crop' | 'snapshot' | 'trace' | 'video' | 'har' | 'console' | 'log' | 'diff' | 'result';

export interface ArtifactRef {
  id: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface ArtifactStore {
  put(input: { runId?: string; kind: ArtifactKind; contentType: string; body: Uint8Array }): Promise<ArtifactRef>;
  get(id: string): Promise<{ contentType: string; body: Uint8Array } | null>;
  url(id: string, ttlMs?: number): Promise<string | null>;
  delete(id: string): Promise<void>;
}

/* ------------------------------------------------------------------------------------------------
 * Upstream adapters: web (Playwright MCP) today; mobile (appium-mcp) designed in.
 * ---------------------------------------------------------------------------------------------- */

export interface UpstreamLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface ToolTableEntry {
  /** Listed in tools/list by default. */
  allow?: boolean;
  /** Callable through qa_call_tool but not listed. */
  hidden?: boolean;
  /** Never callable. */
  block?: boolean;
  /** Override of the upstream description (when the upstream text is unhelpful). */
  description?: string;
}

export interface UpstreamAdapter {
  readonly id: 'playwright' | 'appium' | 'generic';
  readonly platform: 'web' | 'mobile' | 'any';
  /** Which snapshot model the upstream offers. Mobile adapters synthesize `[ref=mN]` from page source. */
  readonly snapshotKind: 'aria-ref' | 'synthesized' | 'none';
  /** Resolves the launch command (e.g. the `playwright` alias → `node <cli.js> mcp …`). */
  resolveLaunch(input: { command: string; args: string[]; env: Record<string, string>; cwd?: string; homeDir: string }): UpstreamLaunch;
  /** Default tool table applied when the config does not specify one. */
  toolTable(): Record<string, ToolTableEntry>;
  /** Optional argument mapping hook (mobile: `ref=mN` → element UUID). */
  mapArgs?(upstreamTool: string, args: unknown): unknown;
  /** Optional result mapping hook (mobile: synthesize snapshot). */
  mapResult?(upstreamTool: string, result: ToolCallResult): ToolCallResult;
  /** Validates launch flags against the upstream's `--help` output; returns unknown flags. */
  validateFlags?(helpText: string, args: string[]): string[];
}

/* ------------------------------------------------------------------------------------------------
 * Later milestones (interfaces only in M0).
 * ---------------------------------------------------------------------------------------------- */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AgentRunResult {
  finalText: string;
  turns: number;
  usage: TokenUsage;
  costUsd: number;
  stopReason: string;
}

export interface LlmDriver {
  readonly provider: 'anthropic' | 'openai' | 'ollama' | (string & {});
  readonly model: string;
  runAgentLoop(input: {
    systemPrompt: string;
    task: string;
    tools: ToolDefinition[];
    callTool: (name: string, args: unknown) => Promise<ToolCallResult>;
    maxTurns: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<AgentRunResult>;
  complete(input: { prompt: string; schema?: JsonSchema; effort?: 'low' | 'medium' | 'high' }): Promise<unknown>;
  estimateCost(usage: TokenUsage): number;
}

export type HealTier = 'T0' | 'T1' | 'T2' | 'T3';

export interface ElementFingerprint {
  platform: 'web' | 'android' | 'ios';
  role?: string;
  name?: string;
  testid?: string;
  htmlId?: string;
  nameAttr?: string;
  type?: string;
  ariaLabel?: string;
  placeholder?: string;
  text?: string;
  tag?: string;
  classes?: string[];
  href?: string;
  css?: string;
  xpathIdRel?: string;
  ancestorPath?: string[];
  neighborTexts?: string[];
  bboxNorm?: { x: number; y: number; w: number; h: number };
  areaNorm?: number;
  phash?: string;
  url?: string;
  title?: string;
  /** Generated locator (from browser_generate_locator / Appium strategy+selector). */
  locator?: string;
  // mobile-only
  accessibilityId?: string;
  resourceId?: string;
  className?: string;
  label?: string;
  value?: string;
  contentDesc?: string;
  index?: number;
}

export interface HealCandidate {
  ref: string;
  fingerprint: ElementFingerprint;
  score?: number;
}

export interface HealProposal {
  tier: HealTier;
  candidate: HealCandidate;
  score: number;
  margin: number;
  rationale?: string;
}

export interface HealStrategy {
  readonly tier: HealTier;
  propose(input: {
    fingerprint: ElementFingerprint;
    candidates: HealCandidate[];
    rejected?: ElementFingerprint[];
    limits?: { maxCandidates?: number };
  }): Promise<HealProposal[]>;
}

export interface TestRef {
  key: string;
  path: string;
  platforms: string[];
  tags: string[];
}

export interface GitDiff {
  base: string;
  head: string;
  files: Array<{ path: string; status: 'A' | 'M' | 'D' | 'R' }>;
}

export interface ImpactSelection {
  selected: Array<{ test: TestRef; priority: number; reasons: Array<{ layer: string; evidence: string }> }>;
  fallbackToRunAll: boolean;
  fallbackReason?: string;
  notRun: Array<{ test: TestRef; reason: 'budget' | 'quarantined' | 'disabled' | 'not_impacted' }>;
}

export interface ImpactAnalyzer {
  readonly layer: 'static-imports' | 'dynamic-coverage' | 'route-map' | 'network-routes' | 'smoke-set';
  select(input: { diff: GitDiff; tests: TestRef[]; trackedFilesGlobs: string[] }): Promise<ImpactSelection>;
}
