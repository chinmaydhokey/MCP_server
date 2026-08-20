import { describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_BLOCKED_TOOLS,
  PLAYWRIGHT_HIDDEN_TOOLS,
  PLAYWRIGHT_LISTED_TOOLS,
  playwrightAdapter,
  resolvePlaywrightCli,
  unknownFlags,
} from '../src/index.js';

describe('playwright adapter', () => {
  it('resolves the bundled CLI of the pinned playwright version without npx', () => {
    const r = resolvePlaywrightCli();
    expect(r.cliPath.endsWith('cli.js')).toBe(true);
    expect(r.version).toBe('1.62.1');
    const launch = playwrightAdapter.resolveLaunch({ command: 'playwright', args: [], env: {}, homeDir: '/tmp/home' });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[0]).toBe(r.cliPath);
    expect(launch.args[1]).toBe('mcp');
    expect(launch.args).toContain('--caps=testing');
    expect(launch.args).not.toContain('npx');
  });
  it('keeps custom args but guarantees the mcp subcommand', () => {
    const launch = playwrightAdapter.resolveLaunch({ command: 'playwright', args: ['--headless'], env: {}, homeDir: '.' });
    expect(launch.args.slice(1)).toEqual(['mcp', '--headless']);
  });
  it('has a curated table: 15 listed, 12 hidden, RCE tools blocked, no overlaps', () => {
    expect(PLAYWRIGHT_LISTED_TOOLS).toHaveLength(15);
    expect(PLAYWRIGHT_HIDDEN_TOOLS).toHaveLength(12);
    expect(PLAYWRIGHT_BLOCKED_TOOLS).toContain('browser_run_code_unsafe');
    expect(PLAYWRIGHT_BLOCKED_TOOLS).toContain('browser_evaluate');
    const all = [...PLAYWRIGHT_LISTED_TOOLS, ...PLAYWRIGHT_HIDDEN_TOOLS, ...PLAYWRIGHT_BLOCKED_TOOLS];
    expect(new Set(all).size).toBe(all.length);
  });
  it('detects unknown flags against --help output', () => {
    const help = 'Options:\n  --headless  run headless\n  --caps <caps>  caps\n  --sandbox  x\n';
    expect(unknownFlags(help, ['--headless', '--caps=testing', '--no-sandbox', '--bogus', 'value'])).toEqual(['--bogus']);
  });
});
