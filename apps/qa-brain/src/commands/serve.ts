import { createRedactor } from '@qa-brain/core';
import {
  createGateway,
  createLogger,
  loadConfig,
  serveGatewayHttp,
  serveGatewayStdio,
} from '@qa-brain/gateway';

export interface ServeOptions {
  transport: 'stdio' | 'http';
  config?: string;
  port?: number;
  host?: string;
  allowUnauthenticated?: boolean;
  logLevel?: string;
  dryRun?: boolean;
}

/**
 * `qa-brain serve` — starts the gateway on stdio (local, one LLM host) or Streamable HTTP (shared).
 *
 * In stdio mode stdout carries the MCP protocol, so nothing but JSON-RPC may be written there: diagnostics go
 * to stderr, and `--dry-run` (which never opens a transport) is the only thing that prints to stdout.
 */
export async function serveCommand(opts: ServeOptions): Promise<number> {
  const loaded = loadConfig({ path: opts.config });
  const { config } = loaded;
  if (opts.logLevel) config.log.level = opts.logLevel as typeof config.log.level;
  if (opts.transport === 'http') {
    if (opts.port !== undefined) config.http.port = opts.port;
    if (opts.host !== undefined) config.http.host = opts.host;
    if (opts.allowUnauthenticated !== undefined) config.http.allowUnauthenticated = opts.allowUnauthenticated;
  }

  const redactor = createRedactor(loaded.secrets);
  const logger = createLogger({ level: config.log.level, redactor });
  logger.info(
    {
      config: loaded.configPath ?? '(defaults)',
      home: loaded.homeDir,
      store: config.store.driver,
      transport: opts.transport,
    },
    'starting qa-brain',
  );

  const gateway = await createGateway({ config, homeDir: loaded.homeDir, secrets: loaded.secrets, logger });

  let closing = false;
  const close = async (code: number): Promise<number> => {
    if (closing) return code;
    closing = true;
    await gateway.close();
    return code;
  };

  try {
    await gateway.start();
  } catch (err) {
    logger.error({ err }, 'gateway failed to start');
    return close(1);
  }

  if (opts.dryRun) {
    const listed = gateway.registry.list().length;
    const total = gateway.registry.all().length;
    const unhealthy = gateway.status().filter((u) => u.state !== 'healthy');
    process.stdout.write(
      `qa-brain dry run: ${listed} listed tools, ${total} registered, ${gateway.upstreams.size} upstream(s)\n`,
    );
    for (const u of gateway.status()) {
      process.stdout.write(
        `  upstream ${u.id}: ${u.state}${u.era ? ` (${u.era}, ${u.protocolVersion})` : ''} — ${u.toolCount} tools\n`,
      );
    }
    return close(unhealthy.length > 0 ? 1 : 0);
  }

  const onSignal = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'shutting down');
    void close(0).then((code) => process.exit(code));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  if (opts.transport === 'stdio') {
    const handle = serveGatewayStdio(gateway);
    // The host closes our stdin to ask us to exit (MCP stdio shutdown sequence).
    process.stdin.once('end', () => {
      void handle.close().then(() => close(0).then((code) => process.exit(code)));
    });
    await new Promise<void>(() => undefined); // serve until a signal or stdin EOF
    return 0;
  }

  const http = await serveGatewayHttp(gateway, {
    port: opts.port,
    host: opts.host,
    allowUnauthenticated: opts.allowUnauthenticated,
  });
  logger.info({ url: http.url }, 'qa-brain is listening');
  await new Promise<void>(() => undefined);
  return 0;
}
