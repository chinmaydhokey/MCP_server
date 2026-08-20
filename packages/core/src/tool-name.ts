/**
 * Tool naming rules for the QA Brain gateway.
 *
 * - The Claude Messages API only accepts tool names matching `^[a-zA-Z0-9_-]{1,64}$`.
 * - Claude Code wraps MCP tools as `mcp__<server>__<tool>`, so we keep public names short (≤ 40 chars).
 * - Aggregating proxies SHOULD prefix upstream tool names with a server identifier (MCP 2026-07-28, tools).
 */

export const TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_PUBLIC_TOOL_NAME_LENGTH = 40;

export interface ToolNameMapping {
  /** Prefix prepended to every proxied tool, e.g. `web_`. */
  prefix: string;
  /** Optional upstream prefix removed before prepending `prefix`, e.g. `browser_`. */
  strip?: string;
}

export class ToolNameError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
  ) {
    super(message);
    this.name = 'ToolNameError';
  }
}

/** Returns the public (LLM-facing) name for an upstream tool. */
export function toPublicToolName(upstreamName: string, mapping: ToolNameMapping): string {
  const stripped =
    mapping.strip && upstreamName.startsWith(mapping.strip)
      ? upstreamName.slice(mapping.strip.length)
      : upstreamName;
  return `${mapping.prefix}${stripped}`;
}

/** Returns the upstream name for a public name, or `null` when the name does not belong to this mapping. */
export function toUpstreamToolName(publicName: string, mapping: ToolNameMapping): string | null {
  if (!publicName.startsWith(mapping.prefix)) return null;
  const rest = publicName.slice(mapping.prefix.length);
  return `${mapping.strip ?? ''}${rest}`;
}

/** Throws a {@link ToolNameError} when a public tool name violates the naming rules. */
export function assertValidToolName(name: string): void {
  if (!TOOL_NAME_REGEX.test(name)) {
    throw new ToolNameError(
      `Tool name "${name}" must match ${TOOL_NAME_REGEX} (Claude Messages API constraint)`,
      name,
    );
  }
  if (name.length > MAX_PUBLIC_TOOL_NAME_LENGTH) {
    throw new ToolNameError(
      `Tool name "${name}" is ${name.length} chars; QA Brain caps public names at ${MAX_PUBLIC_TOOL_NAME_LENGTH} so host wrappers (mcp__qa-brain__…) stay under 64`,
      name,
    );
  }
}

export function isValidToolName(name: string): boolean {
  return TOOL_NAME_REGEX.test(name) && name.length <= MAX_PUBLIC_TOOL_NAME_LENGTH;
}
