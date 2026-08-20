import { HANDLE_KINDS } from '@qa-brain/core';
import { z } from 'zod';
import { RUN_ID_META_KEY } from '../../router/router.js';
import { type NativeTool, defineNativeTool, errorResult, jsonResult } from '../define-native-tool.js';

const RUN_TTL_MS = 24 * 60 * 60 * 1000;

const runIdSchema = z
  .string()
  .regex(new RegExp(`^${HANDLE_KINDS.run}_`), 'run_id must be a handle minted by qa_run_start (rn_…)')
  .describe('Run handle returned by qa_run_start');

export const qaHealth = defineNativeTool({
  name: 'qa_health',
  description:
    'Report gateway health: every upstream MCP server (state, protocol era, restarts, last probe), store connectivity and version. Call this when a web_* tool reports upstream_unavailable.',
  inputSchema: z.object({}),
  status: 'implemented',
  listed: true,
  async handler(_args, _ctx, services) {
    const storeOk = await services.store.ping().catch(() => false);
    const upstreams = services.upstreamStatus().map((u) => ({
      id: u.id,
      state: u.state,
      transport: u.transport,
      era: u.era,
      protocolVersion: u.protocolVersion,
      server: u.serverInfo,
      pid: u.pid,
      restarts: u.restarts,
      consecutiveFailures: u.consecutiveFailures,
      lastProbeMs: u.lastProbeMs,
      lastError: u.lastError,
      toolCount: u.toolCount,
      nextRestartInMs: u.nextRestartInMs,
    }));
    return jsonResult({
      ok: storeOk && upstreams.every((u) => u.state === 'healthy'),
      version: services.version,
      uptimeMs: Date.now() - services.startedAt,
      store: { driver: services.store.driver, ok: storeOk },
      upstreams,
    });
  },
});

export const qaRunStart = defineNativeTool({
  name: 'qa_run_start',
  description:
    'Start a run and get a run_id handle. Pass run_id to later calls (as the run_id argument where accepted, or in _meta["in.qabrain/runId"]) so every action is grouped in run history.',
  inputSchema: z.object({
    name: z.string().min(1).max(200).optional().describe('Human-readable run name'),
    meta: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata (branch, commit, trigger)'),
  }),
  status: 'implemented',
  listed: true,
  async handler(args, ctx, services) {
    const handle = await services.store.handles.mint('run', ctx.principal, RUN_TTL_MS, { name: args.name ?? null });
    const run = await services.store.runs.create({
      id: handle.handle,
      name: args.name ?? null,
      principal: ctx.principal,
      meta: args.meta ?? {},
      trigger: 'manual',
    });
    return jsonResult({ run_id: run.id, status: run.status, createdAt: run.createdAt, metaKey: RUN_ID_META_KEY });
  },
});

export const qaRunFinish = defineNativeTool({
  name: 'qa_run_finish',
  description: 'Finish a run with a status and optional summary. Returns the action count and error count recorded for the run.',
  inputSchema: z.object({
    run_id: runIdSchema,
    status: z.enum(['passed', 'failed', 'cancelled', 'error']),
    summary: z.record(z.string(), z.unknown()).optional(),
  }),
  status: 'implemented',
  listed: true,
  async handler(args, ctx, services) {
    const owned = await services.store.handles.resolve(args.run_id, ctx.principal);
    if (!owned) return errorResult('invalid_args', `run ${args.run_id} is unknown, expired, or owned by another principal`);
    const run = await services.store.runs.finish(args.run_id, { status: args.status, summary: args.summary ?? null });
    if (!run) return errorResult('invalid_args', `run ${args.run_id} not found`);
    const counts = await services.store.actionLog.count(args.run_id);
    await services.store.handles.revoke(args.run_id);
    return jsonResult({ run_id: run.id, status: run.status, finishedAt: run.finishedAt, actions: counts.total, errors: counts.errors });
  },
});

