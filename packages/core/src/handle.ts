import { uuidv7 } from 'uuidv7';

/**
 * Server-minted handles replace protocol sessions (MCP 2026-07-28 removed `Mcp-Session-Id`).
 * Every piece of cross-call state — a run, a browser context, a device session, a snapshot —
 * is addressed by an explicit handle passed as an ordinary tool argument.
 *
 * Possession of a handle is NOT authentication: the store verifies the owner on every use.
 */

export const HANDLE_KINDS = {
  run: 'rn',
  browser: 'bh',
  device: 'dh',
  snapshot: 'sn',
  lock: 'lk',
} as const;

export type HandleKind = keyof typeof HANDLE_KINDS;
export type HandlePrefix = (typeof HANDLE_KINDS)[HandleKind];

const PREFIX_TO_KIND: Record<string, HandleKind> = Object.fromEntries(
  Object.entries(HANDLE_KINDS).map(([k, v]) => [v, k as HandleKind]),
);

const HANDLE_REGEX =
  /^(rn|bh|dh|sn|lk)_([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** Mints a new handle such as `rn_0198b2c4-…`. */
export function mintHandle(kind: HandleKind): string {
  return `${HANDLE_KINDS[kind]}_${uuidv7()}`;
}

/** Parses a handle; returns `null` when malformed. */
export function parseHandle(handle: string): { kind: HandleKind; id: string } | null {
  const m = HANDLE_REGEX.exec(handle);
  if (!m) return null;
  const kind = PREFIX_TO_KIND[m[1] as string];
  if (!kind) return null;
  return { kind, id: m[2] as string };
}

export function isHandleOfKind(handle: string, kind: HandleKind): boolean {
  return parseHandle(handle)?.kind === kind;
}

/** Generates a plain uuidv7 for primary keys (time-ordered; identical behaviour on SQLite and Postgres). */
export function newId(): string {
  return uuidv7();
}
