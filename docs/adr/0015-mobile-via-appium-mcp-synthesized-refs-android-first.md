# ADR-0015: Mobile via appium-mcp with synthesized refs, Android first, iOS macOS-only

Mobile enters QA Brain through the same `UpstreamAdapter` contract as Playwright, with the official `appium-mcp` (≥ 1.92, Node 22) as primary upstream and `@mobilenext/mobile-mcp` 1.0.2 as an optional adapter. No mobile MCP returns Playwright-style element refs, so QA Brain synthesizes `ref=mN` handles from Appium page-source XML; `mobile_*` tools, fingerprints and T0–T3 healing then behave identically on both platforms. Android ships first with a KVM-accelerated GitHub Actions path (M6); iOS is designed in but macOS-only and undeployed. Emulators never run inside Docker on laptops.

## Status

Accepted, 2026-08-20.

## Context

- `appium-mcp` (appium/appium-mcp) is the Appium organization's server: v1.92.4 on 2026-08-16, weekly releases, Node ≥ 22. It embeds `appium-uiautomator2-driver ^8`, `appium-xcuitest-driver ^12.1`, `appium-adb` and `node-simctl`; a separate Appium server is needed only for remote grids. `appium_find_element(strategy, selector)` returns a WebDriver element UUID accepted as `elementUUID` by `appium_gesture`, `appium_set_value` and `appium_get_text`; `appium_get_page_source` returns the UiAutomator2/XCUITest XML; UUIDs carry no staleness detection. Transports: stdio or `--httpStream --port=N`, unauthenticated. `NO_UI=true` drops MCP-Apps HTML (50–80 % faster); the default `APPIUM_MCP_ON_CLIENT_DISCONNECT=delete_all` kills sessions on last-client disconnect ([README](https://raw.githubusercontent.com/appium/appium-mcp/main/README.md), [find.ts](https://raw.githubusercontent.com/appium/appium-mcp/main/src/tools/interactions/find.ts)). It is built on the v1 TS SDK, so the gateway's `mode: 'auto'` client uses the legacy handshake ([ADR-0003](./0003-target-mcp-2026-07-28-dual-era.md)).
- `@mobilenext/mobile-mcp` 1.0.2 (2026-08-09) is coordinates-only (`{type, text, label, name, value, identifier, coordinates}`, taps take `x,y`); 1.0.0 swapped its backend for the Go `mobilecli` binary; `--listen` is legacy HTTP+SSE and rejects a second client with 409; PostHog telemetry is on unless `MOBILEMCP_DISABLE_TELEMETRY` ([releases](https://github.com/mobile-next/mobile-mcp/releases), [index.ts](https://raw.githubusercontent.com/mobile-next/mobile-mcp/main/src/index.ts)).
- `ReactiveCircus/android-emulator-runner@v2` recommends `ubuntu-latest` with KVM via a udev rule ([README](https://github.com/ReactiveCircus/android-emulator-runner/blob/main/README.md)); GitHub macOS arm64 runners lack nested virtualization; iOS simulators need macOS + Xcode ([runner-images](https://github.com/actions/runner-images)). Android-in-Docker needs `/dev/kvm` (`budtmo/docker-android`) or Redroid's `binder_linux` modules plus privileged containers — neither exists under Docker Desktop on Windows/macOS ([docker-android](https://github.com/budtmo/docker-android)).

## Decision

1. **Primary upstream** `mcpServers.appium`: `command: appium-mcp` (workspace-resolved, never `npx`), `env: { NO_UI: 'true', APPIUM_MCP_ON_CLIENT_DISCONNECT: 'skip', APPIUM_MCP_EVIDENCE: 'true', REMOTE_SERVER_URL_ALLOW_REGEX: '^https?://(appium\\.internal|hub\\.browserstack\\.com)' }`, `adapter: appium`, `prefix: mobile_`, `longLived: true`; exact pin (Renovate group `appium`).
2. **Synthesized refs.** The adapter declares `snapshotKind: 'synthesized'`. `mobile_snapshot` calls `appium_get_page_source`, keeps visible interactable nodes (non-zero bounds; `clickable`, `focusable`, `enabled` or text-bearing) and emits `- button "Add to cart" [ref=m12]`, storing per ref ranked locators — `accessibility id` → `resource-id` → `-ios predicate string`/`class chain` → `xpath` — plus `bounds`. Roles: `Button`→button, `EditText`→textbox, `CheckBox`/`Switch`→checkbox/switch, clickable `TextView`→link/button; `XCUIElementType*` likewise. `mapArgs` turns `mobile_click(ref)` into `appium_find_element` → `elementUUID` → `appium_gesture(tap)`, with a bounds-center tap as fallback. Refs are per-snapshot and invalid after any action.
3. **Curated surface**, listed only when a mobile upstream is configured (the default 22 stay intact): `mobile_snapshot`, `mobile_find`, `mobile_click`, `mobile_type`, `mobile_swipe`, `mobile_press_key`, `mobile_wait_for`, `mobile_screenshot`, `mobile_app`, `mobile_alert`, `mobile_context`; hidden-callable `mobile_session`, `mobile_permissions`, `mobile_record`; blocked `appium_ai`, `appium_generate_tests`, `appium_perform_actions`, documentation tools.
4. **Optional adapter** `adapter: mobile-mcp`: stdio only, synthetic refs from the element list, rect-center taps, `MOBILEMCP_DISABLE_TELEMETRY=1`.
5. **Android-first CI** (`android-e2e.yml`): udev rule `KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"`; `actions/setup-java@v4` (17); AVD cache `avd-35-x86_64`; `ReactiveCircus/android-emulator-runner@v2` with `api-level: 35`, `arch: x86_64`, `target: google_apis`, `disable-animations: true`, `emulator-boot-timeout: 900`, `script: pnpm qa-brain run --profile android --suite examples/android-sample --junit reports/android.xml`. `workflow_dispatch` in M0, weekly from M6.
6. **iOS**: same adapter, `platform: ios`; `prepare_ios_simulator`, UDID from `xcrun simctl list devices available -j`, WDA cached via `APPIUM_MCP_WDA_APP_PATH`; macOS runners only; documented in M8.
7. **No emulator in Compose.** The hosted `worker` spawns `appium-mcp` over stdio with `remoteServerUrl` pointing at a developer's emulator (Tailscale), `budtmo/docker-android` on a KVM-capable VM, or a device farm, constrained by `REMOTE_SERVER_URL_ALLOW_REGEX`.

## Consequences

**Positive.** One snapshot grammar across platforms; fingerprints share `step_fingerprint` (discriminated by `platform`) and healing needs no mobile fork. Embedded drivers remove the local Appium-server install. Linux runners are 2–3× cheaper than macOS.

**Negative.** Page-source parsing is QA Brain code that must track UiAutomator2/XCUITest XML quirks; each `mobile_click` costs a `find` plus a `gesture` round trip. Android hosts need Java and `ANDROID_HOME`; iOS stays untested in CI without a self-hosted Mac.

**Neutral.** appium-mcp's HTTP mode has no auth; when hosted it sits on the `browsers` network behind the gateway. WebViews need `mobile_context`; mobile-mcp cannot see them.

## Alternatives considered

- **mobile-mcp as primary.** Rejected: coordinates-only, backend rewrite in progress, legacy SSE.
- **`@wdio/mcp` 3.11.** Rejected as primary: selector strings, external Appium server; a viable third adapter.
- **Maestro `maestro mcp`.** Rejected: YAML flows only, no per-action tools.
- **Emulator containers in Compose.** Rejected: KVM/binder requirements rule out Windows/macOS laptops.

## References

- [appium-mcp README](https://raw.githubusercontent.com/appium/appium-mcp/main/README.md) · [appium-mcp find.ts](https://raw.githubusercontent.com/appium/appium-mcp/main/src/tools/interactions/find.ts) · [mobile-mcp releases](https://github.com/mobile-next/mobile-mcp/releases) · [android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner/blob/main/README.md) · [runner-images](https://github.com/actions/runner-images) · [docker-android](https://github.com/budtmo/docker-android)
- [Tool catalog](../tool-catalog.md) · [Self-healing](../self-healing.md) · [CI/CD](../ci-cd.md) · [Deployment](../deployment.md) · [ADR-0003](./0003-target-mcp-2026-07-28-dual-era.md) · [ADR-0004](./0004-tool-namespacing-and-curated-surface.md) · [ADR-0009](./0009-self-healing-as-tiered-proposals-with-approval.md)
