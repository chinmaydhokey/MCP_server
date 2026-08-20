import { randomBytes } from 'node:crypto';

/**
 * Minimal W3C Trace Context helpers. M0 carries `traceparent` through `_meta` (MCP 2026-07-28, SEP-414)
 * into the action log; the OpenTelemetry SDK exporter (GenAI MCP semconv spans) arrives in a later
 * milestone behind `QA_BRAIN_OTEL_EXPORTER=otlp`. Keeping this dependency-free means stdio mode never
 * loads the OTel SDK.
 */

export const TRACEPARENT_KEY = 'traceparent';
export const TRACESTATE_KEY = 'tracestate';
export const BAGGAGE_KEY = 'baggage';

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface TraceContext {
  traceparent: string;
  traceId: string;
  spanId: string;
  sampled: boolean;
  tracestate?: string;
  baggage?: string;
}

export function parseTraceparent(value: unknown): TraceContext | null {
  if (typeof value !== 'string') return null;
  const m = TRACEPARENT_RE.exec(value.trim());
  if (!m) return null;
  const traceId = m[1] as string;
  const spanId = m[2] as string;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceparent: value.trim(), traceId, spanId, sampled: (Number.parseInt(m[3] as string, 16) & 1) === 1 };
}

export function newTraceContext(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return { traceparent: `00-${traceId}-${spanId}-01`, traceId, spanId, sampled: true };
}

/** Creates a child context (same trace id, new span id). */
export function childContext(parent: TraceContext): TraceContext {
  const spanId = randomBytes(8).toString('hex');
  return { ...parent, spanId, traceparent: `00-${parent.traceId}-${spanId}-${parent.sampled ? '01' : '00'}` };
}

/** Extracts (or mints) the trace context from an inbound request `_meta`. */
export function traceContextFromMeta(meta: Record<string, unknown> | undefined): TraceContext {
  const parsed = parseTraceparent(meta?.[TRACEPARENT_KEY]);
  const ctx = parsed ?? newTraceContext();
  if (typeof meta?.[TRACESTATE_KEY] === 'string') ctx.tracestate = meta[TRACESTATE_KEY] as string;
  if (typeof meta?.[BAGGAGE_KEY] === 'string') ctx.baggage = meta[BAGGAGE_KEY] as string;
  return ctx;
}

/** Builds the `_meta` object forwarded to an upstream (only trace keys survive the boundary). */
export function outboundMeta(ctx: TraceContext): Record<string, unknown> {
  const child = childContext(ctx);
  const out: Record<string, unknown> = { [TRACEPARENT_KEY]: child.traceparent };
  if (ctx.tracestate) out[TRACESTATE_KEY] = ctx.tracestate;
  if (ctx.baggage) out[BAGGAGE_KEY] = ctx.baggage;
  return out;
}
