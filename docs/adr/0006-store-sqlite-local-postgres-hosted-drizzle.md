# ADR-0006: Store — SQLite (libsql) locally, Postgres 18 hosted, one Drizzle schema per dialect

QA Brain persists tests, runs, fingerprints, and the per-call `action_log` in a relational store that must be a zero-install embedded database in stdio mode and a shared server database in hosted mode. This ADR fixes the ORM, the two dialects, the SQLite driver, the id strategy, the revision model, and the migration workflow, so every later milestone writes to the same 17 tables regardless of mode.

## Status

Accepted, 2026-08-20.

## Context

The gateway has two modes ([ARCHITECTURE.md](../../ARCHITECTURE.md)): `qa-brain serve --transport stdio` on a laptop or CI runner, where nothing beyond Node ≥ 22.12 may be required, and `--transport http` in Docker Compose ([deployment](../deployment.md)), where `postgres:18` already exists for pg-boss ([ADR-0007](./0007-job-queue-pg-boss-on-postgres.md)). The [data model](../data-model.md) needs JSON columns, partial unique indexes, enums, and append-only history.

`better-sqlite3@13.0.3` ships no prebuilt binary for Node 24 on Windows, so `pnpm install` on the primary development machine fell back to `node-gyp` and failed without Visual Studio build tools. `@libsql/client@0.17.4` ships prebuilt N-API binaries for Windows, macOS, and Linux, is supported by `drizzle-orm/libsql`, and accepts `file:` URLs.

PostgreSQL 18 provides a native RFC 9562 `uuidv7()` ([release notes](https://www.postgresql.org/about/news/postgresql-18-released-3142/)); SQLite does not. System-versioned tables are unavailable on most managed Postgres providers, so versioning is done in the application with an append-only revisions table ([pattern](https://hypirion.com/musings/implementing-system-versioned-tables-in-postgres)).

## Decision

1. **ORM**: `drizzle-orm@0.45.2` with `drizzle-kit@0.31.10`. Two schema trees under `packages/store/src/schema/{sqlite,pg}/` share `enums.ts` and `columns.ts`. `StoreAdapter.driver` is `'sqlite' | 'pg'`, selected by `store.driver` / `store.url` in the config (default `file:./.qa-brain/qa-brain.db`).
2. **SQLite driver**: `@libsql/client@0.17.4` via `drizzle-orm/libsql`. `better-sqlite3` is not a dependency anywhere in the workspace.
3. **Postgres driver**: `pg@8.23.0` via `drizzle-orm/node-postgres`.
4. **Ids**: every primary key is a UUIDv7 generated in the application with `uuidv7@1.2.1`, stored as `uuid` on Postgres and `text` on SQLite. `DEFAULT uuidv7()` on Postgres is only a safety net; the app always supplies the id, so both dialects behave identically. Handles are `<kind>_<uuidv7>` (ADR-0005).
5. **Type mapping**: PG `jsonb` / `timestamptz` / `pgEnum` / `bigint`; SQLite `text` with `{ mode: 'json' }` / integer epoch-ms / `text` plus CHECK / `integer`. Arrays are JSON on both. Partial indexes use Drizzle `.where()` on both.
6. **17 tables**, identical names and columns in both dialects: `project`, `api_key`, `handle`, `test_case`, `test_case_revision`, `test_step`, `step_fingerprint`, `run`, `run_attempt`, `step_result`, `artifact`, `action_log`, `heal_proposal`, `flaky_stat`, `quarantine`, `coverage_map`, `task`. All 17 ship in M0 even though only `action_log`, `run`, and `handle` are written by M0 code.
7. **Append-only `test_case_revision`**: rows carry `content_hash` (sha256 of canonical YAML with modules inlined), `parent_revision_id`, `module_hashes`, `git_sha`; `uq(test_case_id, content_hash)`; rows are never updated or deleted; `test_case.current_revision_id` is the only moving pointer. `quarantine` is append-only for the same reason.
8. **Conformance test**: a vitest unit test asserts identical table names, column names, enum members, and index column sets across both trees, so a column added to one dialect fails CI until the other follows.
9. **Migrations**: `drizzle.config.sqlite.ts` and `drizzle.config.pg.ts`; `drizzle-kit generate` writes `migrations/sqlite` and `migrations/pg`, committed to git. stdio mode runs `migrate()` at startup; hosted mode runs `qa-brain db migrate` as a one-shot Compose service that `qa-brain` and `worker` depend on with `condition: service_completed_successfully`.

## Consequences

**Positive.** `pnpm install` needs no compiler on any supported OS. Scoring, TIA, and flake logic run in TypeScript over loaded rows, so no dialect-specific SQL leaks into algorithm code. Time-ordered ids give index-friendly inserts. Revisions are reproducible by `content_hash`, which also bounds the step cache ([test-format](../test-format.md)).

**Negative.** Two schema trees are maintained by hand; the conformance test catches name drift but not semantic mismatches such as a CHECK present on one dialect only. JSON path queries exist only on PG; SQLite paths filter in TS. Monthly partitioning of `action_log` is PG-only and deferred to M5.

**Neutral.** `@libsql/client` can also reach remote libsql servers; QA Brain uses only local `file:` URLs. Switching `store.driver` is a config change, not a data migration; no SQLite-to-Postgres copy tool exists in M0.

## Alternatives considered

- **`better-sqlite3@13.0.3`**: rejected for the missing Node 24 Windows prebuild and the Visual Studio requirement.
- **Postgres only, via PGlite for stdio mode**: adds a multi-megabyte WASM runtime to a CLI that must start in under a second.
- **SQLite only, including hosted**: no concurrent writers across `qa-brain` and `worker` containers; pg-boss needs Postgres anyway.
- **Prisma or Kysely**: Prisma's engine binaries reintroduce the native-build problem; Kysely lacks a migration generator.
- **Database-generated ids**: SQLite cannot produce UUIDv7, and app generation makes ids available before the insert (needed for handles and `task.id == run.id`).

## References

- [PostgreSQL 18 release](https://www.postgresql.org/about/news/postgresql-18-released-3142/) — native `uuidv7()`
- [System-versioned tables in Postgres](https://hypirion.com/musings/implementing-system-versioned-tables-in-postgres) — append-only revision pattern
- [Data model](../data-model.md), [test format](../test-format.md), [deployment](../deployment.md)
- ADR-0005 (handles); [ADR-0007](./0007-job-queue-pg-boss-on-postgres.md), [ADR-0008](./0008-artifacts-on-s3-compatible-storage.md)
