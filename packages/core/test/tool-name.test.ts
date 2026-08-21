import { describe, expect, it } from 'vitest';
import {
  assertValidToolName,
  isValidToolName,
  toPublicToolName,
  toUpstreamToolName,
} from '../src/tool-name.js';

describe('tool names', () => {
  const web = { prefix: 'web_', strip: 'browser_' };
  it('maps upstream names to public names and back', () => {
    expect(toPublicToolName('browser_click', web)).toBe('web_click');
    expect(toPublicToolName('snapshot', web)).toBe('web_snapshot');
    expect(toUpstreamToolName('web_click', web)).toBe('browser_click');
    expect(toUpstreamToolName('qa_health', web)).toBeNull();
  });
  it('enforces the Claude API regex and the 40-char cap', () => {
    expect(() => assertValidToolName('web_click')).not.toThrow();
    expect(() => assertValidToolName('web.click')).toThrow(/must match/);
    expect(() => assertValidToolName('a'.repeat(41))).toThrow(/caps public names/);
    expect(isValidToolName('mobile_tap')).toBe(true);
    expect(isValidToolName('')).toBe(false);
  });
});
