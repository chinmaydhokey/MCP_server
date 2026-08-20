import type { ToolTableEntry, UpstreamAdapter, UpstreamLaunch } from '@qa-brain/core';
import { defaultPlaywrightMcpArgs, unknownFlags } from './flags.js';
import { resolvePlaywrightCli } from './resolve-cli.js';
import { PLAYWRIGHT_TOOL_TABLE } from './tool-table.js';

export * from './flags.js';
export * from './resolve-cli.js';
export * from './tool-table.js';

/** The alias accepted in `mcpServers.<id>.command` that resolves to the bundled Playwright CLI. */
export const PLAYWRIGHT_COMMAND_ALIAS = 'playwright';

/**
 * Upstream adapter for Microsoft's Playwright MCP server (bundled with `playwright` ≥ 1.62).
 * Web platform, ARIA snapshots with `[ref=eN]` handles.
 */
export const playwrightAdapter: UpstreamAdapter = {
  id: 'playwright',
  platform: 'web',
  snapshotKind: 'aria-ref',

  resolveLaunch({ command, args, env, cwd, homeDir }): UpstreamLaunch {
    if (command === PLAYWRIGHT_COMMAND_ALIAS) {
      const { cliPath } = resolvePlaywrightCli();
      const cliArgs = args.length > 0 ? args : defaultPlaywrightMcpArgs(homeDir);
      const finalArgs = cliArgs[0] === 'mcp' ? cliArgs : ['mcp', ...cliArgs];
      return { command: process.execPath, args: [cliPath, ...finalArgs], env, cwd };
    }
    return { command, args, env, cwd };
  },

  toolTable(): Record<string, ToolTableEntry> {
    return PLAYWRIGHT_TOOL_TABLE;
  },

  validateFlags(helpText: string, args: string[]): string[] {
    return unknownFlags(helpText, args);
  },
};

/** Generic pass-through adapter for upstreams without a curated table (everything allowed, nothing hidden). */
export const genericAdapter: UpstreamAdapter = {
  id: 'generic',
  platform: 'any',
  snapshotKind: 'none',
  resolveLaunch({ command, args, env, cwd }) {
    return { command, args, env, cwd };
  },
  toolTable() {
    return {};
  },
};

export function adapterFor(id: 'playwright' | 'appium' | 'generic'): UpstreamAdapter {
  switch (id) {
    case 'playwright':
      return playwrightAdapter;
    case 'appium':
      // Designed in, implemented in milestone M6. Until then behave as a generic pass-through.
      return { ...genericAdapter, id: 'appium', platform: 'mobile', snapshotKind: 'synthesized' };
    default:
      return genericAdapter;
  }
}
