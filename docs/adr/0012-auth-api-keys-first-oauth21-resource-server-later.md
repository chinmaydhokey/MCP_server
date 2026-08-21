# ADR-0012: Authentication — hashed API keys first, OAuth 2.1 resource server with an external IdP later

Hosted QA Brain (Streamable HTTP, one self-hosted team) ships in M5 with bearer API keys stored as argon2id hashes in `api_key`. The MCP 2026-07-28 model — an OAuth 2.1 resource server with RFC 9728 metadata, RFC 8707 audience validation and Client ID Metadata Documents instead of DCR — arrives in M7 with Keycloak as issuer and the client-credentials extension (`private_key_jwt`) for CI. Stdio mode has no protocol-level auth and reads credentials from the environment, as the spec prescribes.

## Status

Accepted — 2026-08-20

## Context

- Spec authorization applies to HTTP only; stdio servers "SHOULD NOT" use it. Servers MUST publish Protected Resource Metadata (RFC 9728) via `WWW-Authenticate resource_metadata`; clients MUST send RFC 8707 `resource=` equal to the canonical server URI; servers MUST validate audience; token passthrough is forbidden. Registration priority: CIMD > pre-registration > DCR (deprecated) ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)).
- Machine-to-machine auth is the extension `io.modelcontextprotocol/oauth-client-credentials`, recommending RFC 7523 `private_key_jwt`; the TS SDK ships `ClientCredentialsProvider` and `PrivateKeyJwtProvider` ([ext-auth](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)).
- TS SDK v2 offers `requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl })` (401/403 with `WWW-Authenticate`) and `mcpAuthMetadataRouter` for the RFC 9728/8414 documents; it recommends an external IdP and froze v1 authorization-server helpers in `@modelcontextprotocol/server-legacy/auth` ([SDK docs](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html)). `authInfo` reaches handlers as `ctx.http.authInfo` (verified in M0 spikes).
- Claude Desktop attaches to remote servers only via Settings → Connectors, which runs OAuth in-app ([remote servers](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)); Claude Code, Codex and Cursor accept a static bearer header ([client setup](../client-setup.md)).

## Decision

**Phase 1 (M5) — API keys.**

- `qa-brain apikey create --project <slug>` prints `qab_<keyid>_<secret>` once and stores `api_key{id, project_id, name, prefix, key_hash, scopes, created_by, last_used_at, expires_at, revoked_at}`. `prefix` (first 8 chars, unique index) gives O(1) lookup before the hash check; `key_hash` is a PHC-formatted argon2id string (`m=65536,t=3,p=4`). Should the native `argon2` build prove as fragile as `better-sqlite3` did on Node 24/Windows, the PHC prefix lets `crypto.scrypt` (N=2^15, r=8, p=1) be verified side by side — a design decision.
- The HTTP handler is wrapped in `requireBearerAuth` with a verifier: prefix → row → argon2 verify → `AuthInfo{token, clientId: api_key.id, scopes, expiresAt}`. Handle ownership (`handle.owner`, which stores the `api_key.id`) is checked per call; a handle is never authentication.
- Defaults as in Docker MCP Gateway v0.43.1 ([release](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1)): bearer required; `--allow-unauthenticated` honored only on a loopback `http.host`; `/healthz` and `/readyz` public. M0 already ships this shape as a constant-time compare against `QA_BRAIN_TOKEN`.

**Phase 2 (M7) — OAuth 2.1 resource server.**

- `mcpAuthMetadataRouter` serves `/.well-known/oauth-protected-resource` with `resource = https://<host>/mcp` (no trailing slash) and `authorization_servers = [<Keycloak realm issuer>]`. The verifier checks JWKS signature, `iss`, `aud`/`resource` (RFC 8707) and `exp`, and maps realm roles to scopes `qa:read`, `qa:run`, `qa:admin`.
- Keycloak joins `docker-compose.prod.yml` under profile `oauth` (digest pinned by Renovate): CIMD-style HTTPS `client_id` URLs for human clients (Claude Desktop, claude.ai), `private_key_jwt` service accounts for CI. DCR stays disabled.
- CI authenticates with `PrivateKeyJwtProvider`; the reusable GitHub Action accepts `api-key` or `oauth-client-id` + `oauth-private-key`. API keys remain valid; both verifiers sit behind one `requireBearerAuth`, distinguished by token shape (`qab_` prefix vs JWT).

**Stdio (all milestones).** No bearer, no OAuth. `ANTHROPIC_API_KEY`, GitHub App keys and Playwright `--secrets` come from the environment; the inbound client is the local user.

## Consequences

**Positive.** Self-hosting in M5 needs nothing beyond Postgres; rotation and revocation are row updates; project scoping falls out of `api_key.project_id`. Phase 2 reuses the same `AuthInfo` plumbing, so tools never learn which scheme authenticated the caller; Claude Desktop and claude.ai connectors then work.

**Negative.** Until M7 Claude Desktop reaches QA Brain over stdio only. Keycloak adds a JVM service and a realm to administer; the roadmap cut line drops OAuth first. Argon2id is deliberately slow (to be measured in M5); a 60 s in-memory positive cache keyed by `prefix` bounds the cost.

**Neutral.** Rate limiting (T10) keys on `AuthInfo.clientId` in both phases; `action_log.principal` stores `api_key.id` or the JWT `sub`.

## Alternatives considered

- **OAuth from M5.** Rejected: gates the first hosted demo on an IdP the team does not yet run; no CLI client requires it.
- **QA Brain as its own authorization server.** Rejected: v1 helpers are frozen in `server-legacy`; v2 guidance is to delegate.
- **Dynamic Client Registration.** Rejected: deprecated in 2026-07-28; CIMD covers browser OAuth.
- **Clear-text random tokens.** Rejected: a database dump would yield working credentials.

## References

- [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) · [Client-credentials extension](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials) · [TS SDK v2 authorization](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html) · [Docker MCP Gateway v0.43.1](https://github.com/docker/mcp-gateway/releases/tag/v0.43.1) · [Claude Desktop remote servers](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)
- [Threat model](../security-threat-model.md) · [Client setup](../client-setup.md) · [Data model](../data-model.md) · [Roadmap](../roadmap.md) · [ADR-0011](./0011-security-posture-default-deny-no-passthrough-egress-control.md)
