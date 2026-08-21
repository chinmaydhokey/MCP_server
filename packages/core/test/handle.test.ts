import { describe, expect, it } from 'vitest';
import { isHandleOfKind, mintHandle, parseHandle } from '../src/handle.js';

describe('handles', () => {
  it('mints prefixed uuidv7 handles that parse back', () => {
    const h = mintHandle('run');
    expect(h.startsWith('rn_')).toBe(true);
    expect(parseHandle(h)?.kind).toBe('run');
    expect(isHandleOfKind(h, 'browser')).toBe(false);
  });
  it('rejects malformed handles', () => {
    expect(parseHandle('rn_not-a-uuid')).toBeNull();
    expect(parseHandle('zz_0198b2c4-0000-7000-8000-000000000000')).toBeNull();
  });
  it('orders by time (uuidv7)', () => {
    const a = mintHandle('run');
    const b = mintHandle('run');
    expect(a < b).toBe(true);
  });
});