export const qaRunLog = defineNativeTool({
  name: 'qa_run_log',
  description: 'List the actions recorded for a run (tool, duration, error) newest first. Arguments are redacted; use this to review what happened.',
  inputSchema: z.object({
    run_id: runIdSchema,
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  status: 'implemented',
  listed: true,
  async handler(args, ctx, services) {
    const owned = await services.store.handles.resolve(args.run_id, ctx.principal);
    const run = await services.store.runs.get(args.run_id);
    if (!run || (!owned && run.principal !== ctx.principal)) {
      return errorResult('invalid_args', `run ${args.run_id} is unknown or owned by another principal`);
    }
    const rows = await services.store.actionLog.query({ runId: args.run_id, limit: args.limit, offset: args.offset });
    return jsonResult({
      run_id: args.run_id,
      status: run.status,
      count: rows.length,
      actions: rows.map((r) => ({
        id: r.id,
        at: new Date(r.tsStart).toISOString(),
        tool: r.tool,
        upstream: r.upstream,
        durationMs: r.durationMs,
        isError: r.isError,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        resultChars: r.resultChars,
        args: r.argsRedacted ?? r.argsShape,
      })),
    });
  },
});

export const qaSearchTools = defineNativeTool({
  name: 'qa_search_tools',
  description:
    'Search every tool QA Brain knows — including hidden ones that are not in the default list (tabs, network requests, generate_locator, drag/drop, file upload…). Returns names and summaries; use qa_describe_tool for the schema and qa_call_tool to invoke a hidden tool.',
  inputSchema: z.object({
    query: z.string().default('').describe('Space-separated terms matched against name and description; empty lists everything'),
    includeHidden: z.boolean().default(true),
  }),
  status: 'implemented',
  listed: true,
  async handler(args, _ctx, services) {
    const all = services.registry.all();
    const terms = args.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = all.filter((t) => {
      if (!args.includeHidden && !t.listed) return false;
      const hay = `${t.publicName} ${t.definition.description ?? ''} ${t.upstreamName}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    return jsonResult({
      count: matches.length,
      tools: matches.map((t) => ({
        name: t.publicName,
        summary: (t.definition.description ?? '').split('\n')[0]?.slice(0, 160) ?? '',
        listed: t.listed,
        callable: t.callable,
        status: t.status,
        source: t.kind === 'native' ? 'qa-brain' : `${t.upstreamId}:${t.upstreamName}`,
      })),
    });
  },
});

export const qaDescribeTool = defineNativeTool({
  name: 'qa_describe_tool',
  description: 'Return the full description and JSON input schema of any tool (listed, hidden or blocked).',
  inputSchema: z.object({ name: z.string().min(1) }),
  status: 'implemented',
  listed: true,
  async handler(args, _ctx, services) {
    const t = services.registry.get(args.name);
    if (!t) return errorResult('unknown_tool', `no tool named "${args.name}"`);
    return jsonResult({
      name: t.publicName,
      source: t.kind === 'native' ? 'qa-brain' : `${t.upstreamId}:${t.upstreamName}`,
      listed: t.listed,
      callable: t.callable,
      status: t.status,
      description: t.definition.description ?? '',
      inputSchema: t.definition.inputSchema,
      outputSchema: t.definition.outputSchema ?? null,
    });
  },
});

export const qaCallTool = defineNativeTool({
  name: 'qa_call_tool',
  description:
    'Invoke any callable tool by name, including hidden ones (e.g. web_generate_locator, web_tabs, web_network_requests). Blocked tools are refused. The call is logged exactly like a direct call.',
  inputSchema: z.object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  status: 'implemented',
  listed: true,
  async handler(args, ctx, services) {
    if (args.name === 'qa_call_tool') return errorResult('invalid_args', 'qa_call_tool cannot call itself');
    return services.call({ name: args.name, args: args.arguments, signal: ctx.signal, ctx: { ...ctx, depth: ctx.depth + 1 } });
  },
});

/* ---- design stubs: registered so schemas/docs are real, hidden unless server.exposeStubs ---- */

const stub = (name: string, description: string, inputSchema: z.ZodObject): NativeTool =>
  defineNativeTool({
    name,
    description,
    inputSchema,
    status: 'stub',
    listed: true,
    async handler() {
      return errorResult('not_implemented', `${name} is not implemented in M0`);
    },
  });

export const stubs: NativeTool[] = [
  stub(
    'qa_test_save',
    'Persist an intent-level test (qabrain/test/v1 YAML) and its current locator fingerprints',
    z.object({ key: z.string(), yaml: z.string(), run_id: runIdSchema.optional() }),
  ),
  stub('qa_test_get', 'Fetch a stored test by key, with its current revision and resolved cache', z.object({ key: z.string() })),
  stub(
    'qa_test_list',
    'List stored tests with status (active/quarantined/disabled) and last outcome',
    z.object({ tag: z.string().optional(), status: z.enum(['active', 'quarantined', 'disabled']).optional() }),
  ),
  stub(
    'qa_heal_locator',
    'Propose a healed locator for a failing step using the T0–T3 pipeline; returns a proposal for review',
    z.object({ test_key: z.string(), step_id: z.string(), run_id: runIdSchema }),
  ),
  stub(
    'qa_impact_select',
    'Select the tests impacted by a git diff (static ∪ coverage ∪ route ∪ network ∪ smoke) with priorities',
    z.object({ base: z.string(), head: z.string(), time_budget_s: z.number().int().positive().optional() }),
  ),
  stub(
    'qa_report_generate',
    'Generate a Markdown or JUnit report for a run with evidence links',
    z.object({ run_id: runIdSchema, format: z.enum(['md', 'junit']).default('md') }),
  ),
];

export const nativeTools: NativeTool[] = [qaHealth, qaRunStart, qaRunFinish, qaRunLog, qaSearchTools, qaDescribeTool, qaCallTool];
