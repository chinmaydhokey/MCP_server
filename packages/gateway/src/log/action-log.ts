import { createHash } from 'node:crypto';
import {
  type ActionLogRow,
  type ArgsMode,
  type GatewayErrorCode,
  type ProtocolEra,
  type Redactor,
  type StoreAdapter,
  type ToolCallResult,
  type TransportKind,
  argsShape,
  newId,
} from '@qa-brain/core';
import type { Logger } from './logger.js';

export interface ActionContext {
  transport: TransportKind;
  protocolEra: ProtocolEra | null;
  principal: string;
  clientName: string | null;
  runId: string | null;
  traceparent: string | null;
}

export interface PendingAction {
  readonly id: string;
  readonly startedAt: number;
  end(input: { result?: ToolCallResult; errorCode?: GatewayErrorCode | null; errorMessage?: string | null }): Promise<ActionLogRow>;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Sum of text content lengths plus a flat cost for non-text blocks. */
export function resultSize(result: ToolCallResult | undefined): { chars: number; kinds: string } {
  if (!result) return { chars: 0, kinds: '' };
  let chars = 0;
  const kinds = new Set<string>();
  for (const c of result.content ?? []) {
    kinds.add(c.type);
    if (c.type === 'text') chars += c.text.length;
  }
  if (result.structuredContent !== undefined) {
    kinds.add('structured');
    chars += JSON.stringify(result.structuredContent).length;
  }
  return { chars, kinds: [...kinds].sort().join(',') };
}

/**
 * Writes one row per tool call. Redaction and shape extraction happen here, before persistence.
 * Persistence failures are logged and swallowed: the action log must never break a tool call.
 */
export class ActionLog {
  constructor(
    private readonly store: StoreAdapter,
    private readonly redactor: Redactor,
    private readonly logger: Logger,
    private readonly argsMode: ArgsMode,
  ) {}

  begin(input: { tool: string; upstream: string; upstreamTool: string; args: unknown; ctx: ActionContext }): PendingAction {
    const id = newId();
    const startedAt = Date.now();
    const shape = argsShape(input.args ?? {});
    const argsRedacted = this.argsMode === 'redacted' ? this.redactor.value(input.args ?? {}) : null;
    const argsHash = sha256(canonicalJson(input.args ?? {}));
    const { store, redactor, logger, argsMode } = this;

    return {
      id,
      startedAt,
      async end({ result, errorCode = null, errorMessage = null }) {
        const { chars, kinds } = resultSize(result);
        const digest = result ? sha256(JSON.stringify(result.content ?? [])) : null;
        const row: ActionLogRow = {
          id,
          tsStart: startedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          runId: input.ctx.runId,
          transport: input.ctx.transport,
          protocolEra: input.ctx.protocolEra,
          principal: input.ctx.principal,
          upstream: input.upstream,
          tool: input.tool,
          upstreamTool: input.upstreamTool,
          argsShape: argsMode === 'none' ? null : shape,
          argsRedacted,
          argsHash,
          isError: Boolean(result?.isError) || errorCode !== null,
          errorCode,
          errorMessage: errorMessage ? redactor.text(errorMessage).slice(0, 1024) : null,
          resultChars: chars,
          resultKinds: kinds,
          resultDigest: digest,
          traceparent: input.ctx.traceparent,
          clientName: input.ctx.clientName,
        };
        try {
          await store.actionLog.insert(row);
        } catch (err) {
          logger.warn({ err, tool: input.tool }, 'action log insert failed');
        }
        logger.debug(
          { tool: row.tool, upstream: row.upstream, ms: row.durationMs, isError: row.isError, code: row.errorCode, chars: row.resultChars },
          'tool call',
        );
        return row;
      },
    };
  }
}
