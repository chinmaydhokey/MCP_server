/**
 * Secret redaction and argument-shape extraction.
 *
 * Redaction runs BEFORE anything is persisted to the action log or written to stderr
 * (Docker MCP Gateway v0.43.1 lesson: log argument *shape*, never raw values, and block secrets first).
 */

export const REDACTED = '[REDACTED]';

/** Keys whose values are always redacted, regardless of content. */
export const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|api[-_]?key|authorization|auth|cookie|session[-_]?id|credential|private[-_]?key|bearer)/i;

/** Value patterns that are redacted wherever they appear (inside strings too). */
export const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style API keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // Authorization: Bearer …
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export interface Redactor {
  /** Redacts secrets inside a free-text string. */
  text(input: string): string;
  /** Deep-clones `value`, redacting sensitive keys and sensitive values. */
  value<T>(value: T): T;
  /** Adds a literal secret (e.g. an expanded `${ENV}` value) to the redaction set. */
  addSecret(secret: string): void;
  /** Number of literal secrets registered. */
  readonly secretCount: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a redactor. `literalSecrets` are exact strings that must never leak (env-expanded config values,
 * bearer tokens). Short literals (< 6 chars) are ignored to avoid redacting common words.
 */
export function createRedactor(literalSecrets: readonly string[] = []): Redactor {
  const literals = new Set<string>();
  let literalPattern: RegExp | null = null;

  const rebuild = () => {
    literalPattern =
      literals.size === 0
        ? null
        : new RegExp(
            [...literals]
              .sort((a, b) => b.length - a.length)
              .map(escapeRegExp)
              .join('|'),
            'g',
          );
  };

  const addSecret = (secret: string) => {
    if (typeof secret !== 'string' || secret.length < 6) return;
    if (!literals.has(secret)) {
      literals.add(secret);
      rebuild();
    }
  };
  for (const s of literalSecrets) addSecret(s);

  const text = (input: string): string => {
    if (typeof input !== 'string' || input.length === 0) return input;
    let out = input;
    if (literalPattern) out = out.replace(literalPattern, REDACTED);
    for (const p of SENSITIVE_VALUE_PATTERNS) out = out.replace(p, REDACTED);
    return out;
  };

  const value = <T>(input: T, depth = 0): T => {
    if (depth > 32) return '[MAX_DEPTH]' as unknown as T;
    if (typeof input === 'string') return text(input) as unknown as T;
    if (Array.isArray(input)) return input.map((v) => value(v, depth + 1)) as unknown as T;
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACTED : value(v, depth + 1);
      }
      return out as T;
    }
    return input;
  };

  return {
    text,
    value: (v) => value(v),
    addSecret,
    get secretCount() {
      return literals.size;
    },
  };
}

/**
 * Returns a JSON "shape" of a value: objects keep keys with type names as values,
 * arrays become a one-element array of the first item's shape, scalars become their `typeof`.
 * Never includes user data — safe to persist and log.
 */
export function argsShape(value: unknown, depth = 0): unknown {
  if (depth > 8) return 'object';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? [] : [argsShape(value[0], depth + 1)];
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = argsShape(v, depth + 1);
    return out;
  }
  return typeof value;
}
