import {
  PLAYWRIGHT_BLOCKED_TOOLS,
  PLAYWRIGHT_HIDDEN_TOOLS,
  PLAYWRIGHT_LISTED_TOOLS,
} from '@qa-brain/adapter-playwright';
import type { QaBrainConfigInput } from '@qa-brain/core';

/**
 * Configuration used when no config file is present: one Playwright MCP upstream with the curated table,
 * SQLite store under QA_BRAIN_HOME, filesystem artifacts.
 */
export function defaultConfig(): QaBrainConfigInput {
  return {
    server: { name: 'qa-brain' },
    store: { driver: 'sqlite', url: 'file:${QA_BRAIN_HOME:-./.qa-brain}/qa-brain.db' },
    artifacts: { driver: 'fs', dir: '${QA_BRAIN_HOME:-./.qa-brain}/artifacts' },
    log: { level: 'info', argsMode: 'redacted' },
    mcpServers: {
      playwright: {
        command: 'playwright',
        adapter: 'playwright',
        prefix: 'web_',
        strip: 'browser_',
        tools: {
          allow: [...PLAYWRIGHT_LISTED_TOOLS],
          hidden: [...PLAYWRIGHT_HIDDEN_TOOLS],
          block: [...PLAYWRIGHT_BLOCKED_TOOLS],
        },
      },
    },
  };
}
