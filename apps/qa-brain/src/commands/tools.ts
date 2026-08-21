import { createRedactor } from '@qa-brain/core';
import { createGateway, createLogger, loadConfig } from '@qa-brain/gateway';

export interface ToolsListOptions {
  config?: string;
  /** Include hidden, blocked and stub tools. */
  all?: boolean;
  json?: boolean;
}

/**
 * `qa-brain tools list` — starts the upstreams, builds the registry and prints the resulting tool surface.
 * This is what an operator runs to answer "what will the model actually see?".
 */
export async function toolsListCommand(opts: ToolsListOptions): Promise<number> {
  const loaded = loadConfig({ path: opts.config });
  const redactor = createRedactor(loaded.secrets);
  const logger = createLogger({ level: opts.json ? 'silent' : loaded.config.log.level, redactor });
  const gateway = await createGateway({
    config: loaded.config,
    homeDir: loaded.homeDir,
    secrets: loaded.secrets,
    logger,
  });

  try {
    await gateway.start();
    const rows = gateway.registry.all().filter((t) => opts.all || t.listed);
    if (opts.json) {
      const payload = rows.map((t) => ({
        name: t.publicName,
        source: t.kind === 'native' ? 'qa-brain' : `${t.upstreamId}:${t.upstreamName}`,
        listed: t.listed,
        callable: t.callable,
        status: t.status,
        description: t.definition.description ?? '',
      }));
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    const width = Math.max(...rows.map((t) => t.publicName.length), 4);
    process.stdout.write(`${'TOOL'.padEnd(width)}  VISIBILITY  SOURCE\n`);
    for (const t of rows) {
      const visibility =
        t.status === 'blocked' ? 'blocked' : t.status === 'stub' ? 'stub' : t.listed ? 'listed' : 'hidden';
      const source = t.kind === 'native' ? 'qa-brain' : `${t.upstreamId}:${t.upstreamName}`;
      process.stdout.write(`${t.publicName.padEnd(width)}  ${visibility.padEnd(10)}  ${source}\n`);
      if (opts.all) {
        const summary = (t.definition.description ?? '').split('\n')[0] ?? '';
        if (summary) process.stdout.write(`${' '.repeat(width)}              ${summary.slice(0, 100)}\n`);
      }
    }
    const listed = gateway.registry.list().length;
    process.stdout.write(
      `\n${listed} tools listed to the model, ${gateway.registry.all().length} registered in total\n`,
    );
    return 0;
  } finally {
    await gateway.close();
  }
}
