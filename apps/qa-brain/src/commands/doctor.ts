import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { defaultPlaywrightMcpArgs, resolvePlaywrightCli, unknownFlags } from '@qa-brain/adapter-playwright';
import { isStdioUpstream, VERSION } from '@qa-brain/core';
import { loadConfig } from '@qa-brain/gateway';
import { createStore } from '@qa-brain/store';

const exec = promisify(execFile);

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

/** Runs every diagnostic and returns the results (pure enough to unit-test). */
export async function runChecks(configPath?: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail });

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  add(
    'node',
    nodeOk ? 'pass' : 'fail',
    `${process.versions.node} (need >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR})`,
  );
  add('platform', 'pass', `${process.platform} ${process.arch}`);
  add('qa-brain', 'pass', VERSION);

  let loaded: ReturnType<typeof loadConfig> | null = null;
  try {
    loaded = loadConfig({ path: configPath });
    add(
      'config',
      'pass',
      `${loaded.configPath ?? 'built-in defaults'} (${Object.keys(loaded.config.mcpServers).length} upstream(s))`,
    );
  } catch (err) {
    add('config', 'fail', (err as Error).message);
  }

  if (loaded) {
    try {
      mkdirSync(loaded.homeDir, { recursive: true });
      accessSync(loaded.homeDir, constants.W_OK);
      add('home directory', 'pass', loaded.homeDir);
    } catch (err) {
      add('home directory', 'fail', `${loaded.homeDir}: ${(err as Error).message}`);
    }

    try {
      const store = await createStore(loaded.config.store);
      await store.migrate();
      const ok = await store.ping();
      await store.close();
      add('store', ok ? 'pass' : 'fail', `${loaded.config.store.driver} — migrations applied`);
    } catch (err) {
      add('store', 'fail', `${loaded.config.store.driver}: ${(err as Error).message}`);
    }
  }

  const usesPlaywright =
    !loaded ||
    Object.values(loaded.config.mcpServers).some(
      (u) => u.adapter === 'playwright' || (isStdioUpstream(u) && u.command === 'playwright'),
    );

  if (usesPlaywright) {
    let cliPath: string | null = null;
    try {
      const cli = resolvePlaywrightCli();
      cliPath = cli.cliPath;
      add('playwright', 'pass', `${cli.version} at ${cli.cliPath}`);
    } catch (err) {
      add('playwright', 'fail', (err as Error).message);
    }

    if (cliPath) {
      try {
        const { stdout } = await exec(process.execPath, [cliPath, 'mcp', '--help'], { timeout: 30_000 });
        const args = defaultPlaywrightMcpArgs(loaded?.homeDir ?? '.').slice(1);
        const unknown = unknownFlags(stdout, args);
        add(
          'playwright mcp flags',
          unknown.length === 0 ? 'pass' : 'fail',
          unknown.length === 0
            ? 'all default flags are supported'
            : `unsupported flags: ${unknown.join(', ')}`,
        );
      } catch (err) {
        add(
          'playwright mcp flags',
          'fail',
          `could not run "playwright mcp --help": ${(err as Error).message}`,
        );
      }

      try {
        const { stdout } = await exec(process.execPath, [cliPath, 'install', '--dry-run', 'chromium'], {
          timeout: 60_000,
        });
        const location = /Install location:\s*(.+)/.exec(stdout)?.[1]?.trim();
        const installed = location ? existsSync(location) : false;
        add(
          'chromium',
          installed ? 'pass' : 'fail',
          installed
            ? (location as string)
            : `not installed — run "pnpm exec playwright install chromium"${location ? ` (expected at ${location})` : ''}`,
        );
      } catch (err) {
        add('chromium', 'warn', `could not check the browser install: ${(err as Error).message}`);
      }
    }
  }

  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    add(
      'taskkill',
      existsSync(taskkill) ? 'pass' : 'warn',
      existsSync(taskkill) ? taskkill : 'not found — child process trees may leak on shutdown',
    );
  }

  const llm = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_HOST'].filter((k) => process.env[k]);
  add(
    'llm credentials',
    llm.length > 0 ? 'pass' : 'warn',
    llm.length > 0 ? `${llm.join(', ')} set` : 'none set (only needed by the headless runner, milestone M5)',
  );

  return checks;
}

/** `qa-brain doctor` — prints a table and exits non-zero when any check fails. */
export async function doctorCommand(opts: { config?: string } = {}): Promise<number> {
  const checks = await runChecks(opts.config);
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    process.stdout.write(`  ${icon[c.status]}  ${c.name.padEnd(width)}  ${c.detail}\n`);
  }
  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  process.stdout.write(
    `\n${checks.length} checks: ${checks.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failures\n`,
  );
  return failed.length > 0 ? 1 : 0;
}
