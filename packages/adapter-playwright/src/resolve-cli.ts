import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Resolves the Playwright CLI shipped with the pinned `playwright` dependency of this package.
 *
 * We deliberately do NOT use `npx` (network access at spawn time, `.cmd` shims that Node refuses to spawn
 * without `shell: true` on Windows) and do NOT depend on `@playwright/mcp` (tracks Playwright alpha builds).
 * `playwright mcp` has been a first-class subcommand since Playwright 1.62.
 */
export interface ResolvedPlaywrightCli {
  /** Absolute path to `playwright/cli.js`. */
  cliPath: string;
  /** Absolute path to the `playwright` package directory. */
  packageDir: string;
  /** Version string from the package manifest. */
  version: string;
}

export function resolvePlaywrightCli(from: string = import.meta.url): ResolvedPlaywrightCli {
  const require = createRequire(from);
  const manifestPath = require.resolve('playwright/package.json');
  const packageDir = path.dirname(manifestPath);
  const cliPath = path.join(packageDir, 'cli.js');
  if (!existsSync(cliPath)) {
    throw new Error(`playwright/cli.js not found next to ${manifestPath}`);
  }
  const manifest = require(manifestPath) as { version: string };
  return { cliPath, packageDir, version: manifest.version };
}

/** Returns the spawn tuple for `playwright <args...>` using the current Node executable. */
export function playwrightSpawnArgs(cliArgs: string[], from?: string): { command: string; args: string[] } {
  const { cliPath } = resolvePlaywrightCli(from);
  return { command: process.execPath, args: [cliPath, ...cliArgs] };
}
