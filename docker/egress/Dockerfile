# syntax=docker/dockerfile:1.9
#
# Egress proxy for the `browsers` network -- Stripe's Smokescreen, built from source.
#
# WHY THIS EXISTS: a prompt-injected page can talk the LLM into navigating anywhere
# (docs/security-threat-model.md T2/T3). The gateway's URL guard catches the initial URL, but
# it cannot see redirects, and DNS can be re-pointed between the guard's lookup and the
# browser's connect. Smokescreen closes both holes at the network layer: it denies RFC 1918,
# link-local and 169.254.169.254 by default, and it resolves DNS itself at connect time, so
# rebinding has nothing to win. This is the control the MCP security best-practices page
# names by name.
#
# There is no official Smokescreen image on any registry, hence the source build.
#
# M0 STATUS: unwired. The gateway's URL guard is live in M0; this proxy is part of hosted
# mode and starts doing work in milestone M5 (Feb 2027).
#
# Build (from anywhere -- this stage needs no repository context):
#   docker build -f docker/egress/Dockerfile -t qa-brain-egress:dev docker/egress

ARG GO_IMAGE=golang:1.27-alpine
ARG RUNTIME_IMAGE=alpine:3.23

# Released tag, not a branch. v0.0.4 is the newest tag stripe/smokescreen carries
# (commit e196cd61a007e1cdbde5579fe2dac95e7154190c); Renovate bumps this ARG when a newer one
# appears. Do not switch this to `main`: an unpinned proxy is a supply-chain hole in the one
# component whose whole job is to be trustworthy (threat model T15).
ARG SMOKESCREEN_VERSION=v0.0.4

# ---------------------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------------------
FROM ${GO_IMAGE} AS build
ARG SMOKESCREEN_VERSION

# `go install <module>@<version>` rather than `git clone && go build`: the module proxy and
# the public checksum database (sum.golang.org) verify the source tree and every transitive
# dependency against go.sum before a single byte is compiled. That is strictly more
# verification than cloning a tag would give us.
#
# CGO_ENABLED=0 produces a static binary, so the runtime stage needs no libc compatibility
# shim; -trimpath keeps absolute build paths out of the binary (reproducibility).
# GOTOOLCHAIN=local pins the compiler to the one in the base image: no surprise toolchain
# download mid-build. (No GOFLAGS here -- `go install pkg@version` rejects an explicit -mod.)
ENV CGO_ENABLED=0 \
    GOTOOLCHAIN=local

RUN --mount=type=cache,id=go-build,target=/root/.cache/go-build \
    --mount=type=cache,id=go-mod,target=/go/pkg/mod \
    go install -trimpath -ldflags="-s -w" \
      "github.com/stripe/smokescreen@${SMOKESCREEN_VERSION}" \
 && /go/bin/smokescreen --version

# ---------------------------------------------------------------------------------------
# runtime
#
# Alpine rather than distroless/static, deliberately: the compose healthcheck for this
# service is a TCP probe on 4750 and Docker healthchecks run INSIDE the container, so the
# image has to contain something that can open a socket. busybox `nc` is ~0 bytes on top of a
# base we already need for ca-certificates. Distroless would buy a few hundred kB and cost
# the only liveness signal this service has.
# ---------------------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime

LABEL org.opencontainers.image.title="qa-brain-egress" \
      org.opencontainers.image.description="Smokescreen egress proxy for the QA Brain browsers network" \
      org.opencontainers.image.source="https://github.com/chinmaydhokey/MCP_server" \
      org.opencontainers.image.documentation="https://github.com/chinmaydhokey/MCP_server/blob/main/docs/deployment.md" \
      org.opencontainers.image.licenses="MIT"

# ca-certificates: Smokescreen dials TLS origins on behalf of the browser for plain HTTP
# requests. tzdata: log timestamps in a sane zone. Nothing else -- no shell utilities that a
# compromised proxy could pivot with beyond what busybox already provides.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -g 65532 -S smokescreen \
 && adduser -u 65532 -S -G smokescreen -H -s /sbin/nologin smokescreen \
 && mkdir -p /etc/smokescreen \
 && chown -R root:root /etc/smokescreen \
 && chmod 0755 /etc/smokescreen

COPY --from=build --chown=root:root --chmod=0555 /go/bin/smokescreen /usr/local/bin/smokescreen

# uid 65532 is the distroless "nonroot" convention; docs/deployment.md section 5 pins
# `user: 65532` for this service. The binary is root-owned and non-writable by that user.
USER 65532:65532

EXPOSE 4750

# The ACL and the server config are mounted read-only by compose:
#   /etc/smokescreen/acl.yaml          deploy/egress/acl.yaml
#   /etc/smokescreen/smokescreen.yaml  deploy/egress/smokescreen.yaml
# --listen-ip 0.0.0.0 is required: the client is the playwright-mcp container on the
# `browsers` network, not localhost. That network is `internal: true`, so 0.0.0.0 here means
# "reachable by the browser sidecar", not "reachable from the internet".
ENTRYPOINT ["/usr/local/bin/smokescreen"]
CMD ["--config-file", "/etc/smokescreen/smokescreen.yaml", \
     "--listen-ip", "0.0.0.0", \
     "--listen-port", "4750", \
     "--egress-acl-file", "/etc/smokescreen/acl.yaml"]
