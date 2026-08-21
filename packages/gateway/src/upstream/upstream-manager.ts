import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  isStdioUpstream,
  type ProtocolEra,
  type Redactor,
  type ToolCallResult,
  type ToolDefinition,
  type UpstreamAdapter,
  type UpstreamConfig,
  VERSION,
} from '@qa-brain/core';
import type { Logger } from '../log/logger.js';
import { type EraCache, type EraVerdict, launchSignature } from './era-cache.js';
import { isAlive, killTree } from './kill-tree.js';

export type UpstreamState = 'stopped' | 'starting' | 'healthy' | 'degraded' | 'failed' | 'stopping';

export interface UpstreamStatus {
  id: string;
  state: UpstreamState;
  transport: 'stdio' | 'http';
  era: ProtocolEra | null;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  pid: number | null;
  restarts: number;
  consecutiveFailures: number;
  lastProbeMs: number | null;
  lastError: string | null;
  toolCount: number;
  startedAt: number | null;
  nextRestartInMs: number | null;
}

export class UpstreamUnavailableError extends Error {
  constructor(
    readonly upstreamId: string,
    readonly status: UpstreamStatus,
  ) {
    const retry =
      status.state === 'failed'
        ? 'restart attempts exhausted; check qa_health and server logs'
        : status.nextRestartInMs !== null
          ? `restarting (attempt ${status.restarts + 1}/${status.restarts + 1}); retry in ${Math.ceil(status.nextRestartInMs / 1000)} s`
          : 'starting; retry shortly';
    super(`upstream '${upstreamId}' is ${status.state}: ${retry}`);
    this.name = 'UpstreamUnavailableError';
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(
    readonly upstreamId: string,
    readonly tool: string,
    readonly timeoutMs: number,
  ) {
    super(
      `upstream '${upstreamId}' tool ${tool} timed out after ${timeoutMs} ms; the browser may still be busy — take a fresh snapshot before retrying`,
    );
    this.name = 'UpstreamTimeoutError';
  }
}

export interface UpstreamManagerOptions {
  id: string;
  config: UpstreamConfig;
  adapter: UpstreamAdapter;
  homeDir: string;
  logger: Logger;
  redactor: Redactor;
  eraCache: EraCache;
  /** Injected for tests: build a transport instead of spawning. */
  transportFactory?: () => import('@modelcontextprotocol/client').Transport;
  /** Called after every successful (re)connect, once the tool list has been fetched. */
  onReady?: (manager: UpstreamManager) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Owns exactly one upstream MCP server: its transport (stdio child or HTTP), its `Client`, the era verdict,
 * health probing and restarts. Lives in module scope and is shared by every downstream server instance.
 */
export class UpstreamManager {
  readonly id: string;
  private state: UpstreamState = 'stopped';
  private client: Client | null = null;
  private transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | import('@modelcontextprotocol/client').Transport
    | null = null;
  private tools: ToolDefinition[] = [];
  private restarts = 0;
  private consecutiveFailures = 0;
  private lastProbeMs: number | null = null;
  private lastError: string | null = null;
  private startedAt: number | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private nextRestartAt: number | null = null;
  private starting: Promise<void> | null = null;
  private readonly stopSignal = new AbortController();
  private readonly signature: string;

  constructor(private readonly opts: UpstreamManagerOptions) {
    this.id = opts.id;
    const c = opts.config;
    this.signature = launchSignature(
      isStdioUpstream(c)
        ? { command: c.command, args: c.args, envKeys: Object.keys(c.env), adapter: c.adapter }
        : { command: 'http', args: [], envKeys: [], adapter: c.adapter, url: c.url },
    );
  }

  get transportKind(): 'stdio' | 'http' {
    return isStdioUpstream(this.opts.config) ? 'stdio' : 'http';
  }

  status(): UpstreamStatus {
    const pid = this.transport instanceof StdioClientTransport ? this.transport.pid : null;
    return {
      id: this.id,
      state: this.state,
      transport: this.transportKind,
      era: this.client?.getProtocolEra() ?? null,
      protocolVersion: this.client?.getNegotiatedProtocolVersion() ?? null,
      serverInfo: (this.client?.getServerVersion() as { name: string; version: string } | undefined) ?? null,
      pid: pid ?? null,
      restarts: this.restarts,
      consecutiveFailures: this.consecutiveFailures,
      lastProbeMs: this.lastProbeMs,
      lastError: this.lastError,
      toolCount: this.tools.length,
      startedAt: this.startedAt,
      nextRestartInMs: this.nextRestartAt ? Math.max(0, this.nextRestartAt - Date.now()) : null,
    };
  }

