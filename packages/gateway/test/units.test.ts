import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MissingEnvError, capResult, classify, effectiveToolTable, expandEnv, loadConfig, parseTraceparent, toJsonSchema, traceContextFromMeta } from '../src/index.js';
import { z } from 'zod';

describe('expandEnv', () => {
  it('expands ${VAR} and ${VAR:-default} and reports expanded secrets', () => {
    const { value, expanded } = expandEnv({ a: '${FOO}', b: '${MISSING:-dflt}', c: ['x${FOO}y'], n: 1 }, { FOO: 'secret1' });
    expect(value).toEqual({ a: 'secret1', b: 'dflt', c: ['xsecret1y'], n: 1 });
    expect(expanded).toEqual(['secret1', 'secret1']);
  });
  it('fails fast on unset variables without defaults', () => {
    expect(() => expandEnv({ a: '${NOPE}' }, {})).toThrow(MissingEnvError);
  });
});

describe('loadConfig', () => {
  it('uses defaults with a Playwright upstream when no file exists', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'qab-'));
    const { config, configPath, homeDir } = loadConfig({ cwd, env: {} });
    expect(configPath).toBeNull();
    expect(homeDir).toBe(path.resolve(cwd, '.qa-brain'));
    expect(config.mcpServers.playwright?.adapter).toBe('playwright');
    expect(config.store.driver).toBe('sqlite');
    expect(config.store.url.startsWith('file:')).toBe(true);
    expect(path.isAbsolute(config.store.url.slice('file:'.length))).toBe(true);
  });
  it('reads yaml files, expands env and resolves relative paths against the config dir', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qab-'));
    const file = path.join(dir, 'qa-brain.config.yaml');
    writeFileSync(
      file,
      ['store:', '  driver: sqlite', '  url: file:./data/db.sqlite', 'http:', '  port: ${PORT:-9999}', 'mcpServers:', '  pw:', '    command: playwright', '    env:', '      TOKEN: ${MY_TOKEN}', ''].join('\n'),
    );
    const { config, secrets } = loadConfig({ path: file, env: { MY_TOKEN: 'tok-123456' } });
    expect(config.http.port).toBe(9999);
    expect(config.store.url).toBe(`file:${path.resolve(dir, 'data/db.sqlite')}`);
    expect(secrets).toEqual(['tok-123456']);
  });
});

describe('registry helpers', () => {
  it('merges adapter table with config overrides (config wins per name)', () => {
    const table = effectiveToolTable(
      { a: { allow: true }, b: { hidden: true }, c: { block: true } },
      { allow: ['c'], hidden: ['a'], block: ['b'] },
    );
    expect(classify(table.a, false)).toBe('hidden');
    expect(classify(table.b, false)).toBe('blocked');
    expect(classify(table.c, false)).toBe('listed');
    expect(classify(undefined, false)).toBe('not_allowed');
    expect(classify(undefined, true)).toBe('listed');
  });
});

describe('capResult', () => {
  it('truncates the largest text block and records the removed size', () => {
    const r = capResult({ content: [{ type: 'text', text: 'a'.repeat(100) }, { type: 'text', text: 'b'.repeat(1000) }] }, 500);
    const total = r.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0);
    expect(total).toBeLessThanOrEqual(500 + 150);
    expect(r.content[1]).toMatchObject({ type: 'text' });
    expect((r.content[1] as { text: string }).text).toContain('[truncated');
    expect((r._meta as Record<string, unknown>)['in.qabrain/truncated']).toBeGreaterThan(0);
  });
  it('leaves small results untouched', () => {
    const input = { content: [{ type: 'text' as const, text: 'hi' }] };
    expect(capResult(input, 10)).toBe(input);
  });
});

describe('trace context', () => {
  it('parses valid traceparents and mints new ones otherwise', () => {
    expect(parseTraceparent('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01')?.sampled).toBe(true);
    expect(parseTraceparent('garbage')).toBeNull();
    const ctx = traceContextFromMeta({ traceparent: 'garbage' });
    expect(ctx.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

describe('toJsonSchema', () => {
  it('produces compact draft-2020 schemas with additionalProperties false', () => {
    const s = toJsonSchema(z.object({ url: z.string().describe('u'), n: z.number().int().optional() }));
    expect(s.$schema).toBeUndefined();
    expect(s.additionalProperties).toBe(false);
    expect((s.properties as Record<string, Record<string, unknown>>).n?.minimum).toBeUndefined();
  });
});
