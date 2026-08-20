import {
  type ToolDefinition,
  type ToolTableEntry,
  type UpstreamAdapter,
  type UpstreamConfig,
  assertValidToolName,
  toPublicToolName,
} from '@qa-brain/core';
import type { Logger } from '../log/logger.js';
import { type NativeTool, type RegisteredToolView, nativeDefinition } from '../server/define-native-tool.js';
import type { UpstreamManager } from '../upstream/upstream-manager.js';

export interface RegisteredTool extends RegisteredToolView {
  native?: NativeTool;
  manager?: UpstreamManager;
  adapter?: UpstreamAdapter;
}

export class ToolCollisionError extends Error {
  constructor(
    readonly publicName: string,
    readonly first: string,
    readonly second: string,
  ) {
    super(`tool name collision: "${publicName}" is provided by both ${first} and ${second}; rename via prefix/strip or block one of them`);
    this.name = 'ToolCollisionError';
  }
}

/** Merges the adapter's curated table with the config's explicit lists (config wins per name). */
export function effectiveToolTable(
  adapterTable: Record<string, ToolTableEntry>,
  config: UpstreamConfig['tools'],
): Record<string, ToolTableEntry> {
  const table: Record<string, ToolTableEntry> = {};
  for (const [name, entry] of Object.entries(adapterTable)) table[name] = { ...entry };
  const override = (names: string[], patch: ToolTableEntry) => {
    for (const n of names) table[n] = { ...(table[n] ?? {}), allow: false, hidden: false, block: false, ...patch };
  };
  override(config.allow, { allow: true });
  override(config.hidden, { hidden: true });
  override(config.block, { block: true });
  return table;
}

export type ToolClass = 'listed' | 'hidden' | 'blocked' | 'not_allowed';

export function classify(entry: ToolTableEntry | undefined, passThrough: boolean): ToolClass {
  if (entry?.block) return 'blocked';
  if (entry?.allow) return 'listed';
  if (entry?.hidden) return 'hidden';
  return passThrough ? 'listed' : 'not_allowed';
}

/**
 * The single source of truth for what the LLM can see and call.
 *
 * - Public names are `prefix + upstreamName.replace(strip, '')`, validated against the Claude regex.
 * - Collisions are startup errors (no shadowing — Docker MCP Gateway v0.43.1 rule).
 * - tools/list is sorted by name for prompt-cache stability and carries ttlMs/cacheScope.
 * - Names are never removed while the process lives (stale-history rule): a degraded upstream answers with
 *   `isError` + recovery hint instead.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  constructor(
    private readonly opts: { toolsListTtlMs: number; exposeStubs: boolean; maxListed: number; logger: Logger },
  ) {}

  registerNative(tool: NativeTool): void {
    const listed = tool.listed && (tool.status === 'implemented' || this.opts.exposeStubs);
    this.add({
      publicName: tool.name,
      kind: 'native',
      upstreamId: 'native',
      upstreamName: tool.name,
      listed,
      callable: true,
      status: tool.status,
      definition: nativeDefinition(tool),
      native: tool,
    });
  }

  /** Registers every tool reported by an upstream after it connected. */
  registerUpstream(manager: UpstreamManager, config: UpstreamConfig, adapter: UpstreamAdapter): void {
    const adapterTable = adapter.toolTable();
    const table = effectiveToolTable(adapterTable, config.tools);
    const passThrough = Object.values(table).every((e) => !e.allow && !e.hidden);
    if (passThrough) {
      this.opts.logger.warn(
        { upstream: manager.id },
        'no allow/hidden lists for upstream; exposing every non-blocked tool (pass-through mode)',
      );
    }
    for (const def of manager.getTools()) {
      const entry = table[def.name];
      const cls = classify(entry, passThrough);
      const publicName = toPublicToolName(def.name, { prefix: config.prefix, strip: config.strip });
      assertValidToolName(publicName);
      const description = entry?.description ?? def.description;
      this.add({
        publicName,
        kind: 'proxied',
        upstreamId: manager.id,
        upstreamName: def.name,
        listed: cls === 'listed',
        callable: cls === 'listed' || cls === 'hidden',
        status: cls === 'blocked' ? 'blocked' : cls === 'not_allowed' ? 'not_allowed' : 'implemented',
        definition: { ...def, name: publicName, description },
        manager,
        adapter,
      });
    }
    for (const name of Object.keys(table)) {
      if (!manager.getTools().some((t) => t.name === name) && table[name]?.allow) {
        this.opts.logger.warn({ upstream: manager.id, tool: name }, 'allow-listed tool not reported by upstream (version drift?)');
      }
    }
  }

  private add(tool: RegisteredTool): void {
    const existing = this.tools.get(tool.publicName);
    if (existing) {
      throw new ToolCollisionError(tool.publicName, `${existing.upstreamId}:${existing.upstreamName}`, `${tool.upstreamId}:${tool.upstreamName}`);
    }
    this.tools.set(tool.publicName, tool);
  }

  /** Enforces the curated-surface budget; called once after all registrations. */
  assertBudget(): void {
    const listed = this.list().length;
    if (listed > this.opts.maxListed) {
      throw new Error(`tools/list would expose ${listed} tools; the budget is ${this.opts.maxListed} (hide tools or raise server.maxListedTools)`);
    }
  }

  get(publicName: string): RegisteredTool | undefined {
    return this.tools.get(publicName);
  }

  all(): RegisteredTool[] {
    return [...this.tools.values()].sort((a, b) => a.publicName.localeCompare(b.publicName));
  }

  /** Deterministically ordered tools/list payload. */
  list(): ToolDefinition[] {
    return this.all()
      .filter((t) => t.listed)
      .map((t) => t.definition);
  }

  get ttlMs(): number {
    return this.opts.toolsListTtlMs;
  }

  search(query: string, includeHidden = true): RegisteredTool[] {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return this.all().filter((t) => {
      if (!includeHidden && !t.listed) return false;
      const hay = `${t.publicName} ${t.definition.description ?? ''} ${t.upstreamName}`.toLowerCase();
      return terms.length === 0 || terms.every((term) => hay.includes(term));
    });
  }
}
