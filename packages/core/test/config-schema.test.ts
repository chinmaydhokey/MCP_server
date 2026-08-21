import { describe, expect, it } from 'vitest';
import { isStdioUpstream, parseConfig } from '../src/config-schema.js';

describe('config schema', () => {
  it('applies nested defaults to an empty config', () => {
    const c = parseConfig({});
    expect(c.server.toolsListTtlMs).toBe(300_000);
    expect(c.store).toEqual({ driver: 'sqlite', url: 'file:./.qa-brain/qa-brain.db' });
    expect(c.http.port).toBe(8787);
    expect(c.log.argsMode).toBe('redacted');
    expect(c.mcpServers).toEqual({});
  });
  it('parses a stdio upstream with tool filters and defaults', () => {
    const c = parseConfig({
      mcpServers: {
        playwright: {
          command: 'playwright',
          adapter: 'playwright',
          prefix: 'web_',
          strip: 'browser_',
          tools: { allow: ['browser_click'] },
        },
      },
    });
    const up = c.mcpServers.playwright;
    expect(up && isStdioUpstream(up)).toBe(true);
    expect(up?.tools.allow).toEqual(['browser_click']);
    expect(up?.health.unhealthyThreshold).toBe(3);
    expect(up?.restart.maxAttempts).toBe(5);
  });
  it('rejects bad prefixes and upstream ids', () => {
    expect(() => parseConfig({ mcpServers: { playwright: { command: 'x', prefix: 'Web' } } })).toThrow();
    expect(() => parseConfig({ mcpServers: { 'Play Wright': { command: 'x' } } })).toThrow();
  });
});
