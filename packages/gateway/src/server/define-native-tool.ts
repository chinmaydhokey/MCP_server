import type { JsonSchema, StoreAdapter, ToolCallResult, ToolDefinition } from '@qa-brain/core';
import { assertValidToolName } from '@qa-brain/core';
import { z } from 'zod';
import type { Logger } from '../log/logger.js';
import type { TraceContext } from '../otel.js';

/** Services available to native tool handlers (wired by createGateway; avoids import cycles). */
export interface GatewayServices {
  store: StoreAdapter;
  logger: Logger;
  /** Calls any registered tool through the router (used by qa_call_tool). */
  call(input: { name: string; args: unknown; signal?: AbortSignal; ctx: NativeCallContext }): Promise<ToolCallResult>;
  /** Registry read access (search/describe). */
  registry: {
    all(): RegisteredToolView[];
    get(name: string): RegisteredToolView | undefined;
  };
  upstreamStatus(): import('../upstream/upstream-manager.js').UpstreamStatus[];
  version: string;
  startedAt: number;
}

export interface RegisteredToolView {
  publicName: string;
  kind: 'proxied' | 'native';
  upstreamId: string;
  upstreamName: string;
  listed: boolean;
  callable: boolean;
  status: 'implemented' | 'stub' | 'blocked' | 'not_allowed';
  definition: ToolDefinition;
}

export interface NativeCallContext {
  principal: string;
  runId: string | null;
  trace: TraceContext;
  transport: 'stdio' | 'http' | 'inmemory';
  protocolEra: 'legacy' | 'modern' | null;
  clientName: string | null;
  signal?: AbortSignal;
  /** Depth of nested qa_call_tool invocations (guards recursion). */
  depth: number;
}

export interface NativeTool<I extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  inputSchema: I;
  outputSchema?: z.ZodType;
  status: 'implemented' | 'stub';
  /** Listed in tools/list (stubs are listed only when `exposeStubs` is on). */
  listed: boolean;
  handler: (args: z.infer<I>, ctx: NativeCallContext, services: GatewayServices) => Promise<ToolCallResult>;
}

/** Converts a zod schema into a compact JSON Schema suitable for MCP `inputSchema`. */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete raw.$schema;
  const strip = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'integer' || n.type === 'number') {
      if (n.minimum === -Number.MAX_SAFE_INTEGER) delete n.minimum;
      if (n.maximum === Number.MAX_SAFE_INTEGER) delete n.maximum;
    }
    if (n.type === 'object') {
      if (n.additionalProperties === undefined) n.additionalProperties = false;
      if (n.properties === undefined) n.properties = {};
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(strip);
      else if (v && typeof v === 'object') strip(v);
    }
  };
  strip(raw);
  return raw;
}

export function defineNativeTool<I extends z.ZodObject>(tool: NativeTool<I>): NativeTool<I> {
  assertValidToolName(tool.name);
  if (!tool.name.startsWith('qa_')) throw new Error(`native tools must use the qa_ prefix: ${tool.name}`);
  return tool;
}

export function nativeDefinition(tool: NativeTool): ToolDefinition {
  const def: ToolDefinition = {
    name: tool.name,
    description: tool.status === 'stub' ? `${tool.description} (stub: not implemented in M0)` : tool.description,
    inputSchema: toJsonSchema(tool.inputSchema),
  };
  if (tool.outputSchema) def.outputSchema = toJsonSchema(tool.outputSchema);
  return def;
}

export function textResult(text: string, structured?: unknown, isError = false): ToolCallResult {
  const r: ToolCallResult = { content: [{ type: 'text', text }] };
  if (structured !== undefined) r.structuredContent = structured;
  if (isError) r.isError = true;
  return r;
}

export function jsonResult(value: unknown): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function errorResult(code: string, message: string, extra?: Record<string, unknown>): ToolCallResult {
  return {
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: code, message, ...extra },
    isError: true,
  };
}
