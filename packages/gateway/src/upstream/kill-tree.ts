import { execFile } from 'node:child_process';

/** Returns true when a process with `pid` exists (signal 0 probe). */
export function isAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Kills a child process tree. Playwright MCP spawns Chromium grandchildren, so a plain `kill(pid)` can leave
 * zombies. POSIX: SIGTERM → wait → SIGKILL (negative pid targets the process group when the child was spawned
 * detached). Windows has no SIGTERM: `taskkill /T /F` kills the tree.
 */
export async function killTree(
  pid: number | null | undefined,
  opts: { graceMs?: number } = {},
): Promise<void> {
  if (!isAlive(pid)) return;
  const graceMs = opts.graceMs ?? 3000;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
    });
    return;
  }
  try {
    process.kill(pid as number, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await sleep(100);
  }
  try {
    process.kill(pid as number, 'SIGKILL');
  } catch {
    /* already gone */
  }
}
