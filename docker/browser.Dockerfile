# syntax=docker/dockerfile:1.9
#
# QA Brain browser sidecar -- `ghcr.io/chinmaydhokey/qa-brain-browser:1.62.1`.
#
# Serves Playwright MCP over Streamable HTTP on :8931/mcp for the hosted `worker`
# (docs/deployment.md section 4). It is our own image rather than
# mcr.microsoft.com/playwright/mcp because that image forces --no-sandbox, is Chromium-only,
# and tracks @playwright/mcp 0.0.79 -> playwright 1.63.0-alpha browsers. Building here keeps
# ONE Playwright version across the MCP server, the browsers, the adapter and CI, and lets
# Chromium keep its sandbox (see docker/seccomp_profile.json).
#
# M0 STATUS: nothing calls this sidecar yet -- the M0 gateway spawns Playwright MCP as a local
# stdio child. The HTTP sidecar is wired up in milestone M5 (Feb 2027). The image is still
# built on every pull request by the `docker-build` job (docs/ci-cd.md section 2,
# `file: docker/browser.Dockerfile`, `context: .`).
#
# Build from the REPOSITORY ROOT:
#   docker build -f docker/browser.Dockerfile -t qa-brain-browser:dev .

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PLAYWRIGHT_VERSION=1.62.1
ARG PNPM_VERSION=10.34.5

# ---------------------------------------------------------------------------------------
# build -- identical to docker/qa-brain.Dockerfile's build stage.
#
# Why build the workspace at all in a "browser" image: docs/deployment.md section 4 requires
# the image to carry the built qa-brain workspace and playwright@1.62.1, because (a) the
# Playwright CLI that serves MCP is the one pinned by @qa-brain/adapter-playwright -- never
# npx, never @playwright/mcp -- and (b) section 2.4 documents running local stdio mode inside
# this image so contributors do not need Playwright's system dependencies on the host.
#
# Debian bookworm here, Ubuntu noble below: both are glibc, and the only native dependency
# (@libsql/client) resolves to a prebuilt N-API `linux-x64-gnu` binary, so the tree is
# portable between the two.
# ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
ARG PLAYWRIGHT_VERSION
# Browsers come from the Playwright base image below (/ms-playwright), never from npm: a
# second download would mean a second browser revision.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/qa-brain/package.json                 apps/qa-brain/
COPY packages/core/package.json                 packages/core/
COPY packages/store/package.json                packages/store/
COPY packages/adapter-playwright/package.json   packages/adapter-playwright/
COPY packages/gateway/package.json              packages/gateway/
COPY packages/healing/package.json              packages/healing/
COPY packages/test-format/package.json          packages/test-format/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json ./
COPY packages packages
COPY apps apps

RUN pnpm build

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# The pinned Playwright CLI must survive the prune -- it is the MCP server this image exists
# to run. pnpm does not hoist, so it lives under the package that depends on it; this is the
# same file `require.resolve('playwright/package.json')` finds in the adapter.
#
# The last check is the important one: it fails the build if the npm pin and the base image
# tag ever drift apart, which is the failure mode that would put two Chromium revisions in
# one image.
RUN set -eux; \
    test -f /app/apps/qa-brain/dist/cli.js; \
    test -f /app/packages/adapter-playwright/node_modules/playwright/cli.js; \
    pw="$(node -p "require('/app/packages/adapter-playwright/node_modules/playwright/package.json').version")"; \
    test "$pw" = "${PLAYWRIGHT_VERSION}"; \
    echo "playwright $pw matches the base image tag"

# ---------------------------------------------------------------------------------------
# runtime -- the official Playwright image, which already carries the matching browsers,
# their OS dependencies, fonts, and a non-root `pwuser`.
# ---------------------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime
ARG PLAYWRIGHT_VERSION

LABEL org.opencontainers.image.title="qa-brain-browser" \
      org.opencontainers.image.description="Playwright MCP sidecar for QA Brain (Streamable HTTP :8931)" \
      org.opencontainers.image.source="https://github.com/chinmaydhokey/MCP_server" \
      org.opencontainers.image.documentation="https://github.com/chinmaydhokey/MCP_server/blob/main/docs/deployment.md" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${PLAYWRIGHT_VERSION}"

