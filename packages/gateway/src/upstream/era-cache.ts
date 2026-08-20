import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Caches the protocol-era verdict per upstream launch signature so restarts skip the `server/discover`
 * probe (MCP 2026-07-28 versioning: era verdicts SHOULD be cached per server process/origin).
 * Entries are evicted when a connection using the cached verdict fails.
 */

export type EraVerdict = { kind: 'legacy' } | { kind: 'modern'; discover: unknown };

interface CacheFile {
  version: 1;
  entries: Record<string, { verdict: EraVerdict; updatedAt: number }>;
}

export function launchSignature(input: { command: string; args: string[]; envKeys: string[]; adapter: string; url?: string }): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ c: input.command, a: input.args, e: [...input.envKeys].sort(), ad: input.adapter, u: input.url ?? null }));
  return h.digest('hex').slice(0, 32);
}

export class EraCache {
  private data: CacheFile = { version: 1, entries: {} };
  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as CacheFile;
        if (parsed?.version === 1 && parsed.entries) this.data = parsed;
      } catch {
        this.data = { version: 1, entries: {} };
      }
    }
  }

  get(signature: string): EraVerdict | undefined {
    return this.data.entries[signature]?.verdict;
  }

  set(signature: string, verdict: EraVerdict): void {
    this.data.entries[signature] = { verdict, updatedAt: Date.now() };
    this.flush();
  }

  evict(signature: string): void {
    if (this.data.entries[signature]) {
      delete this.data.entries[signature];
      this.flush();
    }
  }

  private flush(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      /* cache is best-effort */
    }
  }
}
