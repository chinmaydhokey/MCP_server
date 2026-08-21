# syntax=docker/dockerfile:1.9
#
# QA Brain gateway image -- `ghcr.io/chinmaydhokey/qa-brain`.
#
# Runs the same binary in three shapes (docs/deployment.md section 1):
#   hosted:  qa-brain serve --transport http --host 0.0.0.0 --port 8080   (the default CMD)
#   worker:  qa-brain worker                                              (M5, same image)
#   oneshot: qa-brain db migrate                                          (M5, same image)
#
# M0 STATUS: hosted mode is NOT wired to code yet. `serve --transport http` exists and is
# unit-tested in-process, but `worker` and `db migrate` arrive in milestone M5 (Feb 2027).
# This Dockerfile is a design artefact that must nevertheless build: docs/ci-cd.md section 2
# builds it on every pull request (`docker-build` job, `file: docker/qa-brain.Dockerfile`,
# `context: .`, push disabled).
#
# Build from the REPOSITORY ROOT:
#   docker build -f docker/qa-brain.Dockerfile -t qa-brain:dev .

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.34.5

# ---------------------------------------------------------------------------------------
# base -- toolchain only, shared by the build and runtime stages so both agree on Node.
# node:22 because package.json declares "engines": { "node": ">=22.12" } and .npmrc sets
# engine-strict=true: a 20.x base would fail `pnpm install`, not at runtime.
# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
# The `playwright` npm package is a production dependency of @qa-brain/adapter-playwright and
# its postinstall downloads ~350 MB of browsers. pnpm 10 already blocks that script (the root
# package.json pins onlyBuiltDependencies to biome + esbuild), but say it out loud: the
# GATEWAY image never drives a browser itself. In hosted mode it talks to the playwright-mcp
# sidecar over Streamable HTTP; browsers exist only in docker/browser.Dockerfile.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# corepack ships with Node 22 and pins pnpm from "packageManager" -- no global npm install,
# no version drift between the laptop, CI and this image.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------------------
# build -- install the whole workspace, compile, then prune back to production deps.
# ---------------------------------------------------------------------------------------
FROM base AS build

# Manifests first, sources second: this layer is only invalidated when a dependency changes,
# so editing TypeScript does not re-download the dependency graph. Every workspace project
# that appears in pnpm-lock.yaml's `importers:` block must be copied here, or
# --frozen-lockfile refuses to install. (examples/* is deliberately absent:
# @qa-brain/example-static-site has no dependencies and therefore no lockfile importer. If it
# ever gains one, add its manifest to this list.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/qa-brain/package.json                 apps/qa-brain/
COPY packages/core/package.json                 packages/core/
COPY packages/store/package.json                packages/store/
COPY packages/adapter-playwright/package.json   packages/adapter-playwright/
COPY packages/gateway/package.json              packages/gateway/
COPY packages/healing/package.json              packages/healing/
COPY packages/test-format/package.json          packages/test-format/

# --mount=type=cache keeps pnpm's content-addressable store between builds without ever
# baking it into a layer. --frozen-lockfile is the supply-chain control from
# docs/security-threat-model.md section 11: the build installs exactly what git records.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json ./
COPY packages packages
COPY apps apps

# `pnpm -r --if-present run build` -> tsup per package (ESM, target node22).
RUN pnpm build

# Prune to production. Re-running install with --prod drops devDependencies (tsup, typescript,
# vitest, biome) from every workspace project while leaving the freshly built dist/ trees in
# place. --ignore-scripts because nothing left needs a build step and lifecycle scripts are an
# install-time code-execution surface.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# Fail the build here rather than at `docker run` if the entrypoint, or the migrations that
# `qa-brain db migrate` applies (docs/deployment.md section 7), did not survive the prune.
RUN test -f /app/apps/qa-brain/dist/cli.js \
 && test -d /app/packages/store/migrations \
 && node /app/apps/qa-brain/dist/cli.js --version

# ---------------------------------------------------------------------------------------
# runtime -- no compiler, no package manager, no shell tooling beyond the base image.
# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="qa-brain" \
      org.opencontainers.image.description="QA Brain MCP gateway (Streamable HTTP)" \
      org.opencontainers.image.source="https://github.com/chinmaydhokey/MCP_server" \
      org.opencontainers.image.documentation="https://github.com/chinmaydhokey/MCP_server/blob/main/docs/deployment.md" \
      org.opencontainers.image.licenses="Apache-2.0"

# QA_BRAIN_HOME keeps all mutable state under one directory (docs/deployment.md section 2.1).
# In hosted mode the store is Postgres and artefacts are S3, so /data holds only
# era-cache.json; compose mounts it as tmpfs because the filesystem is read_only.
ENV NODE_ENV=production \
    QA_BRAIN_HOME=/data \
    QA_BRAIN_CONFIG=/config/qa-brain.yaml \
    QA_BRAIN_LOG_LEVEL=info \
    QA_BRAIN_OTEL_EXPORTER=none \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# One COPY of the pruned tree. pnpm's node_modules is a symlink farm into
# /app/node_modules/.pnpm, so the tree must land at the same absolute path it was built at.
COPY --from=build --chown=node:node /app /app

# `qa-brain` on PATH so `docker compose exec` and healthcheck `test:` commands -- which bypass
# ENTRYPOINT -- can call subcommands directly, e.g. `qa-brain worker --healthcheck`.
RUN chmod 0755 /app/apps/qa-brain/dist/cli.js \
 && ln -s /app/apps/qa-brain/dist/cli.js /usr/local/bin/qa-brain \
 && mkdir -p /data /config \
 && chown node:node /data /config

# The `node` user (uid 1000) ships with the official image. Never root: together with
# cap_drop: [ALL] and no-new-privileges this is the container boundary
# (docs/security-threat-model.md section 6).
USER node

EXPOSE 8080

# node's built-in fetch rather than the `wget -qO- ...` shown in docs/deployment.md section 5:
# node:22-bookworm-slim ships neither curl nor wget, and adding a package to the runtime image
# just to probe a port is a worse trade than using the interpreter that is already PID 1.
# /healthz is unauthenticated by design (threat model T7). /readyz is deliberately NOT probed:
# it reports upstream health too, and a degraded Playwright sidecar must not make Docker
# restart an otherwise healthy gateway.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# No tini and no dumb-init in the image on purpose: compose sets `init: true`, which makes
# Docker inject its own PID 1 reaper (the same thing `docker run --init` does). A second init
# here would only obscure which one is actually reaping the Playwright process tree.
ENTRYPOINT ["node", "apps/qa-brain/dist/cli.js"]

# Default to hosted HTTP mode. Overridden per service in deploy/docker-compose.yml:
#   worker  -> ["worker", "--config", "/config/qa-brain.yaml"]
#   migrate -> ["db", "migrate", "--config", "/config/qa-brain.yaml"]
# 0.0.0.0 is safe here and only here: the port is published to nothing in prod, Caddy is the
# only thing on the `edge` network that talks to it, and the gateway still validates Host and
# Origin itself (docs/security-threat-model.md section 7).
CMD ["serve", "--transport", "http", "--host", "0.0.0.0", "--port", "8080", "--config", "/config/qa-brain.yaml"]
