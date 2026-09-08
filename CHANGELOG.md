# Changelog

All notable changes to ABACO Deep Core are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
