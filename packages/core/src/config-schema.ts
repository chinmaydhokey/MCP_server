import { z } from 'zod';

/**
 * QA Brain configuration schema (qa-brain.config.json | .yaml).
 *
 * The loader (packages/gateway) expands `${VAR}` / `${VAR:-default}` in every string leaf before validation
 * and registers every expanded value with the redactor.
 */

/**
 * Config values may arrive as strings after `${VAR}` expansion (environments have no types), so numeric and
 * boolean fields accept both. `z.coerce.boolean()` is deliberately NOT used: it turns the string "false"
 * into `true`, which would silently disable safety flags such as `allowUnauthenticated`.
 */
const envNumber = () => z.coerce.number();
const envBoolean = () =>
  z.union([
    z.boolean(),
    z
      .enum(['true', 'false', '1', '0', 'yes', 'no'])
      .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  ]);

export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ArgsModeSchema = z.enum(['shape', 'redacted', 'none']);
export type ArgsMode = z.infer<typeof ArgsModeSchema>;

export const ServerConfigSchema = z.object({
  /** Name reported in MCP server info. */
  name: z.string().min(1).default('qa-brain'),
  /** `ttlMs` advertised on tools/list (2026-07-28 CacheableResult). */
  toolsListTtlMs: envNumber().int().nonnegative().default(300_000),
  /** Per-call timeout for proxied tool calls. */
  callTimeoutMs: envNumber().int().positive().default(60_000),
  /** Hard cap on serialized text content returned to the LLM (≈ 20k tokens). */
  maxResultChars: envNumber().int().positive().default(80_000),
  /** List stub tools (return isError "not implemented") in tools/list. */
  exposeStubs: envBoolean().default(false),
  /** Optional `instructions` string sent to the client. */
  instructions: z.string().optional(),
});

export const StoreConfigSchema = z.discriminatedUnion('driver', [
  z.object({
    driver: z.literal('sqlite'),
    /** libsql URL, e.g. `file:./.qa-brain/qa-brain.db` or `file::memory:` */
    url: z.string().min(1).default('file:./.qa-brain/qa-brain.db'),
  }),
  z.object({
    driver: z.literal('pg'),
    /** Postgres connection string. */
    url: z.string().min(1),
    poolMax: envNumber().int().positive().default(10),
  }),
]);

export const ArtifactsConfigSchema = z.discriminatedUnion('driver', [
  z.object({ driver: z.literal('fs'), dir: z.string().min(1).default('./.qa-brain/artifacts') }),
  z.object({
    driver: z.literal('s3'),
    bucket: z.string().min(1),
    endpoint: z.string().url().optional(),
    region: z.string().default('us-east-1'),
    prefix: z.string().default(''),
    forcePathStyle: envBoolean().default(true),
  }),
]);

export const LogConfigSchema = z.object({
  level: LogLevelSchema.default('info'),
  /** What to persist for tool arguments: type shape only, redacted values, or nothing. */
  argsMode: ArgsModeSchema.default('redacted'),
});

export const HttpConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: envNumber().int().min(0).max(65535).default(8787),
  /** Name of the environment variable holding the bearer token accepted on /mcp. */
  bearerTokenEnv: z.string().default('QA_BRAIN_TOKEN'),
  /** Only honoured when binding to a loopback address. */
  allowUnauthenticated: envBoolean().default(false),
  /** Host header allow-list (DNS-rebinding protection). Empty = localhost defaults. */
  allowedHosts: z.array(z.string()).default([]),
  /** Origin header allow-list. Empty = localhost defaults. */
  allowedOrigins: z.array(z.string()).default([]),
});

export const ToolFilterSchema = z.object({
  /** Upstream tool names exposed in tools/list. Empty list = nothing (curate by default). */
  allow: z.array(z.string()).default([]),
  /** Upstream tool names that can never be called, even via qa_call_tool. Wins over allow/hidden. */
  block: z.array(z.string()).default([]),
  /** Upstream tool names callable via qa_call_tool but not listed. */
  hidden: z.array(z.string()).default([]),
});

export const HealthConfigSchema = z.object({
  intervalMs: envNumber().int().positive().default(60_000),
  timeoutMs: envNumber().int().positive().default(5_000),
  unhealthyThreshold: envNumber().int().positive().default(3),
});

export const RestartConfigSchema = z.object({
  maxAttempts: envNumber().int().nonnegative().default(5),
  baseMs: envNumber().int().positive().default(1_000),
  maxMs: envNumber().int().positive().default(30_000),
});

const UpstreamBaseSchema = z.object({
  /** Adapter id: `playwright` (default tool table for Playwright MCP) or `generic`. */
  adapter: z.enum(['playwright', 'appium', 'generic']).default('generic'),
  /** Public prefix for this upstream's tools, e.g. `web_`. */
  prefix: z
    .string()
    .regex(/^[a-z][a-z0-9]*_$/, 'prefix must be lowercase letters/digits ending with "_"')
    .default('up_'),
  /** Upstream prefix removed before prepending `prefix`, e.g. `browser_`. */
  strip: z.string().optional(),
  tools: ToolFilterSchema.prefault({}),
  health: HealthConfigSchema.prefault({}),
  restart: RestartConfigSchema.prefault({}),
  /** Long-lived upstreams hold state (a browser); they are never spawned per request. */
  longLived: envBoolean().default(true),
  /** Upstream-specific settings passed to the adapter (e.g. Playwright flags). */
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const StdioUpstreamSchema = UpstreamBaseSchema.extend({
  /** Executable, or the alias `playwright` which the Playwright adapter resolves to `node <cli.js>`. */
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
});

export const HttpUpstreamSchema = UpstreamBaseSchema.extend({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const UpstreamConfigSchema = z.union([StdioUpstreamSchema, HttpUpstreamSchema]);
export type UpstreamConfig = z.infer<typeof UpstreamConfigSchema>;
export type StdioUpstreamConfig = z.infer<typeof StdioUpstreamSchema>;
export type HttpUpstreamConfig = z.infer<typeof HttpUpstreamSchema>;

export function isStdioUpstream(u: UpstreamConfig): u is StdioUpstreamConfig {
  return 'command' in u;
}

export const QaBrainConfigSchema = z.object({
  $schema: z.string().optional(),
  server: ServerConfigSchema.prefault({}),
  store: StoreConfigSchema.prefault({ driver: 'sqlite' }),
  artifacts: ArtifactsConfigSchema.prefault({ driver: 'fs' }),
  log: LogConfigSchema.prefault({}),
  http: HttpConfigSchema.prefault({}),
  mcpServers: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/, 'upstream ids are lowercase kebab-case'),
      UpstreamConfigSchema,
    )
    .default({}),
});

export type QaBrainConfig = z.infer<typeof QaBrainConfigSchema>;
export type QaBrainConfigInput = z.input<typeof QaBrainConfigSchema>;

/** Validates a raw (already env-expanded) config object. Throws a ZodError on failure. */
export function parseConfig(raw: unknown): QaBrainConfig {
  return QaBrainConfigSchema.parse(raw);
}
