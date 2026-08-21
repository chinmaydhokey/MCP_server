# ADR-0008: Artifacts on S3-compatible object storage behind an `ArtifactStore` interface

Screenshots, element crops, accessibility snapshots, Playwright `trace.zip` files, console logs, visual diffs, and YAML patches are large, immutable, and referenced from many rows. This ADR keeps them out of the relational store: an `ArtifactStore` interface with a filesystem driver for stdio mode and an S3 driver for hosted mode, SeaweedFS in Docker Compose, short-lived presigned GET URLs as the only way out of the bucket, sha256 deduplication, and a 30-day lifecycle.

## Status

Accepted — 2026-08-20

## Context

The `artifact` table ([data model](../data-model.md)) stores metadata only: `id, project_id, run_id, attempt_id, kind, bucket, key, sha256, content_type, bytes, expires_at, created_at`, with `uq(bucket, key)`, `idx(sha256)`, `idx(run_id, kind)`; `kind` ∈ `screenshot | crop | snapshot | trace | video | har | console | log | diff | yaml_patch`. Heal proposals ([ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md)) cite before/after screenshots as evidence; reports and GitHub comments need links a reviewer can open.

Playwright traces open remotely via `https://trace.playwright.dev/?trace=<url>`, which loads entirely in the browser; an S3-compatible bucket with lifecycle expiry and presigned URLs is the established pattern ([Trace Viewer](https://playwright.dev/docs/trace-viewer)). The threat model lists presigned URL leakage as T11 ([security threat model](../security-threat-model.md)).

MinIO community edition stopped publishing Docker images and binaries on 2025-10-23 and the repository was archived in 2026 ([MinIO CE status](https://medium.com/@rosgluk/minio-ce-is-effectively-dead-in-2026-heres-what-to-run-instead-2210130445c7)). The surviving Apache-2.0 options are SeaweedFS and RustFS; Garage is AGPL-3.0, which the `dependency-review` workflow denies.

## Decision

1. **Interface** in `packages/core`:

   ```ts
   interface ArtifactStore {
     put(input: { runId?: string; kind: ArtifactKind; contentType: string;
                  body: Uint8Array | ReadableStream }): Promise<ArtifactRef>; // {id, sha256, bytes}
     get(id: string): Promise<{ contentType: string; body: ReadableStream } | null>;
     url(id: string, ttlMs?: number): Promise<string | null>;   // presigned GET (s3) or file:// (fs)
     delete(id: string): Promise<void>;
   }
   ```

   Selected by `artifacts.driver: 'fs' | 's3'`; `fs` uses `artifacts.dir` (default `./.qa-brain/artifacts`), `s3` reads `QA_BRAIN_S3_ENDPOINT`, `QA_BRAIN_S3_BUCKET`, and credentials from a Compose secret, never argv.
2. **Hosted service**: SeaweedFS, image `chrislusf/seaweedfs:3` (digest pinned by Renovate), command `weed server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json -dir=/data -master.volumeSizeLimitMB=1024`, on the `data` network only. Bucket `qa-brain-artifacts` and its lifecycle rule are created by `qa-brain db migrate`. Production may point the driver at AWS S3 or Cloudflare R2; RustFS is a one-variable swap of `QA_BRAIN_S3_ENDPOINT`.
3. **Key layout**: `<project_id>/<sha256[0:2]>/<sha256>.<ext>`, content-addressed. `put()` hashes while streaming to a temp object, looks up `idx(sha256)` within the project, and on a hit discards the upload and returns the existing `ArtifactRef`. Referencing rows (`step_result.screenshot_artifact_id`, `heal_proposal.evidence`, `step_fingerprint.crop_artifact_id`) share the single row; `artifact.run_id` records the first producer.
4. **Access**: the bucket is private and never listed. `url()` returns a presigned GET valid for 15 minutes, after an `artifact.project_id` ownership check against the caller's principal. Trace links are built on demand as `https://trace.playwright.dev/?trace=<presigned-url>` and are equally short-lived. The `fs` driver returns `file://` URLs.
5. **Lifecycle**: `artifact.expires_at = created_at + 30 days`; the bucket carries a matching 30-day expiration rule as backstop, and a daily sweeper deletes expired rows and objects. Artifacts attached to `proposed`/`approved` heal proposals and to the active `step_fingerprint` crop are pinned (`expires_at = NULL`) until decided or superseded.
6. **Size limits**: Playwright MCP runs with `--output-dir /artifacts --output-max-size 524288000`; the worker moves files from that volume into the store and deletes the originals. Single artifacts above 256 MiB are rejected with a logged warning.

## Consequences

**Positive.** The relational store holds pointers, not blobs. Dedup makes repeated screenshots of an unchanged page cost one object. Presigned URLs keep the bucket off the public network while giving reviewers working trace links in PR comments. One interface serves laptops and servers, so evidence rendering is mode-agnostic.

**Negative.** Two drivers to maintain; the `fs` driver cannot offer expiring URLs, so local reports embed paths. Content addressing means deleting a run does not necessarily free its objects; the sweeper is driven by `expires_at`, not run deletion. SeaweedFS presigned-URL and lifecycle behavior must be exercised in M5 integration tests because S3 clones differ in edge cases.

**Neutral.** M0 ships the interface, the `fs` driver path, and the Compose service; the router's result-size cap emits a "stored as artifact" marker only from M2, when `put()` is first called. The S3 driver will use the AWS SDK v3 client and request presigner, pinned when the code lands.

## Alternatives considered

- **Blobs in Postgres (`bytea`) or SQLite**: simplest, but traces are tens of MB and the Trace Viewer needs a URL.
- **MinIO**: no longer maintained as a community image.
- **RustFS**: Apache-2.0 and the closest MinIO drop-in, but younger than SeaweedFS; kept as a documented swap.
- **Garage**: AGPL-3.0, excluded by the license policy.
- **Long-lived or unsigned URLs**: rejected under T11; a leaked link must expire in minutes.
- **Per-run key prefixes without dedup**: easier deletion, but multiplies storage for the consecutive-pass heal verification, which captures the same crops repeatedly.

## References

- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [MinIO CE discontinuation](https://medium.com/@rosgluk/minio-ce-is-effectively-dead-in-2026-heres-what-to-run-instead-2210130445c7)
- [Data model](../data-model.md), [deployment](../deployment.md), [security threat model](../security-threat-model.md)
- [ADR-0006](./0006-store-sqlite-local-postgres-hosted-drizzle.md), [ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md), [ADR-0011](./0011-security-posture-default-deny-no-passthrough-egress-control.md)