# PLAYWRIGHT_MCP_PING_TIMEOUT_MS: Playwright MCP's HTTP mode sends a server-initiated ping and
# kills the session after 5 s without an answer. Behind the Smokescreen proxy a single
# navigation can outlast that, and the failure surfaces as a bogus `Session not found` in the
# middle of a tool call. Since 0.0.77 this variable overrides the heartbeat
# (microsoft/playwright#41391); 60 s matches the gateway's server.callTimeoutMs.
#
# PLAYWRIGHT_BROWSERS_PATH is already /ms-playwright in the base image; repeated here so the
# next reader does not have to go look, and so `npm i playwright` inside the container would
# reuse the baked revision instead of downloading a second one.
ENV NODE_ENV=production \
    PLAYWRIGHT_MCP_PING_TIMEOUT_MS=60000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    QA_BRAIN_HOME=/data

WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app /app

# /artifacts is Playwright MCP's --output-dir: session logs, downloads and the screenshots
# `web_take_screenshot` writes. It is a named volume in compose because the container root is
# read_only. `qa-brain` on PATH keeps docs/deployment.md section 2.4 working
# (`docker run --entrypoint qa-brain ... serve --transport stdio`).
RUN mkdir -p /artifacts /data \
 && chown pwuser:pwuser /artifacts /data \
 && chmod 0755 /app/apps/qa-brain/dist/cli.js \
 && ln -s /app/apps/qa-brain/dist/cli.js /usr/local/bin/qa-brain

# pwuser (uid 1000) ships with the Playwright image. Running as root would force
# --no-sandbox and silently disable the Chromium sandbox -- the exact trade
# docker/seccomp_profile.json exists to avoid.
USER pwuser

EXPOSE 8931

# Any HTTP answer means the MCP server is listening: GET / is not a valid MCP request, so 404
# is as good a liveness signal as 200 (docs/deployment.md section 3.1). Node is used instead
# of wget/curl so the probe does not depend on which of them the base image happens to ship.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8931/').then(()=>process.exit(0)).catch(()=>process.exit(1))"]

# `node <playwright pkg dir>/cli.js mcp` -- never npx (a registry fetch at spawn time plus a
# process layer whose grandchildren survive a plain kill) and never @playwright/mcp (which
# pins playwright 1.63.0-alpha). Same launch shape as the local stdio adapter.
ENTRYPOINT ["node", "/app/packages/adapter-playwright/node_modules/playwright/cli.js", "mcp"]

# Sidecar flags, every one verified against `playwright mcp --help` in 1.62.1:
#   --headless --browser chromium  no display, one engine (the M0 surface is Chromium-only)
#   --isolated                     throwaway in-memory profile; no cookie bleed between runs
#   --port/--host                  Streamable HTTP on the internal `browsers` network
#   --allowed-hosts playwright-mcp DNS-rebinding guard: only the compose service name is
#                                  accepted in the Host header (the worker dials by that name)
#   --caps=testing                 adds browser_generate_locator + browser_verify_*; leaves
#                                  vision/pdf/devtools/network/storage tool families absent
#                                  from the child entirely (threat model T1)
#   --snapshot-mode=full           accessibility snapshots with [ref=eN] targets
#   --image-responses=omit         screenshots go to --output-dir, not into the LLM context
#   --codegen none                 no generated code appended to every action result (tokens)
#   --output-dir /artifacts        the artefacts volume
#   --output-max-size 524288000    500 MiB: Playwright evicts old files before the volume fills
#   --proxy-server http://egress:4750  every byte the browser sends leaves through Smokescreen
#   --timeout-action 10000          matches the local adapter
#   --timeout-navigation 30000     30 s instead of the 60 s default; CI-tuned
#   --timeout-settle 500           default, pinned so a future default change is visible
#
# Deliberately NOT set here:
#   --no-sandbox                   would disable the Chromium sandbox (see seccomp profile)
#   --shared-browser-context       one context per connected client, never shared (section 3.1)
#   --save-session, --secrets      per-deployment; deploy/docker-compose.yml appends them
#                                  because --secrets points at a Compose secret file
CMD ["--headless", \
     "--browser", "chromium", \
     "--isolated", \
     "--port", "8931", \
     "--host", "0.0.0.0", \
     "--allowed-hosts", "playwright-mcp", \
     "--caps=testing", \
     "--snapshot-mode=full", \
     "--image-responses=omit", \
     "--codegen", "none", \
     "--output-dir", "/artifacts", \
     "--output-max-size", "524288000", \
     "--proxy-server", "http://egress:4750", \
     "--timeout-action", "10000", \
     "--timeout-navigation", "30000", \
     "--timeout-settle", "500"]
