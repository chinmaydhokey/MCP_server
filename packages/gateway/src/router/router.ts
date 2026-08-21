import type { GatewayErrorCode, ToolCallResult } from '@qa-brain/core';
import { isHandleOfKind } from '@qa-brain/core';
import type { ActionLog } from '../log/action-log.js';
import type { Logger } from '../log/logger.js';
import { outboundMeta, type TraceContext } from '../otel.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import { errorResult, type GatewayServices, type NativeCallContext } from '../server/define-native-tool.js';
import { UpstreamTimeoutError, UpstreamUnavailableError } from '../upstream/upstream-manager.js';

export const RUN_ID_META_KEY = 'in.qabrain/runId';
export const ACTION_LOG_ID_META_KEY = 'in.qabrain/actionLogId';
export const MAX_CALL_DEPTH = 3;

export interface RouteInput {
  name: string;
  args: unknown;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
  ctx: NativeCallContext;
}

export interface RouterOptions {
  registry: ToolRegistry;
  actionLog: ActionLog;
  logger: Logger;
  services: GatewayServices;
  callTimeoutMs: number;
  maxResultChars: number;
}

/** Truncates the largest text block so the total text stays under `max`; appends a marker. */
export function capResult(result: ToolCallResult, max: number): ToolCallResult {
  const total = result.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0);
  if (total <= max) return result;
  let largestIdx = -1;
  let largest = -1;
  result.content.forEach((c, i) => {
    if (c.type === 'text' && c.text.length > largest) {
      largest = c.text.length;
      largestIdx = i;
    }
  });
  if (largestIdx < 0) return result;
  const over = total - max;
  const block = result.content[largestIdx] as { type: 'text'; text: string };
  const keep = Math.max(0, block.text.length - over - 120);
  const removed = block.text.length - keep;
  const content = result.content.slice();
  content[largestIdx] = {
    type: 'text',
    text: `${block.text.slice(0, keep)}\n[truncated ${removed} chars by QA Brain (maxResultChars=${max}); take a narrower snapshot or use web_find]`,
  };
  return { ...result, content, _meta: { ...(result._meta ?? {}), 'in.qabrain/truncated': removed } };
}

/**
 * Strips QA Brain's own bookkeeping arguments before forwarding to an upstream. `run_id` is ours: upstream
 * servers never declared it, and a server stricter than Playwright MCP would reject the unknown property.
 */
function forwardedArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const { run_id: _runId, ...rest } = args as Record<string, unknown>;
  return rest;
}

function runIdFrom(args: unknown, meta: Record<string, unknown> | undefined): string | null {
  const fromMeta = meta?.[RUN_ID_META_KEY];
  if (typeof fromMeta === 'string' && isHandleOfKind(fromMeta, 'run')) return fromMeta;
  const fromArgs = (args as Record<string, unknown> | undefined)?.run_id;
  if (typeof fromArgs === 'string' && isHandleOfKind(fromArgs, 'run')) return fromArgs;
  return null;
}

/**
 * Dispatches every tools/call. Never throws: every failure becomes an `isError` result with a recovery hint,
 * and every call (including rejected ones) produces an action-log row.
 */
export class Router {
  constructor(private readonly opts: RouterOptions) {}

  async call(input: RouteInput): Promise<ToolCallResult> {
    const { registry, actionLog, callTimeoutMs, maxResultChars, services } = this.opts;
    const tool = registry.get(input.name);
    const runId = input.ctx.runId ?? runIdFrom(input.args, input.meta);
    const ctx: NativeCallContext = { ...input.ctx, runId };
    const trace: TraceContext = ctx.trace;

    const pending = actionLog.begin({
      tool: input.name,
      upstream: tool?.upstreamId ?? 'gateway',
      upstreamTool: tool?.upstreamName ?? input.name,
      args: input.args,
      ctx: {
        transport: ctx.transport,
        protocolEra: ctx.protocolEra,
        principal: ctx.principal,
        clientName: ctx.clientName,
        runId,
        traceparent: trace.traceparent,
      },
    });

    const finish = async (
      result: ToolCallResult,
      code: GatewayErrorCode | null = null,
      message: string | null = null,
    ) => {
      const capped = capResult(result, maxResultChars);
      const row = await pending.end({ result: capped, errorCode: code, errorMessage: message });
      return { ...capped, _meta: { ...(capped._meta ?? {}), [ACTION_LOG_ID_META_KEY]: row.id } };
    };

    if (!tool) {
      return finish(
        errorResult('unknown_tool', `no tool named "${input.name}"; call qa_search_tools to discover tools`),
        'unknown_tool',
        'unknown tool',
      );
    }
    if (tool.status === 'blocked') {
      return finish(
        errorResult(
          'blocked_tool',
          `"${input.name}" is blocked by gateway policy (${tool.definition.description ?? 'policy'})`,
        ),
        'blocked_tool',
        'blocked tool',
      );
    }
    if (!tool.callable) {
      return finish(
        errorResult(
          'blocked_tool',
          `"${input.name}" is not on the allow-list for upstream ${tool.upstreamId}; ask an operator to allow or hide it`,
        ),
        'blocked_tool',
        'not allow-listed',
      );
    }
    if (ctx.depth > MAX_CALL_DEPTH) {
      return finish(
        errorResult('invalid_args', 'qa_call_tool nesting too deep'),
        'invalid_args',
        'nesting too deep',
      );
    }

    if (tool.kind === 'native' && tool.native) {
      if (tool.status === 'stub') {
        return finish(
          errorResult(
            'not_implemented',
            `${input.name} is a design stub; it is scheduled for a later milestone (see docs/roadmap.md)`,
          ),
          'not_implemented',
          'stub',
        );
      }
      const parsed = tool.native.inputSchema.safeParse(input.args ?? {});
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ');
        return finish(errorResult('invalid_args', msg), 'invalid_args', msg);
      }
      try {
        const result = await tool.native.handler(parsed.data, { ...ctx, signal: input.signal }, services);
        return finish(
          result,
          result.isError ? 'internal' : null,
          result.isError ? 'native tool reported error' : null,
        );
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        this.opts.logger.error({ err, tool: input.name }, 'native tool threw');
        return finish(errorResult('internal', message), 'internal', message);
      }
    }

    // proxied
    const manager = tool.manager;
    if (!manager)
      return finish(errorResult('internal', 'tool has no upstream manager'), 'internal', 'no manager');
    try {
      const result = await manager.callTool(tool.upstreamName, forwardedArgs(input.args), {
        signal: input.signal,
        timeoutMs: callTimeoutMs,
        meta: outboundMeta(trace),
      });
      return finish(
        result,
        result.isError ? 'upstream_error' : null,
        result.isError ? 'upstream reported error' : null,
      );
    } catch (err) {
      if (input.signal?.aborted) {
        return finish(
          errorResult('cancelled', `${input.name} was cancelled by the client`),
          'cancelled',
          'cancelled',
        );
      }
      if (err instanceof UpstreamTimeoutError) {
        return finish(errorResult('timeout', err.message), 'timeout', err.message);
      }
      if (err instanceof UpstreamUnavailableError) {
        return finish(
          errorResult('upstream_unavailable', `${err.message}; call qa_health for details`),
          'upstream_unavailable',
          err.message,
        );
      }
      const message = (err as Error).message ?? String(err);
      return finish(errorResult('upstream_error', message), 'upstream_error', message);
    }
  }
}
