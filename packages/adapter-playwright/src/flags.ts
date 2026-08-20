import path from 'node:path';

/**
 * Default launch flags for the Playwright MCP child in gateway (local stdio) mode.
 *
 * - `--headless --isolated`: no persistent profile, no cookie leakage between runs.
 * - `--caps=testing`: adds browser_generate_locator + browser_verify_* (accepted even though `--help` only
 *   advertises vision/pdf/devtools; verified on playwright 1.62.1).
 * - `--image-responses=omit`: screenshots are saved to the output dir instead of inflating tool results.
 * - `--codegen none`: do not append generated code to every action result (token savings).
 * - timeouts tuned for CI (navigation 30 s instead of 60 s).
 */
export function defaultPlaywrightMcpArgs(homeDir: string): string[] {
  return [
    'mcp',
    '--headless',
    '--isolated',
    '--caps=testing',
    '--snapshot-mode=full',
    '--image-responses=omit',
    '--codegen',
    'none',
    '--output-dir',
    path.join(homeDir, 'pw-out'),
    '--timeout-action',
    '5000',
    '--timeout-navigation',
    '30000',
  ];
}

/** Extracts the set of long flags (`--name`) from `playwright mcp --help` output. */
export function parseHelpFlags(helpText: string): Set<string> {
  const flags = new Set<string>();
  for (const m of helpText.matchAll(/(^|\s)(--[a-z][a-z0-9-]*)/g)) {
    flags.add(m[2] as string);
  }
  return flags;
}

/**
 * Returns the flags in `args` that do not appear in the `--help` output. `--caps` values and positional
 * values are ignored; `--no-<flag>` is accepted when `--<flag>` or `--no-<flag>` exists.
 */
export function unknownFlags(helpText: string, args: string[]): string[] {
  const known = parseHelpFlags(helpText);
  const unknown: string[] = [];
  for (const a of args) {
    if (!a.startsWith('--')) continue;
    const name = a.split('=')[0] as string;
    if (known.has(name)) continue;
    if (name.startsWith('--no-') && known.has(`--${name.slice(5)}`)) continue;
    unknown.push(name);
  }
  return unknown;
}
