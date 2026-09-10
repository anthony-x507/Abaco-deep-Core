# Changelog

All notable changes to ABACO Deep Core are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
