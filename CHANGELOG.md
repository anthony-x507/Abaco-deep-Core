# Changelog

All notable changes to ABACO Deep Core are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.21] - 2026-09-17

Release prep: F1 admission immutable plus F1.5 MCP schema pin and memory packager provenance, already on `main`.

### Added
- **F1 — admission immutable** (PR #15 / `cb125df`): sealed session admission graph from the control plane only (`host` + pinned manifests + existing `patch.yml` snapshot). Skills, docs, memory, and tool-results cannot mutate admission, preload, or `patch.yml`. Runtime `proposeAdmissionChange` is deny-by-default and never writes.
- **F1.5 — MCP schema pin/witness** (PR #16 / `be6e784`): fail-closed register wrap for `mcp__*` tools. Canonical sha256 of each advertised `parameters` / `inputSchema` is attested by `host` or `user` only. Shipped pin set is empty (no third-party MCP schemas). Un-witnessed / drifted / expanded schemas deny with 0 registry write.
- **F1.5 — memory 3-phase packager provenance** (PR #17 / `f80a321`): profile / log / note packaging with fail-closed escalation and control rules (`effective = min(claim, channel)`). Untrusted / plugin-data stay quarantined. Memory cannot enter admission, preload, or `patch.yml`. Pack A MemoryStore quarantine is unchanged.

## [0.4.20] - 2026-09-17

Release prep: track `main`/runtime (PR #13) after 0.4.19.

### Changed
- 0.4.19 was cut from `f330411` before PR #13 merged. 0.4.20 versions the tip so GitHub Release matches the tracked harness-runtime sources (`harness-runtime.ts`, `disclaimed-utility-process.ts`, `profile-plugin-command.ts` at `a4610a1`).

## [0.4.19] - 2026-09-17

Release prep: F2.1 Packs A+B+C plus composer cleanup, already on `main`.

### Added
- **Pack A — MemoryStore quarantine** (PR #7): durable memory writes carry a trust tier and quarantine state; untrusted/plugin provenance stays invisible until a trusted reviewer promotes it.
- **Pack B — strangler-fork cell** (PR #9 / `0f507b1`): mediación piloto forks `worker.js` only after `authorize()` + `inspectGrant()` (honest `strangler-fork`, not a fake Electron `utilityProcess`).
- **Pack C — STT Mac-only** (PR #8 / `7fe9add`): product STT is local Whisper on Mac; non-Mac is fail-closed with a Linux §15/16 hint. No silent cloud fallback.

### Changed
- Composer cleanup from 0.4.17/0.4.18 stays in this ship: slim composer (+ / mic / Send), model + access in chrome, session analytics in Settings → Analytics.

### Fixed
- Regenerated the three remaining GNU `diff -Naur` patches (`dsh-client-ui-chat`, `dsh-client-ui-layout`, `dsh-client-ui-settings-models`) with `git diff --cached`, same form as the 0.4.18 conversation hotfix. `patch-package` could not parse those files, so `npm ci` / postinstall skipped them — including the layout title `ABACO DEEP HARNES` and WelcomeNotice suppression. Conversation patch from 0.4.18 is unchanged.
- Pack C G4 now asserts the Pack B worker wording (`NEVER issues grants`) so the merged tip does not fail its own STT contract.

## [0.4.18] - 2026-09-16

Hotfix so Leader can cut the Release that 0.4.17 could not package.

### Fixed
- Regenerated `patches/@deepseek-ai+dsh-client-ui-conversation+0.1.2-rc.1.patch` with `git diff --cached` (the same form `patch-package` writes). The 0.4.17 assemble used GNU `diff` and inserted a blank line between the `client.js` and `slots.d.ts` file diffs; `patch-package` treats that blank line as extra hunk context and throws `hunk header integrity check failed`, so `npm ci` / postinstall died before any apply. Composer cleanup is unchanged: Settings → Analytics, slim composer, model up top.

## [0.4.17] - 2026-09-16

Composer cleanup so Anthony can cut a GitHub Release and use in-app Update.

### Changed
- Composer box keeps one **+** attach control, a compact **mic**, and **Send**.
- Model dropdown moved out of the box into the chrome row above the composer (still a clickable catalog).
- Full-access / permission shield stays available in that same chrome row and is documented under Settings → Analytics.
- Session analytics strip (turns / steps / LLM / tools / TTFT / cache / input) no longer sits under the composer; it lives in **Settings → Analytics**.

## [0.4.0] - 2026-09-09

The first release that is a product rather than a rebrand: the desktop shell
carries its own identity, its own browser, and a context memory that survives
compaction.

### Added
- **Own identity end to end** — visible name `ABACO DEEP HARNES`, bundle id
  `io.abaco.deepcore`, its own app icon, sidebar and hero artwork, and an
  auto-update feed that points at this repository's releases instead of the
  upstream site.
- **Integrated browser** (`abaco-browser`, `abaco-browser-controller`): a
  `WebContentsView` overlay with its own session partition, a chrome bar with
  address, history, reload, live loading state, page title, `AGENT`/`MANUAL`
  takeover pill and the usual macOS shortcuts (`⌘L`, `⌘R`, `⌘W`, `⌘←`, `⌘→`),
  and seven agent tools (`navigate`, `click`, `type`, `read_dom`, `wait_for`,
  `state`, `screenshot`) served over a loopback RPC that is bound to an
  ephemeral port and authenticated with a bearer token compared in constant
  time.
- **Action recording and skill generation**: while a human drives the browser
  in `MANUAL` mode every trusted input event is recorded (with passwords
  redacted), and one button compiles a finished recording into a real
  `SKILL.md` under `$DSH_HOME/skills/` — the same directory the harness's own
  skill provider scans, verified in tests against that provider rather than a
  reimplementation of it.
- **Three-layer context memory**:
  - *Layer 2 — durable memory* (`abaco-memory`): a faceted sidecar store under
    `$DSH_HOME/abaco-memory` with the `abaco_memory_set/get/forget/list` tools,
    injected into the system prompt through a section whose text is
    re-evaluated on every assembly. Compaction only ever replaces user-message
    surfaces, so what is remembered survives any number of summaries by
    construction.
  - *Layer 1 — working window* (`abaco-context`): an ABACO agent preset that
    summarises at 60% of the routed window instead of 80%, keeps 8% verbatim
    instead of 16%, allows a 16k-token summary instead of 8k, prunes tool
    results earlier, and carries the delegation and memory discipline in its
    persona. It is installed into the harness's own user preset root and
    selected once; a preset edited by hand, or one the person picked, is never
    overwritten.
  - *Layer 3 — delegation* (`abaco-vault`): oversized subagent settlement
    notices are written to a durable vault under `$DSH_HOME` and replaced in
    the window by a head plus a locator the agent can `read`/`grep`, and
    oversized tool results spill at 12KB instead of 50KB.

### Changed
- Voice (TTS/STT), document upload and the `AGENTE TRABAJANDO` indicator are
  mounted from the shipping plugin set rather than shipped disabled.

### Fixed
- The mobile bridge no longer collides with a stock DSH Desktop install on the
  same machine (own port plus an ephemeral fallback).

## [Unreleased]

### Added
- Plugin-first architecture discovered through Python `entry_points`.
- Tailscale mesh sync with offline-first reconciliation and Last-Writer-Wins conflict resolution.
- Whisper.cpp-based local speech-to-text via the `WhisperRunner` subprocess wrapper.
- macOS `say`-based text-to-speech via `TTSRunner`.
- Embedded `BrowserView` with agent/manual takeover, recording, and skill generation.
- Claude API skill generator with deterministic heuristic fallback.
- One-time QR phone pairing with rate limiting and session tokens.
- Auto-update pipeline that backs up data, runs migrations, and rolls back on failure.
- Local data store backed by JSONL ledgers and atomic writes.
- Upload feature with MIME allowlist, size cap, SHA-256 hashing, and per-thread attachment.
- Skills templates (Google search, GitHub issue, Twitter post).
- English and Spanish documentation under `docs/`.
- Unsigned build pipeline producing `arm64` and `x64` ZIPs for macOS.

### Security
- HMAC-SHA256 over all sync envelopes with a shared secret on disk.
- Redaction of token, secret, and password markers in public API responses.
- Tailscale transport, no public-internet exposure for sync traffic.

## [0.1.0-unsigned-dev] - 2026-09-08

### Added
- Initial public scaffold under the working name `Abaco-deep-Harnes`.
- Bootstrap script and verification helpers.

### Known limitations
- macOS builds are unsigned; first launch requires `xattr -dr com.apple.quarantine`.
- Sync requires Tailscale on every Mac that participates in the mesh.
- LWW may discard concurrent edits silently.
