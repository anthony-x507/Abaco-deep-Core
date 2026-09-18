# ABACO DEEP HARNES

Cross-platform desktop shell inspired by new plugin-based AI technology, designed to push the boundaries of agentic computing.

## What it is

**ABACO DEEP HARNES** (`appId` `io.abaco.deepcore`) is a portable, plugin-extensible desktop shell that runs local-first, syncs across machines, and embeds a browser the agent can drive while you stay in control.

The shipped Mac app is `ABACO DEEP HARNES.app` from the 0.4.x Electron tree under `desktop/src/dsh-desktop/`. Repo directory names such as `abaco-deep-core` (userData) are not the product name.

## Why it exists

Most agent shells force you to choose between closed ecosystems and DIY duct tape. ABACO DEEP HARNES picks a third path: a small, auditable core that you extend with open plugins and keep in sync across every Mac you own.

## Highlights

- **Plugin-first architecture** — discover, load, and unload plugins via Python `entry_points` or `abaco plugins` commands.
- **Mesh sync between Macs** — your chat history, memories, and skills ride a Tailscale mesh with offline-first sync.
- **Voice in and out** — Whisper.cpp for transcription, macOS `say` for synthesis, both 100% on-device.
- **Embedded browser with takeover** — the agent drives the browser while you record your own workflows; recordings become reusable Skills.
- **Phone pairing** — link your phone to the desktop with a single QR code.
- **Auto-update that preserves memory** — every upgrade backs up your data, runs migrations, and rolls back on failure.

## Built for

- Developers who want their agent to follow them across machines.
- Operators who prefer local-first tooling with auditable plugins.
- Teams that need to share workflows as Skills without leaking data.

## Repository

| Branch | Purpose |
|---|---|
| `main` | Stable releases. |
| `develop` | Active development. |

## Stack

- **Shell**: Electron + TypeScript + React.
- **Core**: Python 3.11+ with FastAPI.
- **Sync**: Tailscale mesh with Last-Writer-Wins.
- **Storage**: local JSONL ledgers, SQLite when needed.
- **Build**: electron-builder (`artifactName` `abaco-deep-harnes-${os}-${arch}`).

## Install

Current ship is **0.4.x**. From [Releases](https://github.com/anthony-x507/Abaco-deep-Core/releases), download `abaco-deep-harnes-mac-arm64.dmg` (Apple Silicon). Open the DMG and drag `ABACO DEEP HARNES.app` to `/Applications`.

Bundle ID: `io.abaco.deepcore`.

If Gatekeeper blocks a first launch:

```bash
xattr -dr com.apple.quarantine "/Applications/ABACO DEEP HARNES.app"
```

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide.

## Documentation

- [Quickstart](docs/QUICKSTART.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Sync between Macs](docs/SYNC.md)
- [Compaction](docs/COMPACTION.md)
- [Security](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

MIT — see [LICENSE](LICENSE).

You are free to download, fork, modify, and redistribute. The only requirement is to keep the copyright notice.

## Inspiration

Built with the same spirit as plugin-based agentic shells: small core, big ecosystem, zero lock-in.