  /** Cached upstream tool definitions (populated by start()). */
  getTools(): ToolDefinition[] {
    return this.tools;
  }

  async start(): Promise<void> {
    if (this.state === 'healthy') return;
    if (this.starting) return this.starting;
    this.starting = this.connectWithEraFallback().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private buildTransport() {
    if (this.opts.transportFactory) return this.opts.transportFactory();
    const c = this.opts.config;
    if (isStdioUpstream(c)) {
      const launch = this.opts.adapter.resolveLaunch({
        command: c.command,
        args: c.args,
        env: c.env,
        cwd: c.cwd,
        homeDir: this.opts.homeDir,
      });
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: { ...getDefaultEnvironment(), ...launch.env },
        cwd: launch.cwd,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trimEnd();
        if (text) this.opts.logger.debug({ upstream: this.id }, `[stderr] ${text}`);
      });
      return transport;
    }
    return new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers: c.headers } });
  }

  private async connectWithEraFallback(): Promise<void> {
    const cached = this.opts.eraCache.get(this.signature);
    try {
      await this.connectOnce(cached);
    } catch (err) {
      if (cached) {
        this.opts.logger.warn(
          { upstream: this.id, err },
          'connect with cached era verdict failed; evicting and retrying with auto negotiation',
        );
        this.opts.eraCache.evict(this.signature);
        await this.connectOnce(undefined);
        return;
      }
      throw err;
    }
  }

  private async connectOnce(verdict: EraVerdict | undefined): Promise<void> {
    this.state = 'starting';
    this.lastError = null;
    const transport = this.buildTransport();
    const client = new Client(
      { name: 'qa-brain', version: VERSION },
      { versionNegotiation: { mode: verdict?.kind === 'legacy' ? 'legacy' : 'auto' } },
    );
    client.onerror = (err) => {
      this.lastError = err.message;
      this.opts.logger.warn({ upstream: this.id, err }, 'upstream protocol error');
    };
    client.onclose = () => {
      if (this.state === 'stopping' || this.state === 'stopped') return;
      this.opts.logger.warn({ upstream: this.id }, 'upstream connection closed unexpectedly');
      this.onUnexpectedExit('connection closed');
    };
    try {
      await client.connect(
        transport,
        verdict?.kind === 'modern'
          ? { prior: { kind: 'modern', discover: verdict.discover as never } }
          : undefined,
      );
      this.client = client;
      this.transport = transport;
      const era = client.getProtocolEra() ?? 'legacy';
      if (era === 'modern') {
        const discover = client.getDiscoverResult();
        if (discover) this.opts.eraCache.set(this.signature, { kind: 'modern', discover });
      } else {
        this.opts.eraCache.set(this.signature, { kind: 'legacy' });
      }
      const list = await client.listTools();
      this.tools = list.tools as unknown as ToolDefinition[];
      this.state = 'healthy';
      this.consecutiveFailures = 0;
      this.startedAt = Date.now();
      this.nextRestartAt = null;
      this.startHealthTimer();
      this.opts.logger.info(
        {
          upstream: this.id,
          era,
          version: client.getNegotiatedProtocolVersion(),
          server: client.getServerVersion(),
          tools: this.tools.length,
        },
        'upstream connected',
      );
      this.opts.onReady?.(this);
    } catch (err) {
      this.lastError = (err as Error).message;
      this.state = 'degraded';
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      if (transport instanceof StdioClientTransport) await killTree(transport.pid);
      throw err;
    }
  }

  private startHealthTimer(): void {
    this.clearHealthTimer();
    const { intervalMs } = this.opts.config.health;
    this.healthTimer = setInterval(() => void this.probe(), intervalMs);
    this.healthTimer.unref?.();
  }

  private clearHealthTimer(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  /** Liveness probe: `server/discover` on modern upstreams, `ping` on legacy ones. */
  async probe(): Promise<boolean> {
    if (!this.client || this.state === 'stopping' || this.state === 'stopped') return false;
    const { timeoutMs, unhealthyThreshold } = this.opts.config.health;
    const t0 = Date.now();
    try {
      if (this.client.getProtocolEra() === 'modern') await this.client.discover({ timeout: timeoutMs });
      else await this.client.ping({ timeout: timeoutMs });
      this.lastProbeMs = Date.now() - t0;
      this.consecutiveFailures = 0;
      if (this.state === 'degraded') this.state = 'healthy';
      return true;
    } catch (err) {
      this.consecutiveFailures += 1;
      this.lastError = (err as Error).message;
      this.opts.logger.warn(
        { upstream: this.id, failures: this.consecutiveFailures, err },
        'health probe failed',
      );
      if (this.consecutiveFailures >= unhealthyThreshold) this.onUnexpectedExit('health probes failed');
      else this.state = 'degraded';
      return false;
    }
  }

  private onUnexpectedExit(reason: string): void {
    if (this.state === 'stopping' || this.state === 'stopped') return;
    this.clearHealthTimer();
    const dead = this.transport;
    this.client = null;
    this.transport = null;
    this.state = 'degraded';
    if (dead instanceof StdioClientTransport) void killTree(dead.pid);
    this.scheduleRestart(reason);
  }

  private scheduleRestart(reason: string): void {
    const { maxAttempts, baseMs, maxMs } = this.opts.config.restart;
    if (this.restarts >= maxAttempts) {
      this.state = 'failed';
      this.nextRestartAt = null;
      this.opts.logger.error(
        { upstream: this.id, reason, restarts: this.restarts },
        'upstream failed permanently (restart attempts exhausted)',
      );
      return;
    }
    const delay = Math.min(maxMs, baseMs * 2 ** this.restarts);
    this.nextRestartAt = Date.now() + delay;
    this.opts.logger.warn(
      { upstream: this.id, reason, delayMs: delay, attempt: this.restarts + 1, maxAttempts },
      'scheduling upstream restart',
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restarts += 1;
      void this.start().catch((err) => {
        this.opts.logger.warn({ upstream: this.id, err }, 'restart failed');
        this.scheduleRestart('restart failed');
      });
    }, delay);
    this.restartTimer.unref?.();
  }

  /**
   * Calls an upstream tool. Throws {@link UpstreamUnavailableError} when not connected and
   * {@link UpstreamTimeoutError} on timeout; other SDK errors propagate unchanged.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    opts: { signal?: AbortSignal; timeoutMs: number; meta?: Record<string, unknown> },
  ): Promise<ToolCallResult> {
    if (this.state === 'starting' && this.starting) await this.starting.catch(() => undefined);
    if (!this.client || (this.state !== 'healthy' && this.state !== 'degraded')) {
      throw new UpstreamUnavailableError(this.id, this.status());
    }
    try {
      const mapped = this.opts.adapter.mapArgs
        ? (this.opts.adapter.mapArgs(name, args) as Record<string, unknown>)
        : args;
      const result = (await this.client.callTool(
        { name, arguments: mapped ?? {}, _meta: opts.meta as never },
        {
          signal: opts.signal,
          timeout: opts.timeoutMs,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: opts.timeoutMs * 5,
        },
      )) as unknown as ToolCallResult;
      return this.opts.adapter.mapResult ? this.opts.adapter.mapResult(name, result) : result;
    } catch (err) {
      const e = err as Error & { code?: number };
      // SDK request timeout (ProtocolErrorCode.RequestTimeout = -32001 in legacy era) or our own signal.
      if (/timed out|timeout/i.test(e.message) || e.code === -32001) {
        throw new UpstreamTimeoutError(this.id, name, opts.timeoutMs);
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return;
    this.state = 'stopping';
    this.stopSignal.abort();
    this.clearHealthTimer();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const transport = this.transport;
    const client = this.client;
    this.client = null;
    this.transport = null;
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
    if (transport instanceof StdioClientTransport) {
      // Spec shutdown sequence: close stdin (done by transport.close()) → wait → SIGTERM → SIGKILL.
      await sleep(200);
      if (isAlive(transport.pid)) await killTree(transport.pid, { graceMs: 2000 });
    }
    this.state = 'stopped';
    this.opts.logger.info({ upstream: this.id }, 'upstream stopped');
  }
}
