import path from 'node:path';
import { adapterFor } from '@qa-brain/adapter-playwright';
import {
  createRedactor,
  type QaBrainConfig,
  type Redactor,
  type StoreAdapter,
  type UpstreamAdapter,
  VERSION,
} from '@qa-brain/core';
import { createStore } from '@qa-brain/store';
import { ActionLog } from './log/action-log.js';
import { createLogger, type Logger } from './log/logger.js';
import { ToolRegistry } from './registry/tool-registry.js';
import { Router } from './router/router.js';
import { type BuildServerInput, buildServer } from './server/build-server.js';
import type { GatewayServices } from './server/define-native-tool.js';
import { nativeTools, stubs } from './server/native/index.js';
import { EraCache } from './upstream/era-cache.js';
import { UpstreamManager, type UpstreamStatus } from './upstream/upstream-manager.js';

export interface GatewayOptions {
  config: QaBrainConfig;
  homeDir: string;
  /** Env-expanded secrets registered with the redactor. */
  secrets?: string[];
  logger?: Logger;
  store?: StoreAdapter;
  /** Override adapters (tests) or inject transports per upstream id. */
  adapters?: Record<string, UpstreamAdapter>;
  transportFactories?: Record<string, () => import('@modelcontextprotocol/client').Transport>;
  /** Budget for listed tools (CI test enforces 25). */
  maxListedTools?: number;
  /** Disable the era cache file (tests). */
  eraCacheFile?: string | null;
}

export interface Gateway {
  readonly config: QaBrainConfig;
  readonly homeDir: string;
  readonly logger: Logger;
  readonly redactor: Redactor;
  readonly store: StoreAdapter;
  readonly registry: ToolRegistry;
  readonly router: Router;
  readonly upstreams: Map<string, UpstreamManager>;
  readonly services: GatewayServices;
  /** Starts store + upstreams and builds the registry. Idempotent. */
  start(): Promise<void>;
  /** Builds a per-connection MCP server instance. */
  buildServer(
    input: Pick<BuildServerInput, 'transport' | 'principal' | 'era'>,
  ): ReturnType<typeof buildServer>;
  status(): UpstreamStatus[];
  close(): Promise<void>;
}

/**
 * Creates the gateway core: module-scope state shared by every downstream server instance.
 * Transports (stdio/http) are attached by the CLI via {@link Gateway.buildServer}.
 */
export async function createGateway(opts: GatewayOptions): Promise<Gateway> {
  const { config, homeDir } = opts;
  const redactor = createRedactor(opts.secrets ?? []);
  const token = process.env[config.http.bearerTokenEnv];
  if (token) redactor.addSecret(token);
  const logger = opts.logger ?? createLogger({ level: config.log.level, redactor });

  const store = opts.store ?? (await createStore(config.store));
  await store.migrate();

  const actionLog = new ActionLog(store, redactor, logger, config.log.argsMode);
  const registry = new ToolRegistry({
    toolsListTtlMs: config.server.toolsListTtlMs,
    exposeStubs: config.server.exposeStubs,
    maxListed: opts.maxListedTools ?? 25,
    logger,
  });
  const eraCache = new EraCache(
    opts.eraCacheFile === undefined ? path.join(homeDir, 'era-cache.json') : opts.eraCacheFile,
  );

  const upstreams = new Map<string, UpstreamManager>();
  const adapters = new Map<string, UpstreamAdapter>();
  for (const [id, upstreamConfig] of Object.entries(config.mcpServers)) {
    const adapter = opts.adapters?.[id] ?? adapterFor(upstreamConfig.adapter);
    adapters.set(id, adapter);
    upstreams.set(
      id,
      new UpstreamManager({
        id,
        config: upstreamConfig,
        adapter,
        homeDir,
        logger,
        redactor,
        eraCache,
        transportFactory: opts.transportFactories?.[id],
        // A restarted upstream re-publishes its tools (they may have been missing if the first connect failed).
        onReady: (manager) => {
          try {
            registerTools(manager);
          } catch (err) {
            logger.error(
              { upstream: manager.id, err },
              'failed to register tools after upstream (re)connect',
            );
          }
        },
      }),
    );
  }

  const startedAt = Date.now();
  // `call` is filled in once the router exists (natives → router → registry → natives).
  const services: GatewayServices = {
    store,
    logger,
    registry,
    version: VERSION,
    startedAt,
    upstreamStatus: () => [...upstreams.values()].map((u) => u.status()),
    call: async () => {
      throw new Error('router not ready');
    },
  };
  const router = new Router({
    registry,
    actionLog,
    logger,
    services,
    callTimeoutMs: config.server.callTimeoutMs,
    maxResultChars: config.server.maxResultChars,
  });
  services.call = (input) => router.call(input);

  let started: Promise<void> | null = null;
  let sweeper: NodeJS.Timeout | null = null;

  /** Registers (or refreshes) one upstream's tools. Idempotent, so restarts can call it again. */
  const registerTools = (u: UpstreamManager) => {
    const upstreamConfig = config.mcpServers[u.id];
    const adapter = adapters.get(u.id);
    if (upstreamConfig && adapter) registry.registerUpstream(u, upstreamConfig, adapter);
  };

  const start = async () => {
    for (const tool of [...nativeTools, ...stubs]) registry.registerNative(tool);
    // Connecting is tolerant: a dead upstream must not stop the gateway (its tools answer with a recovery
    // hint until it recovers). Registration is NOT tolerant: a tool-name collision is a configuration error
    // and must fail loudly at startup rather than silently shadowing a tool.
    const results = await Promise.allSettled([...upstreams.values()].map((u) => u.start()));
    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        const id = [...upstreams.keys()][i];
        logger.error(
          { upstream: id, err: r.reason },
          'upstream failed to start; its tools are unavailable until it recovers',
        );
      }
    }
    for (const u of upstreams.values()) registerTools(u);
    registry.assertBudget();
    sweeper = setInterval(() => void store.handles.sweep().catch(() => undefined), 5 * 60 * 1000);
    sweeper.unref?.();
    logger.info(
      { listed: registry.list().length, total: registry.all().length, upstreams: upstreams.size },
      'gateway ready',
    );
  };

  const gateway: Gateway = {
    config,
    homeDir,
    logger,
    redactor,
    store,
    registry,
    router,
    upstreams,
    services,
    start() {
      if (!started) started = start();
      return started;
    },
    buildServer(input) {
      return buildServer({ registry, router, config, ...input });
    },
    status: () => services.upstreamStatus(),
    async close() {
      if (sweeper) clearInterval(sweeper);
      await Promise.allSettled([...upstreams.values()].map((u) => u.stop()));
      await store.close().catch(() => undefined);
    },
  };
  return gateway;
}
