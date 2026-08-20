import { describe, expect, it } from 'vitest';
import { REDACTED, argsShape, createRedactor } from '../src/redact.js';

describe('redaction', () => {
  it('redacts sensitive keys regardless of value', () => {
    const r = createRedactor();
    expect(r.value({ password: 'hunter2', url: 'https://x', nested: { apiKey: 'k', ok: 1 } })).toEqual({
      password: REDACTED,
      url: 'https://x',
      nested: { apiKey: REDACTED, ok: 1 },
    });
  });
  it('redacts known token formats inside free text', () => {
    const r = createRedactor();
    const s = r.text('token github_pat_11AAAAAAA0abcdefghijklmnopqrstuvwxyz and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 end');
    expect(s).not.toContain('github_pat_');
    expect(s).not.toContain('ghp_');
    expect(s.split(REDACTED).length - 1).toBe(2);
  });
  it('redacts registered literal secrets and ignores short ones', () => {
    const r = createRedactor(['s3cr3t-value', 'ab']);
    expect(r.secretCount).toBe(1);
    expect(r.text('x s3cr3t-value y ab')).toBe(`x ${REDACTED} y ab`);
    r.addSecret('another-secret');
    expect(r.text('another-secret')).toBe(REDACTED);
  });
  it('produces data-free argument shapes', () => {
    expect(argsShape({ url: 'https://a', n: 1, list: [{ ref: 'e1' }], flag: true, nil: null })).toEqual({
      url: 'string',
      n: 'number',
      list: [{ ref: 'string' }],
      flag: 'boolean',
      nil: 'null',
    });
  });
});
