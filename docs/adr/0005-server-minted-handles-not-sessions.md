# ADR-0005: Server-minted handles instead of protocol sessions

QA Brain has no session concept of its own. Every piece of state that outlives one tool call — a run, a browser context, a device session, a snapshot, a lock — is identified by a handle `<kind>_<uuidv7>` (`rn_`, `bh_`, `dh_`, `sn_`, `lk_`) that a creation tool returns and later calls accept as an ordinary argument. Handles carry an owner, a TTL, and an upstream reference, are verified against the calling principal on every use, and are swept when expired. This makes hosted mode horizontally scalable, under one non-negotiable rule: possession of a handle is not authentication.

## Status

Accepted, 2026-08-20.

## Context

The 2026-07-28 revision removed protocol-level sessions and `Mcp-Session-Id` (SEP-2567); `tools/list` MUST NOT vary per connection, and servers needing cross-call state are told to "return explicit server-minted handles from a creation tool and accept them as ordinary tool arguments on later calls" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). The SDK's `createMcpHandler` builds a fresh server per HTTP request, so nothing can live on the server object ([HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)).

Prior art shows the cost of the opposite choice: Microsoft's mcp-gateway pins sessions to pods through a distributed store ([README](https://github.com/microsoft/mcp-gateway/blob/main/README.md)); IBM ContextForge shipped stateful sessions disabled because per-instance IDs broke horizontal scaling ([issue #2230](https://github.com/IBM/mcp-context-forge/issues/2230)); Playwright MCP's HTTP mode drops sessions whose client misses a 5 s heartbeat ([PR #41391](https://github.com/microsoft/playwright/pull/41391)). A tester must hold a browser open across dozens of calls, so the state cannot be avoided, only made explicit.

## Decision

1. **Format.** `@qa-brain/core` `handle.ts` defines `HANDLE_KINDS = {run: 'rn', browser: 'bh', device: 'dh', snapshot: 'sn', lock: 'lk'}`, `mintHandle(kind)` returning `${prefix}_${uuidv7()}`, and `parseHandle()` against `^(rn|bh|dh|sn|lk)_<uuidv7>$`. UUIDv7 (`uuidv7@1.2.1`) is time-ordered and carries 74 random bits; the same generator runs on SQLite and Postgres.
2. **Storage.** Table `handle`, identical columns on both dialects: `id` (the handle string, primary key), `project_id`, `kind`, `owner_api_key_id`, `upstream_ref` (Playwright context id or Appium `sessionId`), `platform` (`web|android|ios`), `state` JSON, `ttl_s`, `expires_at`, `last_used_at`, `revoked_at`, `created_at`; partial index on `expires_at` where `revoked_at IS NULL`; index on `owner_api_key_id`.
3. **Ownership on every use.** `handles.resolve(handle, principal)` requires a row that exists, matches the principal (`local` on stdio; the verified bearer subject on HTTP, never a client-asserted value), is unrevoked, and is unexpired. Failures return typed `isError` results (`HANDLE_EXPIRED`, `HANDLE_NOT_FOUND`) with a recovery hint. A handle in a transcript, log, or LLM context is not a credential.
4. **TTLs and sweeping.** `rn_` 24 h from `qa_run_start` (the only kind minted in M0); `bh_` and `dh_` 30 min idle; `sn_` 10 min; `lk_` per lock. A sweeper (5 min locally, 60 s hosted) revokes expired rows and releases the resource named by `upstream_ref`; use refreshes `last_used_at`.
5. **Where state lives.** Upstream `Client` connections, browser and device pools, and the store are module-scope singletons keyed by handle, never per-request server fields. Playwright MCP is one long-lived child per upstream per worker, never per HTTP request; per-run isolation comes from browser contexts addressed by `bh_` handles (M4+), with `--isolated` in M0.
6. **Legacy clients.** Under `legacy: 'stateless'`, any SDK-level session identity is ignored for application state; `ctx.sessionId` is logged only.

## Consequences

**Positive.** Any request can land on any replica behind plain round-robin, and a worker restart loses no run because `rn_` rows and `action_log` are in Postgres. Handles appear verbatim in `action_log.run_id`, trace `baggage`, and reports, giving greppable correlation across web and mobile.

**Negative.** Every stateful tool grows a handle argument the model must thread through. Expiry is a new failure class to recover from. Releasing the resource behind an expired `bh_` needs an adapter hook (`closeContext(upstream_ref)`) that M0 defines but does not exercise.

**Neutral.** UUIDv7 leaks creation time, acceptable for identifiers already logged with timestamps. Ownership is per principal, not per project, until API keys arrive ([ADR-0012](./0012-auth-api-keys-first-oauth21-resource-server-later.md)).

## Alternatives considered

- **Legacy-style sessions with sticky routing.** Works only with 2025-era clients, needs load-balancer affinity or a shared session store, and contradicts the "MUST NOT vary per connection" rule.
- **Implicit "current run" or "current browser" per connection.** Convenient on stdio, undefined under stateless HTTP, impossible to audit.
- **Random base32 tokens instead of UUIDv7.** Equally unguessable, but UUIDv7 doubles as the primary-key format and sorts by time.
- **Handles as bearer capabilities (no owner check).** Simpler, but handles traverse LLM context and logs; threat-model entry T12 requires owner verification, TTL, and revocation.
- **One child per HTTP request.** Docker's gateway once spawned a container per session and moved away from it ([issue #5](https://github.com/docker/mcp-gateway/issues/5)); browsers are too expensive and stateful to recreate per call.

## References

- SEP-2567 and handle guidance: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>, <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- SDK per-request server instances: <https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html>
- Microsoft mcp-gateway session affinity: <https://github.com/microsoft/mcp-gateway/blob/main/README.md>
- ContextForge stateful sessions disabled: <https://github.com/IBM/mcp-context-forge/issues/2230>
- Related: [ADR-0003](./0003-target-mcp-2026-07-28-dual-era.md), [ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md), [data-model.md](../data-model.md), [security-threat-model.md](../security-threat-model.md)
