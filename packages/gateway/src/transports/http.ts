import { timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server as NodeServer, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostHeaderValidation, localhostHostValidation, localhostOriginValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server';
import type { Gateway } from '../gateway.js';

export interface HttpServeOptions {
  host?: string;
  port?: number;
  /** Overrides config.http.allowUnauthenticated (CLI flag). */
  allowUnauthenticated?: boolean;
}

export interface HttpHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class HttpAuthConfigError extends Error {}

/**
 * Serves the gateway over Streamable HTTP at `POST /mcp` with bearer auth, plus `/healthz` and `/readyz`.
 *
 * - `createMcpHandler` builds a fresh server per request (stateless, 2026-07-28) and serves legacy clients
 *   without sessions (`legacy: 'stateless'`).
 * - Host/Origin validation protects against DNS rebinding; defaults to localhost-only unless allow-lists are set.
 * - The bearer token comes from `process.env[config.http.bearerTokenEnv]`; unauthenticated mode is only honoured
 *   on loopback binds (API keys stored in the database arrive with hosted mode in M5).
 */
export async function serveGatewayHttp(gateway: Gateway, opts: HttpServeOptions = {}): Promise<HttpHandle> {
  const cfg = gateway.config.http;
  const host = opts.host ?? cfg.host;
  const port = opts.port ?? cfg.port;
  const allowUnauthenticated = opts.allowUnauthenticated ?? cfg.allowUnauthenticated;
  const token = process.env[cfg.bearerTokenEnv];

  if (!token && !allowUnauthenticated) {
    throw new HttpAuthConfigError(
      `HTTP mode requires a bearer token in $${cfg.bearerTokenEnv} (or --allow-unauthenticated on a loopback bind)`,
    );
  }
  if (!token && allowUnauthenticated && !isLoopback(host)) {
    throw new HttpAuthConfigError('--allow-unauthenticated is only permitted when binding to 127.0.0.1/localhost');
  }

  const mcp = createMcpHandler(
    (ctx) => gateway.buildServer({ transport: 'http', principal: ctx.authInfo?.clientId ?? 'anonymous', era: ctx.era }),
    { legacy: 'stateless', onerror: (err) => gateway.logger.error({ err }, 'http mcp handler error') },
  );

  const hostCheck = cfg.allowedHosts.length > 0 ? hostHeaderValidation(cfg.allowedHosts) : localhostHostValidation();
  const originCheck = cfg.allowedOrigins.length > 0 ? originValidation(cfg.allowedOrigins) : localhostOriginValidation();

  const authenticate = (req: IncomingMessage): AuthInfo | null => {
    if (!token) return { token: '', clientId: 'anonymous', scopes: ['local'] };
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    const presented = header.slice('Bearer '.length).trim();
    if (!constantTimeEqual(presented, token)) return null;
    return { token: presented, clientId: 'bearer', scopes: ['gateway'] };
  };

  // toNodeHandler reads `req.auth` (Express convention) and forwards it as `authInfo` to the MCP handler.
  const nodeHandler = toNodeHandler(mcp, { onerror: (err) => gateway.logger.error({ err }, 'http transport error') });

  const server: NodeServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, version: gateway.services.version });
    if (url.pathname === '/readyz') {
      const storeOk = await gateway.store.ping().catch(() => false);
      const upstreams = gateway.status();
      const ready = storeOk && upstreams.every((u) => u.state === 'healthy' || u.state === 'degraded');
      return json(res, ready ? 200 : 503, { ok: ready, store: storeOk, upstreams: upstreams.map((u) => ({ id: u.id, state: u.state })) });
    }
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'not_found' });
    if (!hostCheck(req, res) || !originCheck(req, res)) return; // helpers already wrote 403
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { error: 'method_not_allowed' });
    }
    const authInfo = authenticate(req);
    if (!authInfo) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="qa-brain"');
      return json(res, 401, { error: 'unauthorized' });
    }
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    await nodeHandler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  const url = `http://${host}:${actual}/mcp`;
  gateway.logger.info({ url, auth: token ? 'bearer' : 'none' }, 'http transport listening');
  return {
    url,
    port: actual,
    async close() {
      await mcp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
