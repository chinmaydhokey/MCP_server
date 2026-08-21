/**
 * `${VAR}` and `${VAR:-default}` expansion over every string leaf of a JSON value.
 *
 * - An unset variable without a default is an error (fail fast; never start with a half-configured secret).
 * - Every expanded value is reported so the caller can register it with the redactor.
 */

export class MissingEnvError extends Error {
  constructor(
    readonly variable: string,
    readonly at: string,
  ) {
    super(
      `Environment variable ${variable} is not set (referenced at ${at}); use \${${variable}:-default} to allow a default`,
    );
    this.name = 'MissingEnvError';
  }
}

// Quantifiers are bounded: an unbounded name/default makes this polynomial on adversarial input
// (CodeQL js/polynomial-redos). A 64-character variable name and a 1 KiB default cover every real config.
const PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})(?::-([^}]{0,1024}))?\}/g;

export interface ExpandResult<T> {
  value: T;
  /** Values substituted from the environment (candidates for redaction). */
  expanded: string[];
}

export function expandEnvInString(
  input: string,
  env: NodeJS.ProcessEnv,
  at: string,
  expanded: string[],
): string {
  return input.replace(PATTERN, (_m, name: string, def: string | undefined) => {
    const v = env[name];
    if (v !== undefined && v !== '') {
      expanded.push(v);
      return v;
    }
    if (def !== undefined) return def;
    throw new MissingEnvError(name, at);
  });
}

export function expandEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): ExpandResult<T> {
  const expanded: string[] = [];
  const walk = (v: unknown, at: string): unknown => {
    if (typeof v === 'string') return expandEnvInString(v, env, at, expanded);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}[${i}]`));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        out[k] = walk(x, at ? `${at}.${k}` : k);
      return out;
    }
    return v;
  };
  return { value: walk(value, '') as T, expanded };
}
