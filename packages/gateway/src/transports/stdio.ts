import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { Gateway } from '../gateway.js';

export interface StdioHandle {
  close(): Promise<void>;
}

/**
 * Serves the gateway over stdio. Modern (2026-07-28) clients are served statelessly; legacy clients get the
 * initialize handshake (`legacy: 'serve'`). stdout is the protocol channel, so `console.*` is rebound to stderr.
 */
export function serveGatewayStdio(gateway: Gateway): StdioHandle {
  rebindConsoleToStderr();
  const handle = serveStdio(
    (ctx) => gateway.buildServer({ transport: 'stdio', principal: 'local', era: ctx.era }),
    { legacy: 'serve', onerror: (err: Error) => gateway.logger.error({ err }, 'stdio transport error') },
  );
  return {
    async close() {
      await handle.close();
    },
  };
}

export function rebindConsoleToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(`${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
}
