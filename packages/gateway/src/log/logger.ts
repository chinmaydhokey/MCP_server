import type { LogLevel, Redactor } from '@qa-brain/core';
import { type Logger, destination, pino, stdTimeFunctions } from 'pino';

export type { Logger };

/**
 * Creates the gateway logger. In stdio mode stdout is the MCP channel, so logs ALWAYS go to stderr (fd 2).
 * Every string written through the logger passes through the redactor.
 */
export function createLogger(opts: { level: LogLevel; redactor: Redactor; name?: string; destination?: number }): Logger {
  const { redactor } = opts;
  return pino(
    {
      name: opts.name ?? 'qa-brain',
      level: opts.level === 'silent' ? 'silent' : opts.level,
      base: undefined,
      timestamp: stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        log: (obj) => redactor.value(obj) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const redacted = args.map((a) => (typeof a === 'string' ? redactor.text(a) : a));
          return method.apply(this, redacted as Parameters<typeof method>);
        },
      },
    },
    destination({ fd: opts.destination ?? 2, sync: true }),
  );
}
