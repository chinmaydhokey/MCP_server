import { describe, expect, it } from 'vitest';
import { argsShape, createRedactor, REDACTED } from '../src/redact.js';

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
    const s = r.text(
      'token github_pat_11AAAAAAA0abcdefghijklmnopqrstuvwxyz and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 end',
    );
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

describe('PEM redaction (linear scan, not a regex)', () => {
  const KEY = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA1234',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');

  it('redacts a complete key block and keeps the surrounding text', () => {
    const r = createRedactor();
    const out = r.text(`before ${KEY} after`);
    expect(out).toBe(`before ${REDACTED} after`);
    expect(out).not.toContain('MIIEowIBAAKCAQEA');
  });

  it('redacts every block in one string', () => {
    const r = createRedactor();
    const out = r.text(`${KEY}\nmiddle\n${KEY}`);
    expect(out.split(REDACTED).length - 1).toBe(2);
    expect(out).toContain('middle');
    expect(out).not.toContain('MIIEowIBAAKCAQEA');
  });

  it('redacts to the end when the footer is missing (a truncated key is still a leaked key)', () => {
    const r = createRedactor();
    expect(r.text('-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234')).toBe(REDACTED);
  });

  it('leaves lookalike text alone', () => {
    const r = createRedactor();
    for (const s of ['-----BEGIN CERTIFICATE-----\nabc', 'just -----BEGIN  text', 'PRIVATE KEY----- alone']) {
      expect(r.text(s)).toBe(s);
    }
  });

  it('cannot be stalled by adversarial input (the ReDoS case CodeQL flagged)', () => {
    const r = createRedactor();
    // The old regex backtracked on long runs of the header alphabet; this must stay linear.
    const hostile = `-----BEGIN ${'A '.repeat(50_000)}PRIVATE KEY-----`;
    const started = Date.now();
    r.text(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
