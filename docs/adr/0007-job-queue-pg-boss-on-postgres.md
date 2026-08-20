# ADR-0007: Job queue on Postgres with pg-boss 12; no Redis in the stack

Hosted QA Brain must run work that outlives a single MCP request: a suite run fanned out over browser workers, a batch of heal verifications, a batch of visual comparisons. This ADR selects pg-boss 12 on the existing Postgres 18 database as the only queue, rejects Redis-backed and workflow-engine alternatives, names the job kinds and their mapping to the MCP Tasks extension, and specifies the in-process executor used in stdio/SQLite mode.

## Status

Accepted, 2026-08-20.

## Context

In hosted mode ([deployment](../deployment.md)) the Compose stack has a `qa-brain` HTTP service, a `worker` running the same image, `postgres:18`, SeaweedFS, an egress proxy, and an OTel collector. Under MCP 2026-07-28 the server is stateless; a long tool call uses the Tasks extension `io.modelcontextprotocol/tasks`: `qa_run_suite` returns `CreateTaskResult {resultType:'task', taskId, status:'working', ttlMs, pollIntervalMs}` and the client polls `tasks/get` ([Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview.md)). Task ids must survive disconnects, so work must be durable and decoupled from the creating request.

The `task` table ([data model](../data-model.md)) has `kind` ∈ `run_suite | heal_batch | visual_batch | tia_select` and `task.id == run.id` for suite runs. Candidates surveyed in August 2026: pg-boss 12.27.0 (Node ≥ 22.12, Postgres ≥ 13, SKIP LOCKED + LISTEN/NOTIFY, transactional enqueue with Drizzle, retries with backoff, dead-letter with redrive, singleton keys, `@pg-boss/dashboard`) ([pg-boss](https://github.com/timgit/pg-boss)); BullMQ 6.0.0 (2026-07-30) with a new PostgreSQL backend at ~1.5–2× lower throughput than Redis ([BullMQ Postgres guide](https://docs.bullmq.io/guide/postgresql)); graphile-worker 0.17.3, pre-1.0; Temporal, whose `docker-compose` repo was archived on 2026-01-05 and which needs its own server, UI, and schema ([temporalio/docker-compose](https://github.com/temporalio/docker-compose)). For a 3–4 person team each extra stateful service is a maintenance tax.

## Decision

1. **Queue**: `pg-boss` pinned to major 12, on the same `QA_BRAIN_DATABASE_URL` as the Drizzle store ([ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md)), in its own `pgboss` schema. Its migrations run inside `qa-brain db migrate`, the one-shot Compose service preceding `qa-brain` and `worker`. pg-boss ≥ 11 does not auto-migrate across majors, hence the pin.
2. **No Redis**: not as cache, rate-limit store, or queue backend; Postgres fills that slot.
3. **Job kinds**, one pg-boss queue each: `run_suite` (`{run_id, project_id}`; `singletonKey = run_id`, so duplicate enqueues collapse to one job), `heal_batch` (`{proposal_ids[]}`, the consecutive-pass verification from [ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md)), `visual_batch` (`{run_id, checkpoint_ids[]}`), `tia_select` (`{project_id, base_sha, head_sha}`, [ADR-0010](./0010-test-impact-analysis-layered-union.md)). For non-run kinds the job id is written to `task.id`.
4. **Transactional enqueue**: `run` row, `task` row, and pg-boss job are inserted in one Drizzle transaction, so a crash cannot leave a run without a job or a job without a run.
5. **Retry and expiry**: `retryLimit 2`, `retryBackoff true`, `expireInSeconds 3600` for `run_suite`; `retryLimit 3`, `expireInSeconds 600` for batch kinds. Exhausted jobs go to the dead-letter queue and `task.status` becomes `failed`. Values are a design decision, tuned in M7.
6. **Worker**: `qa-brain worker --config …` is a pg-boss consumer with `teamSize` = browser slots (default 2 per container). It maps job lifecycle to `task.status` (`working → completed | failed | cancelled`) and writes `progress {done, total, message}` after each finished `run_attempt`. `tasks/cancel` sets a flag read between attempts and calls `cancelRun(run_id)`, which also revokes handles.
7. **SQLite/stdio mode**: no queue. An `InProcessExecutor` implements the same `JobExecutor` interface (`enqueue`, `cancel`, `onProgress`) with an in-memory FIFO, concurrency 1. `qa_run_suite` returns a Task only if the client declares the extension; otherwise it executes inline and emits `notifications/progress`.
8. **Observability**: `qa_brain.queue.depth` and `qa_brain.queue.job.duration` metrics ([observability](../observability.md)); `run_id` travels in OTel `baggage` from enqueue to worker spans.

## Consequences

**Positive.** One stateful service backs store, queue, and task state; backup is a single `pg_dump`. Transactional enqueue removes a class of orphaned-run bugs. `@pg-boss/dashboard` gives a queue view for free. Durability matches the Tasks requirement that ids survive disconnects.

**Negative.** Throughput is bounded by Postgres polling and `SKIP LOCKED`; irrelevant at tens of suite runs per hour, but it rules out per-step fan-out through the queue. Table growth needs pg-boss's archive/delete maintenance enabled (`archiveCompletedAfterSeconds`, `deleteAfterDays`).

**Neutral.** Worker, executor interface, and job kinds are M5 code; M0 ships the Compose service definition and this ADR only.

## Alternatives considered

- **BullMQ v6 with `createPostgresBackend`**: larger ecosystem, but the Postgres backend was three weeks old at decision time and documented as 1.5–2× slower; pg-boss has been Postgres-native for years.
- **BullMQ on Redis**: proven, but a second stateful service with its own persistence and backup path.
- **Temporal**: durable multi-day workflows and a UI, but its own server, schema, and SDK; disproportionate for this team.
- **graphile-worker**: SQL-side enqueue, but pre-1.0 without dead-letter redrive or a dashboard.
- **No queue, run inside the HTTP request**: incompatible with the stateless 2026-07-28 transport, where a closed stream is a cancellation.

## References

- [pg-boss](https://github.com/timgit/pg-boss)
- [BullMQ PostgreSQL backend](https://docs.bullmq.io/guide/postgresql)
- [Temporal docker-compose (archived)](https://github.com/temporalio/docker-compose)
- [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview.md)
- [Deployment](../deployment.md), [data model](../data-model.md), [observability](../observability.md)
- [ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md), [ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md), [ADR-0010](./0010-test-impact-analysis-layered-union.md)
